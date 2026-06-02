const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getOrCreatePrivyUser } = require('../lib/privy');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'manager_v2_secret';

// Helper: create JWT
function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

// Helper: safe user response
function safeUser(u) {
  return {
    id: u.id, email: u.email, name: u.name,
    suiAddress: u.sui_address, evmAddress: u.evm_address,
    authType: u.auth_type,
  };
}

// ── Email / Password ──────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  try {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(409).json({ error: 'Account already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const id = uuid();

    // Create Privy EVM wallet silently
    const privy = await getOrCreatePrivyUser(email);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, evm_address, privy_user_id, auth_type, arb_usdc_balance)
      VALUES (?, ?, ?, ?, ?, ?, 'email', 10000)
    `).run(id, email, hash, name || '', privy.evmAddress || '', privy.privyUserId || '');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json({ user: safeUser(user), token: makeToken(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    // Ensure EVM wallet exists
    if (!user.evm_address) {
      const privy = await getOrCreatePrivyUser(email);
      db.prepare('UPDATE users SET evm_address = ?, privy_user_id = ? WHERE id = ?')
        .run(privy.evmAddress || '', privy.privyUserId || '', user.id);
    }

    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.json({ user: safeUser(fresh), token: makeToken(fresh) });
  } catch (e) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── Google OAuth via Privy ────────────────────────────────────────────────────

router.post('/google', async (req, res) => {
  const { privyToken, email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      // New user — create with Privy EVM wallet
      const privy = await getOrCreatePrivyUser(email);
      const id = uuid();

      db.prepare(`
        INSERT INTO users (id, email, name, evm_address, privy_user_id, auth_type, arb_usdc_balance)
        VALUES (?, ?, ?, ?, ?, 'google', 10000)
      `).run(id, email, name || '', privy.evmAddress || '', privy.privyUserId || '');

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      console.log(`✅ New Google user: ${email} | EVM: ${privy.evmAddress}`);
    } else if (!user.evm_address) {
      // Existing user, ensure EVM wallet
      const privy = await getOrCreatePrivyUser(email);
      db.prepare('UPDATE users SET evm_address = ?, privy_user_id = ?, auth_type = ? WHERE id = ?')
        .run(privy.evmAddress || '', privy.privyUserId || '', 'google', user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    res.json({ user: safeUser(user), token: makeToken(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Google login failed.' });
  }
});

// ── zkLogin (Sui) ─────────────────────────────────────────────────────────────

router.post('/zklogin', async (req, res) => {
  const { suiAddress, email, name, jwtToken } = req.body;
  if (!suiAddress) return res.status(400).json({ error: 'Sui address required.' });

  try {
    let user = db.prepare('SELECT * FROM users WHERE sui_address = ?').get(suiAddress)
              || (email && db.prepare('SELECT * FROM users WHERE email = ?').get(email));

    if (!user) {
      const privy = await getOrCreatePrivyUser(email || `${suiAddress}@sui.manager`);
      const id = uuid();

      db.prepare(`
        INSERT INTO users (id, email, name, sui_address, evm_address, privy_user_id, auth_type, arb_usdc_balance)
        VALUES (?, ?, ?, ?, ?, ?, 'zklogin', 10000)
      `).run(id, email || `${suiAddress}@sui.manager`, name || 'Sui User',
             suiAddress, privy.evmAddress || '', privy.privyUserId || '');

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      console.log(`✅ zkLogin user: ${suiAddress} | EVM: ${privy.evmAddress}`);
    } else if (!user.sui_address) {
      db.prepare('UPDATE users SET sui_address = ? WHERE id = ?').run(suiAddress, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    res.json({ user: safeUser(user), token: makeToken(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'zkLogin failed.' });
  }
});

module.exports = router;
