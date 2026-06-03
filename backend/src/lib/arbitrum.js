const { ethers } = require('ethers');

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

// Robinhood tokenized stock addresses on Arbitrum
const RH_STOCKS = {
  AAPLX: '0x1234000000000000000000000000000000000001',
  TSLAX: '0x1234000000000000000000000000000000000002',
  NVDAX: '0x1234000000000000000000000000000000000003',
  MSFTX: '0x1234000000000000000000000000000000000004',
  SPYX:  '0x1234000000000000000000000000000000000005',
};

function getProvider() {
  return new ethers.JsonRpcProvider(
    process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
  );
}

async function getArbPortfolio(evmAddress, userId) {
  if (!evmAddress) return { chain: 'arbitrum', usdcBalance: 0, positions: [] };

  try {
    const provider = getProvider();
    const usdc = new ethers.Contract(USDC_ARB, ERC20_ABI, provider);
    const rawBalance = await usdc.balanceOf(evmAddress);
    const usdcBalance = parseFloat(ethers.formatUnits(rawBalance, 6));

    return {
      chain: 'arbitrum',
      address: evmAddress,
      usdcBalance,
      positions: [],
    };
  } catch (e) {
    console.error('ARB portfolio error:', e.message);
    return { chain: 'arbitrum', usdcBalance: 0, positions: [] };
  }
}

module.exports = { getArbPortfolio };
