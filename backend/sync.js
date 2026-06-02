require('dotenv').config();
const { ethers } = require('ethers');
const db = require('./src/db');

const PORTFOLIO_ABI = ['function cashBalance(address user) external view returns (uint256)'];

async function syncAll() {
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
  const portfolio = new ethers.Contract(process.env.CONTRACT_ADDRESS, PORTFOLIO_ABI, provider);

  const users = db.prepare('SELECT * FROM users WHERE evm_address IS NOT NULL').all();

  for (const user of users) {
    if (!user.evm_address) continue;
    try {
      const onchain = await portfolio.cashBalance(user.evm_address);
      const balance = parseFloat(ethers.formatUnits(onchain, 6));
      db.prepare('UPDATE users SET arb_usdc_balance = ? WHERE id = ?').run(balance, user.id);
      console.log(user.email, '->', '$' + balance);
    } catch(e) {
      console.log(user.email, 'error:', e.message);
    }
  }
  console.log('Sync complete');
}
syncAll().catch(console.error);
