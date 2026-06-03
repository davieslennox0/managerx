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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
