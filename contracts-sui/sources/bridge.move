/// Manager Bridge — CCTP Circle Cross-Chain Transfer Protocol
/// Burns USDC on Sui, triggers mint on Arbitrum via Circle's attestation service.
/// Arbitrum domain ID = 3
module manager_sui::bridge {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use std::vector;

    // Circle CCTP domain IDs
    const DOMAIN_ARBITRUM: u32 = 3;
    const DOMAIN_SUI: u32      = 8;

    // Error codes
    const E_INVALID_AMOUNT: u64   = 1;
    const E_INVALID_DEST: u64     = 2;
    const E_UNAUTHORIZED: u64     = 3;

    struct BridgeRequest has key, store {
        id: UID,
        requester: address,
        amount_usdc: u64,
        dest_domain: u32,
        dest_address: vector<u8>,   // EVM address bytes (20 bytes)
        nonce: u64,
        status: u8,                 // 0=pending, 1=attested, 2=minted
    }

    struct BridgeRequestCreated has copy, drop {
        request_id: address,
        requester: address,
        amount_usdc: u64,
        dest_domain: u32,
        dest_address: vector<u8>,
        nonce: u64,
    }

    struct BridgeAttested has copy, drop {
        request_id: address,
        attestation: vector<u8>,
    }

    /// Create a bridge request — agent calls CCTP burn after this
    public entry fun create_bridge_request(
        amount_usdc: u64,
        dest_address: vector<u8>,   // user's Privy EVM wallet address
        nonce: u64,
        ctx: &mut TxContext
    ) {
        assert!(amount_usdc > 0, E_INVALID_AMOUNT);
        assert!(vector::length(&dest_address) == 20, E_INVALID_DEST);

        let requester = tx_context::sender(ctx);
        let request = BridgeRequest {
            id: object::new(ctx),
            requester,
            amount_usdc,
            dest_domain: DOMAIN_ARBITRUM,
            dest_address,
            nonce,
            status: 0,
        };

        let request_id = object::uid_to_address(&request.id);

        event::emit(BridgeRequestCreated {
            request_id,
            requester,
            amount_usdc,
            dest_domain: DOMAIN_ARBITRUM,
            dest_address,
            nonce,
        });

        // Keep request as owned object for status tracking
        transfer::transfer(request, requester);
    }

    /// Mark bridge as attested (called by agent after Circle attestation)
    public entry fun mark_attested(
        request: &mut BridgeRequest,
        attestation: vector<u8>,
        ctx: &mut TxContext
    ) {
        request.status = 1;
        event::emit(BridgeAttested {
            request_id: object::uid_to_address(&request.id),
            attestation,
        });
    }

    public fun get_dest_address(req: &BridgeRequest): vector<u8> { req.dest_address }
    public fun get_amount(req: &BridgeRequest): u64 { req.amount_usdc }
    public fun get_status(req: &BridgeRequest): u8 { req.status }
}
