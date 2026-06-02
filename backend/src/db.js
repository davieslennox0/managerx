const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../manager_v2.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    name TEXT,
    -- Wallet addresses
    sui_address TEXT,
    evm_address TEXT,
    privy_user_id TEXT,
    -- Balances per chain
    sui_usdc_balance REAL DEFAULT 0,
    arb_usdc_balance REAL DEFAULT 10000.00,
    -- Auth
    auth_type TEXT DEFAULT 'email',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'arbitrum',
    symbol TEXT NOT NULL,
    shares REAL NOT NULL DEFAULT 0,
    avg_price REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, chain, symbol)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'arbitrum',
    type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    shares REAL NOT NULL,
    price REAL NOT NULL,
    total REAL NOT NULL,
    tx_hash TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bridge_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_usdc REAL NOT NULL,
    from_chain TEXT NOT NULL,
    to_chain TEXT NOT NULL,
    from_address TEXT,
    to_address TEXT,
    cctp_nonce TEXT,
    attestation TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;
