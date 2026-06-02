/// Manager Portfolio — Sui Mainnet
/// Tracks positions, enforces safety guards, logs AI agent trade intents.
/// Integrates with stocksrwa.io for tokenized RWA stocks.
/// CCTP burn handled by manager_sui::bridge module.
module manager_sui::portfolio {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::event;
    use sui::coin::{Self, Coin};
    use std::string::{Self, String};
    use std::vector;

    // ─── Error Codes ──────────────────────────────────────────────────────────
    const E_UNAUTHORIZED: u64       = 1;
    const E_INSUFFICIENT_FUNDS: u64 = 2;
    const E_INSUFFICIENT_SHARES: u64= 3;
    const E_ALREADY_PROCESSED: u64  = 4;
    const E_GUARD_VIOLATION: u64    = 5;

    // ─── Constants ────────────────────────────────────────────────────────────
    const MAX_TRADE_PCT: u64    = 40;           // 40% of portfolio per trade
    const MAX_POSITION_PCT: u64 = 50;           // 50% max single position
    const MIN_CASH_BUFFER: u64  = 500_000_000;  // $500 USDC (6 decimals)
    const TRADE_BUY: u8         = 0;
    const TRADE_SELL: u8        = 1;
    const STATUS_PENDING: u8    = 0;
    const STATUS_EXECUTED: u8   = 1;
    const STATUS_CANCELLED: u8  = 2;

    // ─── Structs ──────────────────────────────────────────────────────────────

    /// Shared global registry
    struct Registry has key {
        id: UID,
        agent: address,
        owner: address,
        total_users: u64,
    }

    /// Admin capability
    struct AdminCap has key, store { id: UID }

    /// Per-user portfolio object (owned by user)
    struct Portfolio has key, store {
        id: UID,
        owner: address,
        cash_balance: u64,      // USDC, 6 decimals
        holdings: Table<String, Position>,
        intent_count: u64,
    }

    struct Position has store, drop {
        symbol: String,
        shares: u64,            // scaled 1e6
        avg_price: u64,         // USDC cents (1 USD = 100)
        last_updated: u64,
    }

    struct TradeIntent has key, store {
        id: UID,
        owner: address,
        trade_type: u8,
        symbol: String,
        shares: u64,
        price: u64,
        status: u8,
        timestamp: u64,
        tx_digest: vector<u8>,
    }

    // ─── Events ───────────────────────────────────────────────────────────────
    struct IntentSubmitted has copy, drop {
        intent_id: ID,
        owner: address,
        trade_type: u8,
        symbol: String,
        shares: u64,
        price: u64,
    }

    struct IntentExecuted has copy, drop {
        intent_id: ID,
        owner: address,
        symbol: String,
        trade_type: u8,
        total_usdc: u64,
    }

    struct IntentCancelled has copy, drop {
        intent_id: ID,
        owner: address,
        reason: String,
    }

    struct BridgeInitiated has copy, drop {
        owner: address,
        amount_usdc: u64,
        dest_chain: u32,
        dest_address: vector<u8>,
    }

    struct PositionUpdated has copy, drop {
        owner: address,
        symbol: String,
        new_shares: u64,
        new_avg_price: u64,
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let admin_cap = AdminCap { id: object::new(ctx) };
        let registry = Registry {
            id: object::new(ctx),
            agent: sender,
            owner: sender,
            total_users: 0,
        };
        transfer::share_object(registry);
        transfer::transfer(admin_cap, sender);
    }

    // ─── Portfolio Management ─────────────────────────────────────────────────

    /// Create a new portfolio for a user (called by agent on first login)
    public entry fun create_portfolio(
        registry: &mut Registry,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let portfolio = Portfolio {
            id: object::new(ctx),
            owner: sender,
            cash_balance: 0,
            holdings: table::new(ctx),
            intent_count: 0,
        };
        registry.total_users = registry.total_users + 1;
        transfer::transfer(portfolio, sender);
    }

    /// Agent deposits USDC into user portfolio (after CCTP mint or direct deposit)
    public entry fun deposit(
        portfolio: &mut Portfolio,
        amount: u64,
        registry: &Registry,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == registry.agent || sender == portfolio.owner,
            E_UNAUTHORIZED
        );
        portfolio.cash_balance = portfolio.cash_balance + amount;
    }

    // ─── Trade Intents ────────────────────────────────────────────────────────

    /// Agent submits a trade intent — validates guards, creates intent object
    public entry fun submit_intent(
        portfolio: &mut Portfolio,
        trade_type: u8,
        symbol: vector<u8>,
        shares: u64,
        price: u64,
        registry: &Registry,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == registry.agent || sender == portfolio.owner,
            E_UNAUTHORIZED
        );

        let sym = string::utf8(symbol);
        let trade_value = (shares * price) / 1_000_000;

        // Safety guard: sufficient cash for buy
        if (trade_type == TRADE_BUY) {
            assert!(portfolio.cash_balance >= trade_value, E_INSUFFICIENT_FUNDS);
            // Cash buffer warning (non-blocking for buildathon)
            let _ = portfolio.cash_balance - trade_value >= MIN_CASH_BUFFER;
        } else {
            // Sufficient shares for sell
            assert!(table::contains(&portfolio.holdings, sym), E_INSUFFICIENT_SHARES);
            let pos = table::borrow(&portfolio.holdings, sym);
            assert!(pos.shares >= shares, E_INSUFFICIENT_SHARES);
        };

        let intent = TradeIntent {
            id: object::new(ctx),
            owner: portfolio.owner,
            trade_type,
            symbol: sym,
            shares,
            price,
            status: STATUS_PENDING,
            timestamp: tx_context::epoch(ctx),
            tx_digest: vector::empty(),
        };

        let intent_id = object::id(&intent);
        portfolio.intent_count = portfolio.intent_count + 1;

        event::emit(IntentSubmitted {
            intent_id,
            owner: portfolio.owner,
            trade_type,
            symbol: string::utf8(symbol),
            shares,
            price,
        });

        // Transfer intent to agent for execution tracking
        transfer::transfer(intent, sender);
    }

    /// Execute a confirmed intent
    public entry fun execute_intent(
        intent: &mut TradeIntent,
        portfolio: &mut Portfolio,
        ctx: &mut TxContext
    ) {
        assert!(intent.status == STATUS_PENDING, E_ALREADY_PROCESSED);

        let trade_value = (intent.shares * intent.price) / 1_000_000;
        let sym = intent.symbol;

        if (intent.trade_type == TRADE_BUY) {
            assert!(portfolio.cash_balance >= trade_value, E_INSUFFICIENT_FUNDS);
            portfolio.cash_balance = portfolio.cash_balance - trade_value;
            add_position(portfolio, sym, intent.shares, intent.price, ctx);
        } else {
            assert!(table::contains(&portfolio.holdings, sym), E_INSUFFICIENT_SHARES);
            let pos = table::borrow(&portfolio.holdings, sym);
            assert!(pos.shares >= intent.shares, E_INSUFFICIENT_SHARES);
            portfolio.cash_balance = portfolio.cash_balance + trade_value;
            remove_position(portfolio, sym, intent.shares);
        };

        intent.status = STATUS_EXECUTED;

        event::emit(IntentExecuted {
            intent_id: object::id(intent),
            owner: portfolio.owner,
            symbol: sym,
            trade_type: intent.trade_type,
            total_usdc: trade_value,
        });
    }

    /// Cancel an intent
    public entry fun cancel_intent(
        intent: &mut TradeIntent,
        reason: vector<u8>,
        ctx: &mut TxContext
    ) {
        assert!(intent.status == STATUS_PENDING, E_ALREADY_PROCESSED);
        let sender = tx_context::sender(ctx);
        assert!(sender == intent.owner, E_UNAUTHORIZED);
        intent.status = STATUS_CANCELLED;
        event::emit(IntentCancelled {
            intent_id: object::id(intent),
            owner: intent.owner,
            reason: string::utf8(reason),
        });
    }

    // ─── Position Helpers ─────────────────────────────────────────────────────

    fun add_position(
        portfolio: &mut Portfolio,
        symbol: String,
        shares: u64,
        price: u64,
        _ctx: &mut TxContext
    ) {
        if (table::contains(&portfolio.holdings, symbol)) {
            let pos = table::borrow_mut(&mut portfolio.holdings, symbol);
            let total_cost = (pos.shares * pos.avg_price) + (shares * price);
            let total_shares = pos.shares + shares;
            pos.avg_price = total_cost / total_shares;
            pos.shares = total_shares;
        } else {
            let pos = Position {
                symbol,
                shares,
                avg_price: price,
                last_updated: 0,
            };
            table::add(&mut portfolio.holdings, symbol, pos);
        };
        event::emit(PositionUpdated {
            owner: portfolio.owner,
            symbol,
            new_shares: shares,
            new_avg_price: price,
        });
    }

    fun remove_position(
        portfolio: &mut Portfolio,
        symbol: String,
        shares: u64,
    ) {
        let pos = table::borrow_mut(&mut portfolio.holdings, symbol);
        pos.shares = pos.shares - shares;
        if (pos.shares == 0) {
            let Position { symbol: _, shares: _, avg_price: _, last_updated: _ } =
                table::remove(&mut portfolio.holdings, symbol);
        };
    }

    // ─── Emit Bridge Event (CCTP) ─────────────────────────────────────────────

    /// Emit bridge intent — actual CCTP burn handled offchain by agent
    public entry fun initiate_bridge(
        portfolio: &mut Portfolio,
        amount_usdc: u64,
        dest_chain: u32,        // 3 = Arbitrum
        dest_address: vector<u8>,
        registry: &Registry,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == registry.agent || sender == portfolio.owner,
            E_UNAUTHORIZED
        );
        assert!(portfolio.cash_balance >= amount_usdc, E_INSUFFICIENT_FUNDS);
        portfolio.cash_balance = portfolio.cash_balance - amount_usdc;
        event::emit(BridgeInitiated {
            owner: portfolio.owner,
            amount_usdc,
            dest_chain,
            dest_address,
        });
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────
    public fun get_cash_balance(portfolio: &Portfolio): u64 { portfolio.cash_balance }
    public fun get_owner(portfolio: &Portfolio): address { portfolio.owner }
    public fun get_intent_count(portfolio: &Portfolio): u64 { portfolio.intent_count }
}
