// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ManagerPortfolioV2
 * @notice On-chain portfolio registry for Manager v2.
 *         Receives USDC via Circle CCTP from Sui.
 *         Tracks positions, enforces guards, logs AI agent trade intents.
 */

interface IMessageTransmitter {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract ManagerPortfolioV2 {

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Position {
        uint256 shares;       // scaled 1e6
        uint256 avgPriceCents;
        uint256 lastUpdated;
    }

    struct TradeIntent {
        bytes32 intentHash;
        address user;
        uint8   tradeType;    // 0=buy, 1=sell
        bytes32 symbol;
        uint256 shares;
        uint256 priceCents;
        uint8   status;       // 0=pending, 1=executed, 2=cancelled
        uint256 timestamp;
    }

    struct BridgeReceipt {
        address user;
        uint256 amount;
        uint64  nonce;
        uint256 timestamp;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    uint8   constant TRADE_BUY    = 0;
    uint8   constant TRADE_SELL   = 1;
    uint8   constant STATUS_PENDING   = 0;
    uint8   constant STATUS_EXECUTED  = 1;
    uint8   constant STATUS_CANCELLED = 2;
    uint256 constant MAX_TRADE_BPS    = 4000;  // 40%
    uint256 constant MAX_POSITION_BPS = 5000;  // 50%
    uint256 constant MIN_CASH_BUFFER  = 500e6; // $500 USDC

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public owner;
    address public agent;

    IERC20  public usdc;
    IMessageTransmitter public cctpTransmitter;

    // user => USDC balance (6 decimals)
    mapping(address => uint256) public cashBalance;

    // user => symbol => Position
    mapping(address => mapping(bytes32 => Position)) public positions;

    // intentHash => TradeIntent
    mapping(bytes32 => TradeIntent) public intents;

    // user => intent hashes
    mapping(address => bytes32[]) public userIntents;

    // CCTP nonce => processed
    mapping(uint64 => bool) public processedNonces;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event BridgeReceived(address indexed user, uint256 amount, uint64 nonce);
    event IntentSubmitted(bytes32 indexed intentHash, address indexed user, uint8 tradeType, bytes32 symbol, uint256 shares, uint256 priceCents);
    event IntentExecuted(bytes32 indexed intentHash, address indexed user);
    event IntentCancelled(bytes32 indexed intentHash, string reason);
    event PositionUpdated(address indexed user, bytes32 symbol, uint256 shares, uint256 avgPrice);
    event GuardWarning(address indexed user, string guard);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error Unauthorized();
    error InsufficientFunds();
    error InsufficientShares();
    error AlreadyProcessed();
    error GuardViolation(string reason);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _agent, address _usdc, address _cctpTransmitter) {
        owner = msg.sender;
        agent = _agent;
        usdc  = IERC20(_usdc);
        cctpTransmitter = IMessageTransmitter(_cctpTransmitter);
    }

    modifier onlyOwner()  { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyAgent()  { if (msg.sender != agent && msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyUserOrAgent(address user) {
        if (msg.sender != user && msg.sender != agent && msg.sender != owner) revert Unauthorized();
        _;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setAgent(address _agent) external onlyOwner { agent = _agent; }
    function setUsdc(address _usdc)   external onlyOwner { usdc = IERC20(_usdc); }

    // ─── CCTP Bridge Receive ──────────────────────────────────────────────────

    /**
     * @notice Receive USDC bridged from Sui via Circle CCTP.
     *         Agent calls this after obtaining Circle attestation.
     * @param message     Raw CCTP message bytes from Circle
     * @param attestation Circle attestation signature
     * @param user        Destination user's portfolio address
     * @param amount      USDC amount (6 decimals)
     * @param nonce       CCTP nonce (prevents replay)
     */
    function receiveBridgedUsdc(
        bytes calldata message,
        bytes calldata attestation,
        address user,
        uint256 amount,
        uint64  nonce
    ) external onlyAgent {
        if (processedNonces[nonce]) revert AlreadyProcessed();
        processedNonces[nonce] = true;

        // Call Circle's MessageTransmitter to verify + execute the burn/mint
        bool success = cctpTransmitter.receiveMessage(message, attestation);
        require(success, "CCTP receive failed");

        // Credit user's portfolio balance
        cashBalance[user] += amount;

        emit BridgeReceived(user, amount, nonce);
        emit Deposited(user, amount);
    }

    /**
     * @notice Direct USDC deposit (for testing / non-bridge deposits)
     */
    function deposit(address user, uint256 amount) external onlyAgent {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        cashBalance[user] += amount;
        emit Deposited(user, amount);
    }

    /**
     * @notice Mock deposit for demo/testnet (no actual USDC transfer)
     */
    function mockDeposit(address user, uint256 amount) external onlyAgent {
        cashBalance[user] += amount;
        emit Deposited(user, amount);
    }

    // ─── Trade Intents ────────────────────────────────────────────────────────

    function submitIntent(
        address user,
        uint8   tradeType,
        bytes32 symbol,
        uint256 shares,
        uint256 priceCents
    ) external onlyAgent returns (bytes32 intentHash) {
        uint256 tradeValue = (shares * priceCents) / 1e6;

        _checkGuards(user, tradeType, symbol, shares, tradeValue);

        intentHash = keccak256(abi.encodePacked(user, tradeType, symbol, shares, priceCents, block.timestamp));

        intents[intentHash] = TradeIntent({
            intentHash:  intentHash,
            user:        user,
            tradeType:   tradeType,
            symbol:      symbol,
            shares:      shares,
            priceCents:  priceCents,
            status:      STATUS_PENDING,
            timestamp:   block.timestamp
        });

        userIntents[user].push(intentHash);
        emit IntentSubmitted(intentHash, user, tradeType, symbol, shares, priceCents);
    }

    function executeIntent(bytes32 intentHash) external onlyAgent {
        TradeIntent storage intent = intents[intentHash];
        if (intent.user == address(0)) revert InsufficientFunds();
        if (intent.status != STATUS_PENDING) revert AlreadyProcessed();

        uint256 tradeValue = (intent.shares * intent.priceCents) / 1e6;

        if (intent.tradeType == TRADE_BUY) {
            if (cashBalance[intent.user] < tradeValue) revert InsufficientFunds();
            cashBalance[intent.user] -= tradeValue;
            _addPosition(intent.user, intent.symbol, intent.shares, intent.priceCents);
        } else {
            Position storage pos = positions[intent.user][intent.symbol];
            if (pos.shares < intent.shares) revert InsufficientShares();
            cashBalance[intent.user] += tradeValue;
            _removePosition(intent.user, intent.symbol, intent.shares);
        }

        intent.status = STATUS_EXECUTED;
        emit IntentExecuted(intentHash, intent.user);
    }

    function cancelIntent(bytes32 intentHash, string calldata reason) external {
        TradeIntent storage intent = intents[intentHash];
        if (msg.sender != intent.user && msg.sender != agent && msg.sender != owner) revert Unauthorized();
        if (intent.status != STATUS_PENDING) revert AlreadyProcessed();
        intent.status = STATUS_CANCELLED;
        emit IntentCancelled(intentHash, reason);
    }

    // ─── Guards ───────────────────────────────────────────────────────────────

    function _checkGuards(address user, uint8 tradeType, bytes32 symbol, uint256 shares, uint256 tradeValue) internal {
        if (tradeType == TRADE_BUY) {
            if (cashBalance[user] < tradeValue) revert GuardViolation("INSUFFICIENT_CASH");
            if (cashBalance[user] > 0) {
                uint256 tradePct = (tradeValue * 10_000) / cashBalance[user];
                if (tradePct > MAX_TRADE_BPS) emit GuardWarning(user, "TRADE_TOO_LARGE");
            }
            if (cashBalance[user] >= tradeValue && cashBalance[user] - tradeValue < MIN_CASH_BUFFER) {
                emit GuardWarning(user, "LOW_CASH_BUFFER");
            }
        } else {
            Position storage pos = positions[user][symbol];
            if (pos.shares < shares) revert GuardViolation("INSUFFICIENT_SHARES");
        }
    }

    // ─── Position Helpers ─────────────────────────────────────────────────────

    function _addPosition(address user, bytes32 symbol, uint256 shares, uint256 priceCents) internal {
        Position storage pos = positions[user][symbol];
        if (pos.shares == 0) {
            pos.avgPriceCents = priceCents;
            pos.shares = shares;
        } else {
            uint256 totalCost = (pos.shares * pos.avgPriceCents) + (shares * priceCents);
            pos.shares += shares;
            pos.avgPriceCents = totalCost / pos.shares;
        }
        pos.lastUpdated = block.timestamp;
        emit PositionUpdated(user, symbol, pos.shares, pos.avgPriceCents);
    }

    function _removePosition(address user, bytes32 symbol, uint256 shares) internal {
        Position storage pos = positions[user][symbol];
        pos.shares -= shares;
        pos.lastUpdated = block.timestamp;
        emit PositionUpdated(user, symbol, pos.shares, pos.avgPriceCents);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPosition(address user, bytes32 symbol) external view returns (Position memory) { return positions[user][symbol]; }
    function getUserIntents(address user) external view returns (bytes32[] memory) { return userIntents[user]; }
    function getIntent(bytes32 h) external view returns (TradeIntent memory) { return intents[h]; }
    function symbolKey(string calldata s) external pure returns (bytes32) { return keccak256(abi.encodePacked(s)); }
}
