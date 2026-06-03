const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'managerx_secret';

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function safeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    evmAddress: u.evm_address,
    solAddress: u.sol_address,
    suiAddress: u.sui_address,
  };
}

// Called after Privy login — frontend sends wallet addresses directly
router.post('/sync', async (req, res) => {
  const { email, name, privyUserId, evmAddress, solAddress, suiAddress } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      const id = uuid();
      db.prepare(`
        INSERT INTO users (id, email, name, evm_address, sol_address, sui_address, privy_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, email, name || '', evmAddress || '', solAddress || '', suiAddress || '', privyUserId || '');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      console.log(`✅ New user: ${email} | EVM: ${evmAddress} | SOL: ${solAddress}`);
    } else {
      // Update wallet addresses if new ones provided
      db.prepare(`
        UPDATE users SET
          evm_address = COALESCE(NULLIF(?, ''), evm_address),
          sol_address = COALESCE(NULLIF(?, ''), sol_address),
          sui_address = COALESCE(NULLIF(?, ''), sui_address)
        WHERE id = ?
      `).run(evmAddress || '', solAddress || '', suiAddress || '', user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    res.json({ user: safeUser(user), token: makeToken(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Auth failed' });
  }
});

router.get('/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { id } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: safeUser(user) });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
