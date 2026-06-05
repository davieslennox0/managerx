const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getPrice } = require('./prices');
const { executeArbTrade } = require('../lib/arbitrum');
const { executeSuiTrade } = require('../lib/sui');
const { jupiterSwap } = require('../lib/solana');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'managerx_secret';

function authUser(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  } catch { return null; }
}

router.post('/execute', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { chain, action } = req.body;
  if (!chain || !action) return res.status(400).json({ error: 'Missing params' });

  const { type, symbol, amount, currency } = action;
  if (!type || !symbol) return res.status(400).json({ error: 'Missing action params' });

  try {
    // Get current price
    const sym = symbol.replace('X', '').replace('x', '').toUpperCase();
    const priceData = await getPrice(sym);
    const price = parseFloat(priceData?.price || 0);
    if (!price) return res.status(400).json({ error: `No price data for ${symbol}` });

    // Calculate shares
    const shares = currency === 'usd' ? amount / price : amount;
    const priceCents = Math.round(price * 100);
    const total = shares * price;

    let txHash = null;

    if (process.env.TRADE_MODE === 'live') {
      if (chain === 'arbitrum' && user.evm_address) {
        const result = await executeArbTrade(user.evm_address, type, symbol, shares, priceCents);
        txHash = result.txHash;
      } else if (chain === 'sui') {
        // Agent executes on Jupiter (Solana) on behalf of user
        const usdcAmount = currency === 'usd' ? amount : shares * price;
        const result = await jupiterSwap(
          process.env.AGENT_SOL_ADDRESS,
          symbol,
          usdcAmount
        );
        txHash = result.txHash;
      }
    } else {
      txHash = '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    }

    // Track position in DB
    const holding = db.prepare(
      'SELECT * FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?'
    ).get(user.id, chain, symbol);

    if (type === 'buy') {
      if (holding) {
        const newShares = holding.shares + shares;
        const newAvg = ((holding.avg_price * holding.shares) + (price * shares)) / newShares;
        db.prepare('UPDATE positions SET shares = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(newShares, newAvg, user.id, chain, symbol);
      } else {
        db.prepare('INSERT INTO positions (id, user_id, chain, symbol, shares, avg_price) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), user.id, chain, symbol, shares, price);
      }
    } else if (type === 'sell') {
      if (!holding || holding.shares < shares) {
        return res.status(400).json({ error: `Insufficient ${symbol} shares` });
      }
      const newShares = holding.shares - shares;
      if (newShares < 0.0001) {
        db.prepare('DELETE FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(user.id, chain, symbol);
      } else {
        db.prepare('UPDATE positions SET shares = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(newShares, user.id, chain, symbol);
      }
    }

    // Record transaction
    db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, type, symbol, shares, price, total, txHash);

    res.json({
      success: true,
      message: `${type === 'buy' ? 'Bought' : 'Sold'} ${shares.toFixed(6)} ${symbol} @ $${price.toFixed(2)}`,
      txHash,
      total: total.toFixed(2),
    });

  } catch (e) {
    console.error('Trade error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get transaction history
router.get('/history', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const txs = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);
  res.json({ transactions: txs });
});

module.exports = router;
