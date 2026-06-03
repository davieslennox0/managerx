const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
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

// Get chat history
router.get('/history/:chain', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const msgs = db.prepare(
    'SELECT role, content FROM conversations WHERE user_id = ? AND chain = ? ORDER BY created_at ASC LIMIT 100'
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
    } else if (chain === 'sui' && user.sui_address) {
      portfolio = await getSolPortfolio(user.sui_address, user.id).catch(() => ({}));
    }

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