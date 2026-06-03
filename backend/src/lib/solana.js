const { Connection, PublicKey } = require('@solana/web3.js');

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const XSTOCKS = {
  TSLAx: 'tslaxMint111111111111111111111111111111111',
  AAPLx: 'aaplxMint111111111111111111111111111111111',
  NVDAx: 'nvdaxMint111111111111111111111111111111111',
  SPYx:  'spyxMint1111111111111111111111111111111111',
  METAx: 'metaxMint111111111111111111111111111111111',
};

function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
  );
}

async function getSolPortfolio(solAddress, userId) {
  if (!solAddress) return { chain: 'solana', usdcBalance: 0, positions: [] };

  try {
    const connection = getConnection();
    const pubkey = new PublicKey(solAddress);
    const balance = await connection.getBalance(pubkey);

    return {
      chain: 'solana',
      address: solAddress,
      solBalance: balance / 1e9,
      usdcBalance: 0,
      positions: [],
    };
  } catch (e) {
    console.error('SOL portfolio error:', e.message);
    return { chain: 'solana', usdcBalance: 0, positions: [] };
  }
}

module.exports = { getSolPortfolio };
