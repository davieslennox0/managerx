const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { chat } = require('../lib/claude');
const { getArbPortfolio } = require('../lib/arbitrum');
const { getSolPortfolio } = require('../lib/solana');

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

router.post('/', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { messages, chain = 'arbitrum' } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'No messages' });

  try {
    let portfolio = {};
    if (chain === 'arbitrum' && user.evm_address) {
      portfolio = await getArbPortfolio(user.evm_address, user.id).catch(() => ({}));
    } else if (chain === 'solana' && user.sol_address) {
      portfolio = await getSolPortfolio(user.sol_address, user.id).catch(() => ({}));
    }

    const reply = await chat({ messages, chain, portfolio });
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Chat failed' });
  }
});

module.exports = router;
