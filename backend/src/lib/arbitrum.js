const { ethers } = require('ethers');

const PORTFOLIO_ABI = [
  'function deposit(uint256 amount) external',
  'function withdraw(uint256 amount) external',
  'function executeBuy(address user, bytes32 symbol, uint256 shares, uint256 priceCents) external',
  'function executeSell(address user, bytes32 symbol, uint256 shares, uint256 priceCents) external',
  'function getBalance(address user) external view returns (uint256)',
  'function getPositions(address user) external view returns (tuple(bytes32 symbol, uint256 shares, uint256 avgPrice, uint256 openedAt)[])',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const CONTRACT = process.env.CONTRACT_ADDRESS;

function getProvider() {
  return new ethers.JsonRpcProvider(
    process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
  );
}

function getAgentWallet() {
  const provider = getProvider();
  return new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
}

function getContracts() {
  const wallet = getAgentWallet();
  const portfolio = new ethers.Contract(CONTRACT, PORTFOLIO_ABI, wallet);
  const usdc = new ethers.Contract(USDC_ARB, ERC20_ABI, wallet);
  return { wallet, portfolio, usdc };
}

async function getArbPortfolio(evmAddress, userId) {
  if (!evmAddress) return { chain: 'arbitrum', usdcBalance: 0, positions: [] };

  try {
    const provider = getProvider();
    const usdc = new ethers.Contract(USDC_ARB, ERC20_ABI, provider);

    // Get wallet USDC balance
    const walletBal = await usdc.balanceOf(evmAddress);
    const walletUsdc = parseFloat(ethers.formatUnits(walletBal, 6));

    // Get contract balance if CONTRACT is set
    let contractUsdc = 0;
    let positions = [];
    if (CONTRACT) {
      const portfolio = new ethers.Contract(CONTRACT, PORTFOLIO_ABI, provider);
      try {
        const contractBal = await portfolio.getBalance(evmAddress);
        contractUsdc = parseFloat(ethers.formatUnits(contractBal, 6));
        const rawPositions = await portfolio.getPositions(evmAddress);
        positions = rawPositions.map(p => ({
          symbol: ethers.decodeBytes32String(p.symbol),
          shares: parseFloat(ethers.formatUnits(p.shares, 6)),
          avgPrice: Number(p.avgPrice) / 100,
        }));
      } catch {}
    }

    return {
      chain: 'arbitrum',
      address: evmAddress,
      usdcBalance: contractUsdc || walletUsdc,
      walletUsdc,
      contractUsdc,
      positions,
    };
  } catch (e) {
    console.error('ARB portfolio error:', e.message);
    return { chain: 'arbitrum', usdcBalance: 0, positions: [] };
  }
}

async function executeArbTrade(userAddress, type, symbol, shares, priceCents) {
  if (!CONTRACT) throw new Error('CONTRACT_ADDRESS not set');
  const { portfolio } = getContracts();

  const symbolBytes = ethers.encodeBytes32String(symbol);
  const sharesScaled = BigInt(Math.round(shares * 1_000_000));
  const priceScaled = BigInt(Math.round(priceCents));

  console.log(`ARB ${type}: ${shares} ${symbol} @ ${priceCents} cents for ${userAddress}`);

  let tx;
  if (type === 'buy') {
    tx = await portfolio.executeBuy(userAddress, symbolBytes, sharesScaled, priceScaled);
  } else {
    tx = await portfolio.executeSell(userAddress, symbolBytes, sharesScaled, priceScaled);
  }

  const receipt = await tx.wait();
  console.log(`ARB trade confirmed: ${tx.hash}`);
  return { txHash: tx.hash, block: receipt.blockNumber };
}

module.exports = { getArbPortfolio, executeArbTrade };
