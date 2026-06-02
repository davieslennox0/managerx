# Manager v2 — Multi-Chain AI Portfolio Agent

> Sui + Arbitrum · zkLogin · Privy · CCTP · Claude AI

---

## What's New in v2

| Feature | v1 | v2 |
|---------|----|----|
| Auth | Email/password | Email + **Google OAuth (Privy)** + zkLogin |
| Chains | Arbitrum only | **Arbitrum + Sui** |
| Wallets | None | **Privy embedded EVM** + Sui zkLogin |
| Bridge | None | **CCTP (Circle)** Sui → Arbitrum auto-bridge |
| Stocks | Robinhood tokenized | Robinhood (ARB) + **stocksrwa.io (Sui)** |
| AI | Claude basic | Claude with **chain-aware context + bridge logic** |

---

## Architecture

```
Google Login (Privy)
       ↓
Privy creates EVM wallet (Arbitrum)     zkLogin creates Sui wallet
       ↓                                        ↓
Manager links both wallets to one email in DB
       ↓
User says "Buy 5 NVDAX"
       ↓
Claude checks: ARB USDC balance sufficient?
  YES → Execute trade on Arbitrum (Robinhood tokenized)
  NO  → Check Sui USDC balance
          YES → CCTP bridge Sui→ARB automatically → Execute trade
          NO  → "Insufficient funds on both chains"
```

---

## Setup

### 1. Install

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure Backend

```bash
cp .env.example .env
nano .env
```

Required:
```
ANTHROPIC_API_KEY=your_key
ANTHROPIC_BASE_URL=https://cc.freemodel.dev
JWT_SECRET=random_string
PRIVY_APP_ID=cmpeku47e000l0ci6ejcg63m5
PRIVY_SECRET=privy_app_secret_4YcFn...
TRADE_MODE=mock
```

### 3. Run Backend

```bash
cd backend && npm start
# → http://localhost:4000
```

### 4. Run Frontend

```bash
cd frontend && npm run build
# Serve build folder via Caddy / serve
```

---

## Deploying to managerx.duckdns.org

### Backend (pm2)

```bash
cd backend
pm2 delete manager-backend 2>/dev/null
pm2 start src/index.js --name manager-backend
pm2 save
```

### Frontend (static build)

```bash
cd frontend
npm run build
pm2 serve build 3000 --name manager-frontend --spa
# OR update Caddy to serve build/ directly
```

### Caddy config

```
managerx.duckdns.org {
    encode gzip

    handle /api/* {
        reverse_proxy localhost:4000
    }

    handle {
        root * /root/manager-v2/frontend/build
        try_files {path} /index.html
        file_server
    }
}
```

---

## Smart Contracts

### Arbitrum (Solidity + Foundry)

```bash
cd contracts-arb
forge install
forge test -v

# Deploy to Arbitrum Sepolia
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $PRIVATE_KEY \
  --broadcast --verify
```

### Sui (Move)

```bash
cd contracts-sui

# Install Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install

# Build
sui move build

# Test
sui move test

# Deploy to Sui Mainnet
sui client publish --gas-budget 100000000
```

---

## CCTP Bridge Flow

1. User has USDC on Sui, wants to buy stock on Arbitrum
2. Manager AI detects insufficient ARB balance
3. Agent calls `initiate_bridge` on Sui contract → emits burn event
4. Circle attestation service signs the burn (~15-30s)
5. Backend calls `receiveMessage` on Arbitrum transmitter
6. USDC minted on Arbitrum to user's Privy EVM wallet
7. Trade executes automatically

**Circle CCTP docs:** https://developers.circle.com/stablecoins/cctp-getting-started

---

## zkLogin Flow (Sui)

1. User clicks "Sign in with Google"
2. OAuth JWT issued by Google
3. Sui zkLogin derives deterministic Sui address from JWT + salt
4. No seed phrase, no private key management
5. Privy simultaneously creates matching EVM wallet for Arbitrum

**Sui zkLogin docs:** https://docs.sui.io/concepts/cryptography/zklogin

---

## Privy Setup

1. Go to https://privy.io → create app
2. Enable Google OAuth under Login Methods
3. Enable Ethereum embedded wallets with "Create on login"
4. Copy App ID + Secret to .env

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Privy SDK |
| Backend | Node.js, Express, SQLite |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Auth | Privy (Google OAuth + embedded wallets) |
| Sui Auth | zkLogin |
| Bridge | Circle CCTP |
| ARB Chain | Arbitrum One |
| Sui Chain | Sui Mainnet |
| ARB Stocks | Robinhood tokenized (1,997 assets) |
| Sui Stocks | stocksrwa.io (AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, SPY, MSTR) |
| ARB Contract | Solidity 0.8.24, Foundry |
| Sui Contract | Move 2024, Sui CLI |

---

Built for **Arbitrum Open House Buildathon** · May 2026
