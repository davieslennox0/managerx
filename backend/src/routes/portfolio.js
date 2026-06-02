const express = require('express');
const db = require('../db');
const { getPrice } = require('./prices');

const router = express.Router();
function getUserId(req) { return req.headers['x-user-id'] || req.body?.userId; }

router.get('/', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const arbHoldings = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND chain = 'arbitrum'").all(userId);
  const suiHoldings = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND chain = 'sui'").all(userId);

  let arbValue = 0, arbCost = 0;
  const enrichArb = arbHoldings.map(h => {
    const p = getPrice(h.symbol) || h.avg_price;
    const v = p * h.shares;
    arbValue += v; arbCost += h.avg_price * h.shares;
    return { symbol: h.symbol, shares: h.shares, avgPrice: h.avg_price, currentPrice: p, currentValue: v, chain: 'arbitrum' };
  });

  let suiValue = 0;
  const enrichSui = suiHoldings.map(h => {
    const p = getPrice(h.symbol) || h.avg_price;
    const v = p * h.shares;
    suiValue += v;
    return { symbol: h.symbol, shares: h.shares, avgPrice: h.avg_price, currentPrice: p, currentValue: v, chain: 'sui' };
  });

  res.json({
    arbHoldings: enrichArb, suiHoldings: enrichSui,
    arbCashBalance: user.arb_usdc_balance,
    suiCashBalance: user.sui_usdc_balance,
    arbStockValue: arbValue, suiStockValue: suiValue,
    totalValue: arbValue + suiValue + user.arb_usdc_balance + user.sui_usdc_balance,
    evmAddress: user.evm_address, suiAddress: user.sui_address,
  });
});

router.get('/history', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const history = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50').all(userId);
  res.json({ history });
});

module.exports = router;
