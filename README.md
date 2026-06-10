# ManagerX — AI Portfolio Agent for Tokenized Stocks

> Sui · Solana · CCTP · Jupiter · Claude AI · Dynamic

Built for **Sui Overflow 2026**

---

## Overview

ManagerX is a conversational portfolio agent that lets users buy and sell tokenized US stocks using USDC on Sui. Users interact via natural language — the AI executes trades, bridges funds cross-chain via CCTP, and manages the full lifecycle without the user touching raw transactions.

**Supported assets:** 74 xStocks by Backed Finance (Kraken) — TSLAx, NVDAx, AAPLx, SPYx, QQQx, COINx, MSTRx, CRCLx, and 66+ more. All 1:1 backed by real shares, tradeable 24/7.

---

## How It Works

```
User says "buy $50 of TSLAx"
         ↓
Claude calls execute_action tool (structured, no text parsing)
         ↓
Frontend shows confirmation modal
         ↓
User approves → Frontend builds CCTP burn tx on Sui
         ↓
Agent sponsors gas (user pays zero SUI)
         ↓
User signs → USDC burned on Sui
         ↓
Backend polls Circle attestation (~10–30s)
         ↓
USDC minted on Solana (agent ATA)
         ↓
Jupiter swap: USDC → TSLAx
         ↓
xStock transferred to user's Solana wallet
```

Selling reverses the flow: xStock → agent → Jupiter swap → CCTP → USDC on Sui.

---

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 18, Dynamic SDK |
| Backend | Node.js, Express, SQLite (better-sqlite3) |
| AI | Claude claude-sonnet-4-6 with tool use |
| Auth | Dynamic (Google OAuth + embedded wallets) |
| Primary chain | Sui Mainnet |
| Execution chain | Solana Mainnet (xStock liquidity via Jupiter) |
| Bridge | Circle CCTP V1 (Sui ↔ Solana) |
| Trade execution | Jupiter aggregator |
| Gas sponsorship | Agent-sponsored Sui transactions (user needs no SUI) |
| Trade receipts | Walrus (immutable on-chain storage) |
| xStocks | Backed Finance / Kraken (Token-2022 on Solana) |

---

## Setup

### 1. Install

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
```

Required env vars:

```
ANTHROPIC_API_KEY=
JWT_SECRET=

# Sui
SUI_RPC_URL=https://fullnode.mainnet.sui.io
SUI_AGENT_PRIVATE_KEY=        # suiprivkey1... format
SUI_PACKAGE_ID=
SUI_MANAGER_STATE=
SUI_ADMIN_CAP=

# Solana (execution layer — Jupiter + CCTP)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
AGENT_SOL_PRIVATE_KEY=        # base58 — agent keypair
AGENT_SOL_ADDRESS=            # agent Solana pubkey
AGENT_SOL_USDC_ATA=           # agent's USDC associated token account

# Walrus receipts
RECEIPTS_PACKAGE_ID=
RECEIPTS_REGISTRY_ID=
WALRUS_AGGREGATOR_URL=https://aggregator.walrus.space
WALRUS_PUBLISHER_URL=https://publisher.walrus.space

TRADE_MODE=live               # mock | live
PLATFORM_FEE_BPS=75
```

### 3. Run

```bash
# Backend
cd backend && npm start        # → http://localhost:4000

# Frontend
cd frontend && npm run build
pm2 serve build 3000 --name manager-frontend --spa
```

---

## Deployment (pm2 + Caddy)

```bash
# Backend
pm2 start backend/src/index.js --name manager-backend
pm2 save

# Frontend
cd frontend && npm run build
pm2 serve build 3000 --name manager-frontend --spa
```

Caddy config:

```
yourdomain.com {
    encode gzip

    handle /api/* {
        reverse_proxy localhost:4000
    }

    handle {
        root * /path/to/frontend/build
        try_files {path} /index.html
        file_server
    }
}
```

---

## CCTP Bridge Flow (Sui → Solana)

1. Frontend builds a `deposit_for_burn` transaction on Sui
2. Agent sponsors gas — user signs without needing any SUI
3. USDC is burned on Sui; Circle emits a CCTP message
4. Backend polls Circle Iris API for attestation (~10–30s)
5. `receiveMessage` called on Solana — USDC minted to agent ATA
6. Jupiter swaps USDC → xStock; agent transfers xStock to user's Solana wallet

The reverse (Solana → Sui) uses the same protocol in the other direction for sells.

**Recovery:** If the attestation completes but the Solana-side claim fails, the CCTP message stays valid for 90 days. The backend automatically handles idempotent re-claims — re-submitting with the same `suiTxHash` is safe.

---

## AI Tool Use

Claude uses a structured `execute_action` tool instead of generating JSON-in-markdown. This means:

- No fragile regex parsing on the frontend
- The AI cannot refuse a trade based on its own balance calculations — it calls the tool and the backend validates
- The agent USDC balance (funds already deposited and ready to trade) is visible to the AI alongside wallet balances

---

## Key API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/chat` | Send message, returns `{ reply, action }` |
| POST | `/api/trade/build-burn` | Build Sui CCTP burn tx for user to sign |
| POST | `/api/trade/execute` | Execute buy/sell after user signature |
| POST | `/api/trade/build-sell-transfer` | Build Solana xStock transfer tx for sell |
| POST | `/api/trade/submit-sell-transfer` | Countersign + submit sell transfer |
| POST | `/api/trade/bridge-to-solana` | Bridge USDC Sui→Solana (no trade) |
| POST | `/api/trade/recover-solana-usdc` | Recover stuck USDC from agent wallet |
| GET  | `/api/trade/agent-usdc-balance` | Check agent's pending USDC balance |
| GET  | `/api/portfolio/:chain` | Fetch live portfolio for a chain |

---

Built for **Sui Overflow 2026**
