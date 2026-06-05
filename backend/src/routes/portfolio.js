const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { getArbPortfolio } = require('../lib/arbitrum');
const { getSolPortfolio } = require('../lib/solana');
const { getSuiPortfolio } = require('../lib/sui');

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

router.get('/:chain', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { chain } = req.params;

  try {
    let portfolio = {};

    if (chain === 'arbitrum') {
      portfolio = await getArbPortfolio(user.evm_address, user.id);
    } else if (chain === 'solana') {
      portfolio = await getSolPortfolio(user.sol_address, user.id);
    } else if (chain === 'sui') {
      // For SUI tab, read from the Solana wallet (where xStocks actually live)
      // and also check Sui USDC balance
      const solPortfolio = await getSolPortfolio(user.sol_address, user.id).catch(() => ({}));
      const suiPortfolio = await getSuiPortfolio(user.sui_address, user.id).catch(() => ({}));
      portfolio = {
        chain: 'sui',
        suiAddress: user.sui_address,
        solAddress: user.sol_address,
        usdcBalance: (suiPortfolio.usdcBalance || 0) + (solPortfolio.usdcBalance || 0),
        suiUsdcBalance: suiPortfolio.usdcBalance || 0,
        solUsdcBalance: solPortfolio.usdcBalance || 0,
        positions: solPortfolio.positions || [],
      };
    }

    // Merge with local position tracking
    const positions = db.prepare(
      'SELECT * FROM positions WHERE user_id = ? AND chain = ?'
    ).all(user.id, chain);

    res.json({ ...portfolio, trackedPositions: positions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Portfolio fetch failed' });
  }
});

module.exports = router;
