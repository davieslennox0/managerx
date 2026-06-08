const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { chat } = require('../lib/claude');
const { getArbPortfolio } = require('../lib/arbitrum');
const { getSolPortfolio } = require('../lib/solana');
const { getPrice } = require('./prices');

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

// Get chat history
router.get('/history/:chain', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const msgs = db.prepare(
    `SELECT role, content FROM (
       SELECT role, content, created_at FROM conversations
       WHERE user_id = ? AND chain = ?
       ORDER BY created_at DESC LIMIT 100
     ) ORDER BY created_at ASC`
  ).all(user.id, req.params.chain);
  res.json({ messages: msgs });
});

// Clear chat history
router.delete('/history/:chain', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  db.prepare('DELETE FROM conversations WHERE user_id = ? AND chain = ?').run(user.id, req.params.chain);
  res.json({ ok: true });
});

router.post('/', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { messages, chain = 'arbitrum' } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });

  try {
    let portfolio = {};
    if (chain === 'arbitrum' && user.evm_address) {
      portfolio = await getArbPortfolio(user.evm_address, user.id).catch(() => ({}));
    } else if (chain === 'sui') {
      // Fetch real on-chain Sui USDC balance
      const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
      const suiClient = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
      let suiUsdcBalance = 0;
      if (user.sui_address) {
        try {
          const coins = await suiClient.getCoins({
            owner: user.sui_address,
            coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          });
          suiUsdcBalance = coins.data.reduce((acc, c) => acc + Number(c.balance), 0) / 1e6;
        } catch(e) { console.error('Sui balance error:', e.message); }
      }
      portfolio = {
        chain: 'sui',
        usdcBalance: suiUsdcBalance,
        suiAddress: user.sui_address || 'Not connected',
        solAddress: user.sol_address || 'Not connected',
        positions: [],
      };
    }

    // Fetch live prices for top assets
    const topSymbols = chain === 'arbitrum'
      ? ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'COIN', 'MSTR', 'NFLX']
      : ['TSLA', 'AAPL', 'NVDA', 'SPY', 'META', 'MSFT', 'GOOGL', 'AMZN', 'COIN', 'MSTR',
         'PLTR', 'NFLX', 'JPM', 'GS', 'BAC', 'MA', 'V', 'WMT', 'MCD', 'HOOD'];
    const priceResults = await Promise.all(topSymbols.map(async s => {
      const p = await getPrice(s).catch(() => null);
      return p ? `${s}: ${p.price}` : null;
    }));
    const livePrices = priceResults.filter(Boolean).join(', ');
    portfolio.livePrices = livePrices;

    const reply = await chat({ messages, chain, portfolio });

    // Save last user message + reply
    const lastUser = messages[messages.length - 1];
    db.prepare('INSERT INTO conversations (id, user_id, chain, role, content) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, 'user', lastUser.content);
    db.prepare('INSERT INTO conversations (id, user_id, chain, role, content) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, 'assistant', reply);

    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Chat failed' });
  }
});

module.exports = router;