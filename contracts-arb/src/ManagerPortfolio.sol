// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ManagerPortfolio {
    address public owner;
    address public agent;
    IERC20 public usdc;

    uint256 public constant FEE_BPS = 30; // 0.3% performance fee

    struct Position {
        bytes32 symbol;
        uint256 shares;   // scaled 1e6
        uint256 avgPrice; // cents
        uint256 openedAt;
    }

    struct UserAccount {
        uint256 usdcBalance;
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        bool exists;
    }

    mapping(address => UserAccount) public accounts;
    mapping(address => Position[]) public positions;
    mapping(address => uint256) public positionCount;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event TradeExecuted(address indexed user, bytes32 symbol, uint8 tradeType, uint256 shares, uint256 priceCents);
    event AgentUpdated(address indexed newAgent);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyAgent() { require(msg.sender == agent || msg.sender == owner, "Not agent"); _; }

    constructor(address _usdc, address _agent) {
        owner = msg.sender;
        agent = _agent;
        usdc = IERC20(_usdc);
    }

    // ── User functions ────────────────────────────────────────────────────

    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (!accounts[msg.sender].exists) {
            accounts[msg.sender].exists = true;
        }
        accounts[msg.sender].usdcBalance += amount;
        accounts[msg.sender].totalDeposited += amount;

        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(accounts[msg.sender].usdcBalance >= amount, "Insufficient balance");
        accounts[msg.sender].usdcBalance -= amount;
        accounts[msg.sender].totalWithdrawn += amount;
        require(usdc.transfer(msg.sender, amount), "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ── Agent functions ───────────────────────────────────────────────────

    function executeBuy(
        address user,
        bytes32 symbol,
        uint256 shares,
        uint256 priceCents
    ) external onlyAgent {
        uint256 cost = (shares * priceCents) / 1e6; // cost in cents * 1e6 / 1e6 = USDC units
        require(accounts[user].usdcBalance >= cost, "Insufficient USDC");

        accounts[user].usdcBalance -= cost;

        // Update or create position
        bool found = false;
        for (uint256 i = 0; i < positions[user].length; i++) {
            if (positions[user][i].symbol == symbol) {
                uint256 totalShares = positions[user][i].shares + shares;
                uint256 newAvg = ((positions[user][i].avgPrice * positions[user][i].shares) +
                    (priceCents * shares)) / totalShares;
                positions[user][i].shares = totalShares;
                positions[user][i].avgPrice = newAvg;
                found = true;
                break;
            }
        }

        if (!found) {
            positions[user].push(Position({
                symbol: symbol,
                shares: shares,
                avgPrice: priceCents,
                openedAt: block.timestamp
            }));
        }

        emit TradeExecuted(user, symbol, 0, shares, priceCents);
    }

    function executeSell(
        address user,
        bytes32 symbol,
        uint256 shares,
        uint256 priceCents
    ) external onlyAgent {
        uint256 proceeds = (shares * priceCents) / 1e6;

        for (uint256 i = 0; i < positions[user].length; i++) {
            if (positions[user][i].symbol == symbol) {
                require(positions[user][i].shares >= shares, "Insufficient shares");
                positions[user][i].shares -= shares;

                // Take fee on profit
                uint256 costBasis = (shares * positions[user][i].avgPrice) / 1e6;
                if (proceeds > costBasis) {
                    uint256 profit = proceeds - costBasis;
                    uint256 fee = (profit * FEE_BPS) / 10000;
                    accounts[owner].usdcBalance += fee;
                    proceeds -= fee;
                }

                accounts[user].usdcBalance += proceeds;

                // Remove position if empty
                if (positions[user][i].shares == 0) {
                    positions[user][i] = positions[user][positions[user].length - 1];
                    positions[user].pop();
                }

                emit TradeExecuted(user, symbol, 1, shares, priceCents);
                return;
            }
        }
        revert("Position not found");
    }

    // ── View functions ────────────────────────────────────────────────────

    function getBalance(address user) external view returns (uint256) {
        return accounts[user].usdcBalance;
    }

    function getPositions(address user) external view returns (Position[] memory) {
        return positions[user];
    }

    function getPositionCount(address user) external view returns (uint256) {
        return positions[user].length;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentUpdated(_agent);
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
