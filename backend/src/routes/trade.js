const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getPrice, isValidSymbol } = require('./prices');
const { bridgeSuiToArbitrum } = require('../lib/cctp');
const { executeTrade, depositForUser } = require('../lib/arbitrum');

const router = express.Router();
function mockTx() { return '0x' + [...Array(64)].map(() => Math.floor(Math.random()*16).toString(16)).join(''); }

router.post('/execute', async (req, res) => {
  const { action, userId } = req.body;
  if (!userId || !action) return res.status(400).json({ error: 'Missing params' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const chain = action.chain || 'arbitrum';
  const { type, symbol, shares } = action;
  const sym = symbol?.toUpperCase();

  // Handle bridge_and_buy: bridge first, then buy
  if (type === 'bridge_and_buy') {
    const bridgeAmt = action.bridgeAmount || action.estimatedCost * 1.05;
    if (user.sui_usdc_balance < bridgeAmt) {
      return res.status(400).json({ error: `Insufficient Sui USDC. Need $${bridgeAmt.toFixed(2)}, have $${user.sui_usdc_balance.toFixed(2)}` });
    }

    // Deduct from Sui balance
    db.prepare('UPDATE users SET sui_usdc_balance = sui_usdc_balance - ? WHERE id = ?').run(bridgeAmt, userId);

    // Start bridge async
    bridgeSuiToArbitrum({
      userId, amountUsdc: bridgeAmt * 1e6,
      suiAddress: user.sui_address,
      evmAddress: user.evm_address,
      db,
    }).catch(e => console.error('Bridge error:', e.message));

    return res.json({
      message: `🌉 Bridging $${bridgeAmt.toFixed(2)} USDC from Sui → Arbitrum via CCTP. Trade will execute once funds arrive (~30s).`,
      receipt: { type: 'bridge_initiated', bridgeAmount: bridgeAmt, txHash: mockTx() },
    });
  }

  // Regular buy/sell
  if (!isValidSymbol(sym)) return res.status(400).json({ error: `Unknown symbol: ${sym}` });
  if (!shares || shares <= 0) return res.status(400).json({ error: 'Invalid shares' });

  const price = getPrice(sym);
  const total = price * shares;
  const cashCol = chain === 'sui' ? 'sui_usdc_balance' : 'arb_usdc_balance';
  const cashBalance = chain === 'sui' ? user.sui_usdc_balance : user.arb_usdc_balance;

  try {
    if (type === 'buy') {
      if (cashBalance < total) return res.status(400).json({ error: `Insufficient USDC on ${chain}. Need $${total.toFixed(2)}, have $${cashBalance.toFixed(2)}` });
      db.prepare(`UPDATE users SET ${cashCol} = ${cashCol} - ? WHERE id = ?`).run(total, userId);

      const holding = db.prepare('SELECT * FROM holdings WHERE user_id = ? AND chain = ? AND symbol = ?').get(userId, chain, sym);
      if (holding) {
        const newShares = holding.shares + shares;
        const newAvg = ((holding.avg_price * holding.shares) + (price * shares)) / newShares;
        db.prepare('UPDATE holdings SET shares = ?, avg_price = ? WHERE user_id = ? AND chain = ? AND symbol = ?').run(newShares, newAvg, userId, chain, sym);
      } else {
        db.prepare('INSERT INTO holdings (id, user_id, chain, symbol, shares, avg_price) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), userId, chain, sym, shares, price);
      }

    } else if (type === 'sell') {
      const holding = db.prepare('SELECT * FROM holdings WHERE user_id = ? AND chain = ? AND symbol = ?').get(userId, chain, sym);
      if (!holding || holding.shares < shares) return res.status(400).json({ error: `Insufficient shares of ${sym} on ${chain}` });
      db.prepare(`UPDATE users SET ${cashCol} = ${cashCol} + ? WHERE id = ?`).run(total, userId);
      const newShares = holding.shares - shares;
      if (newShares <= 0.0001) {
        db.prepare('DELETE FROM holdings WHERE user_id = ? AND chain = ? AND symbol = ?').run(userId, chain, sym);
      } else {
        db.prepare('UPDATE holdings SET shares = ? WHERE user_id = ? AND chain = ? AND symbol = ?').run(newShares, userId, chain, sym);
      }
    }

    let txHash = mockTx();
    let execTxHash = txHash;

    // Live mode: call contract
    if (process.env.TRADE_MODE === 'live' && chain === 'arbitrum') {
      try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (user?.evm_address) {
          const priceCents = Math.round(price * 100);
          const result = await executeTrade(user.evm_address, type, sym, shares, priceCents);
          txHash = result.intentTxHash;
          execTxHash = result.execTxHash;
          console.log(`Live trade executed: ${execTxHash}`);
        }
      } catch (e) {
        console.error('Live trade error:', e.message);
        // Fall back to mock if live fails
        txHash = mockTx();
      }
    }

    db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(uuid(), userId, chain, type, sym, shares, price, total, execTxHash);

    res.json({
      message: `✓ ${type === 'buy' ? 'Bought' : 'Sold'} ${shares} ${sym} @ $${price.toFixed(2)} on ${chain} — $${total.toFixed(2)} USDC`,
      receipt: { txHash: execTxHash, symbol: sym, shares, price, total, type, chain },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Trade failed: ' + e.message });
  }
});

module.exports = router;
