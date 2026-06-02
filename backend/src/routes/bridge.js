const express = require('express');
const db = require('../db');
const { bridgeSuiToArbitrum } = require('../lib/cctp');

const router = express.Router();

function getUserId(req) {
  return req.headers['x-user-id'] || req.body?.userId;
}

// Initiate bridge: Sui → Arbitrum
router.post('/sui-to-arb', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { amountUsdc, burnTxHash } = req.body;
  if (!amountUsdc || amountUsdc <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.evm_address) return res.status(400).json({ error: 'No EVM wallet found. Please log in again.' });

  try {
    res.json({ status: 'initiated', message: 'Bridge in progress. This takes ~30 seconds.' });

    // Run bridge async — agent will update portfolio when done
    bridgeSuiToArbitrum({
      userId,
      amountUsdc: amountUsdc * 1e6,
      suiAddress: user.sui_address,
      evmAddress: user.evm_address,
      burnTxHash,
      db,
    }).then(result => {
      console.log(`Bridge complete for ${userId}:`, result);
    }).catch(err => {
      console.error(`Bridge failed for ${userId}:`, err.message);
    });

  } catch (e) {
    res.status(500).json({ error: 'Bridge failed: ' + e.message });
  }
});

// Get bridge history
router.get('/history', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const history = db.prepare(
    'SELECT * FROM bridge_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(userId);

  res.json({ history });
});

// Get bridge status
router.get('/status/:bridgeId', (req, res) => {
  const { bridgeId } = req.params;
  const bridge = db.prepare('SELECT * FROM bridge_requests WHERE id = ?').get(bridgeId);
  if (!bridge) return res.status(404).json({ error: 'Not found' });
  res.json(bridge);
});

module.exports = router;
