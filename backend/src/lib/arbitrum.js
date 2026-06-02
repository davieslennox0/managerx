const { ethers } = require('ethers');

const PORTFOLIO_ABI = [
  'function mockDeposit(address user, uint256 amount) external',
  'function submitIntent(address user, uint8 tradeType, bytes32 symbol, uint256 shares, uint256 priceCents) external returns (bytes32)',
  'function executeIntent(bytes32 intentHash) external',
  'function cashBalance(address user) external view returns (uint256)',
  'event IntentSubmitted(bytes32 indexed intentHash, address indexed user, uint8 tradeType, bytes32 symbol, uint256 shares, uint256 priceCents)',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

function getContracts() {
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc');
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const portfolio = new ethers.Contract(process.env.CONTRACT_ADDRESS, PORTFOLIO_ABI, wallet);
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
  return { provider, wallet, portfolio, usdc };
}

async function executeTrade(userEvmAddress, type, symbol, shares, priceCents) {
  const { portfolio } = getContracts();

  const tradeType = type === 'buy' ? 0 : 1;
  const symbolBytes = ethers.keccak256(ethers.toUtf8Bytes(symbol));
  const sharesScaled = BigInt(Math.round(shares * 1_000_000));
  const priceScaled = BigInt(Math.round(priceCents));

  console.log(`Submitting intent: ${type} ${shares} ${symbol} @ ${priceCents} cents`);
  console.log(`User: ${userEvmAddress}`);
  console.log(`Shares scaled: ${sharesScaled}, Price scaled: ${priceScaled}`);

  // Submit intent and get receipt
  const intentTx = await portfolio.submitIntent(
    userEvmAddress, tradeType, symbolBytes, sharesScaled, priceScaled
  );
  console.log(`Intent TX sent: ${intentTx.hash}`);
  const intentReceipt = await intentTx.wait();
  console.log(`Intent TX confirmed in block: ${intentReceipt.blockNumber}`);

  // Parse IntentSubmitted event to get intentHash
  const iface = new ethers.Interface(PORTFOLIO_ABI);
  let intentHash = null;
  for (const log of intentReceipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === 'IntentSubmitted') {
        intentHash = parsed.args.intentHash;
        console.log(`Intent hash from event: ${intentHash}`);
        break;
      }
    } catch {}
  }

  if (!intentHash) {
    throw new Error('Could not parse intentHash from receipt logs');
  }

  // Execute intent
  console.log(`Executing intent: ${intentHash}`);
  const execTx = await portfolio.executeIntent(intentHash);
  console.log(`Execute TX sent: ${execTx.hash}`);
  const execReceipt = await execTx.wait();
  console.log(`Execute TX confirmed: ${execTx.hash}`);

  return { intentTxHash: intentTx.hash, execTxHash: execTx.hash };
}

async function depositForUser(userEvmAddress, amountUsdc) {
  const { portfolio, usdc } = getContracts();
  const amount = ethers.parseUnits(amountUsdc.toString(), 6);
  const approveTx = await usdc.approve(process.env.CONTRACT_ADDRESS, amount);
  await approveTx.wait();
  const depositTx = await portfolio.mockDeposit(userEvmAddress, amount);
  await depositTx.wait();
  return { approveTx: approveTx.hash, depositTx: depositTx.hash };
}

async function getOnchainBalance(userEvmAddress) {
  const { portfolio } = getContracts();
  const balance = await portfolio.cashBalance(userEvmAddress);
  return parseFloat(ethers.formatUnits(balance, 6));
}

module.exports = { depositForUser, executeTrade, getOnchainBalance };
