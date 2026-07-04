const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../manager_v2.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    evm_address TEXT,
    sol_address TEXT,
    sui_address TEXT,
    privy_user_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    symbol TEXT NOT NULL,
    shares REAL NOT NULL,
    avg_price REAL NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, chain, symbol)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    shares REAL,
    price REAL,
    total REAL,
    tx_hash TEXT,
    status TEXT DEFAULT 'success',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing transactions table to add status/error columns if missing
try {
  db.exec(`ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'success'`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE transactions ADD COLUMN error TEXT`);
} catch (_) {}

module.exports = db;

// Create bridge_transactions table for recovery
db.exec(`
  CREATE TABLE IF NOT EXISTS bridge_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    status TEXT DEFAULT 'burn_pending',
    sui_tx_hash TEXT,
    message_hash TEXT,
    attestation TEXT,
    sol_mint_tx TEXT,
    jupiter_tx TEXT,
    amount REAL,
    symbol TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Per-user ledger of USDC that landed in the shared agent Solana ATA but failed to
// bridge onward. recover-solana-usdc sums each user's own unconsumed rows here instead
// of trusting a client-supplied amount against the pool's total balance — the pool is
// shared across all users, so nothing else scopes a recovery to the right owner.
db.exec(`
  CREATE TABLE IF NOT EXISTS pending_recoveries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    raw_amount INTEGER NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    consumed_at DATETIME
  )
`);
