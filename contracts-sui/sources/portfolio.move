module manager_portfolio::portfolio {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::table::{Self, Table};
    use sui::coin::{Self, Coin};
    use sui::balance::{Self, Balance};
    use sui::event;

    // ── Errors ────────────────────────────────────────────────────────────
    const EInsufficientBalance: u64 = 1;
    const EInsufficientShares: u64 = 2;
    const ENotAgent: u64 = 3;
    const EPositionNotFound: u64 = 4;

    // ── Structs ───────────────────────────────────────────────────────────

    public struct AdminCap has key, store {
        id: UID,
    }

    public struct Position has store, drop {
        symbol: vector<u8>,
        shares: u64,        // scaled 1e6
        avg_price: u64,     // in cents
        opened_at: u64,
    }

    public struct UserPortfolio has key, store {
        id: UID,
        owner: address,
        usdc_balance: u64,
        positions: vector<Position>,
        total_deposited: u64,
        total_withdrawn: u64,
    }

    public struct ManagerState has key {
        id: UID,
        agent: address,
        fee_bps: u64,
        portfolios: Table<address, bool>,
    }

    // ── Events ────────────────────────────────────────────────────────────

    public struct Deposited has copy, drop {
        user: address,
        amount: u64,
    }

    public struct TradeExecuted has copy, drop {
        user: address,
        symbol: vector<u8>,
        trade_type: u8,
        shares: u64,
        price_cents: u64,
    }

    // ── Init ──────────────────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        let state = ManagerState {
            id: object::new(ctx),
            agent: tx_context::sender(ctx),
            fee_bps: 30,
            portfolios: table::new(ctx),
        };
        transfer::transfer(admin_cap, tx_context::sender(ctx));
        transfer::share_object(state);
    }

    // ── User functions ────────────────────────────────────────────────────

    public fun create_portfolio(ctx: &mut TxContext): UserPortfolio {
        UserPortfolio {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            usdc_balance: 0,
            positions: vector::empty(),
            total_deposited: 0,
            total_withdrawn: 0,
        }
    }

    public fun deposit<USDC>(
        portfolio: &mut UserPortfolio,
        coin: Coin<USDC>,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&coin);
        portfolio.usdc_balance = portfolio.usdc_balance + amount;
        portfolio.total_deposited = portfolio.total_deposited + amount;
        // In production: store coin in vault
        // For hackathon: burn/transfer to contract
        transfer::public_transfer(coin, tx_context::sender(ctx));
        event::emit(Deposited { user: portfolio.owner, amount });
    }

    // ── Agent functions ───────────────────────────────────────────────────

    public fun execute_buy(
        state: &ManagerState,
        portfolio: &mut UserPortfolio,
        symbol: vector<u8>,
        shares: u64,
        price_cents: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == state.agent, ENotAgent);
        let cost = (shares * price_cents) / 1000000;
        assert!(portfolio.usdc_balance >= cost, EInsufficientBalance);

        portfolio.usdc_balance = portfolio.usdc_balance - cost;

        // Find existing position
        let positions = &mut portfolio.positions;
        let len = vector::length(positions);
        let mut i = 0;
        let mut found = false;

        while (i < len) {
            let pos = vector::borrow_mut(positions, i);
            if (pos.symbol == symbol) {
                let total_shares = pos.shares + shares;
                let new_avg = ((pos.avg_price * pos.shares) + (price_cents * shares)) / total_shares;
                pos.shares = total_shares;
                pos.avg_price = new_avg;
                found = true;
                break
            };
            i = i + 1;
        };

        if (!found) {
            vector::push_back(positions, Position {
                symbol,
                shares,
                avg_price: price_cents,
                opened_at: 0,
            });
        };

        event::emit(TradeExecuted {
            user: portfolio.owner,
            symbol,
            trade_type: 0,
            shares,
            price_cents,
        });
    }

    public fun execute_sell(
        state: &ManagerState,
        portfolio: &mut UserPortfolio,
        symbol: vector<u8>,
        shares: u64,
        price_cents: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == state.agent, ENotAgent);

        let positions = &mut portfolio.positions;
        let len = vector::length(positions);
        let mut i = 0;

        while (i < len) {
            let pos = vector::borrow_mut(positions, i);
            if (pos.symbol == symbol) {
                assert!(pos.shares >= shares, EInsufficientShares);
                let proceeds = (shares * price_cents) / 1000000;
                pos.shares = pos.shares - shares;
                portfolio.usdc_balance = portfolio.usdc_balance + proceeds;

                if (pos.shares == 0) {
                    vector::remove(positions, i);
                };

                event::emit(TradeExecuted {
                    user: portfolio.owner,
                    symbol,
                    trade_type: 1,
                    shares,
                    price_cents,
                });
                return
            };
            i = i + 1;
        };

        abort EPositionNotFound
    }

    // ── View ──────────────────────────────────────────────────────────────

    public fun get_balance(portfolio: &UserPortfolio): u64 {
        portfolio.usdc_balance
    }

    public fun get_position_count(portfolio: &UserPortfolio): u64 {
        vector::length(&portfolio.positions)
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    public fun set_agent(
        _: &AdminCap,
        state: &mut ManagerState,
        new_agent: address,
    ) {
        state.agent = new_agent;
    }
}
