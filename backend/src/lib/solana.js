const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Real xStock mint addresses on Solana (SPL Token-2022)
const XSTOCK_MINTS = {
  TSLAx: 'XsHCLtBKHMYNrxYiaqm75WBpxLPJHJBnZnJpNhDLQkh',
  AAPLx: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  NVDAx: 'XsfGnUY5RM6pUBMjQyEMLGnN5r6RQqnqSJPALKHVRwx',
  SPYx:  'XsrGKVmRJ5FUqt3JLCqUvnKcf9D3RuCLhbJBKkdFTXu',
  METAx: 'XsbjY9tZfMgcJ3TZhHMnFMFWkEeVhW5TzaTaEgaCMdm',
  GOOGLx: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
  AMZNx: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
  MSFTx: 'XshnUXoWJFDJPXk7JGVFhvmGpBNY4HJZM5tbpakFRXE',
  COINx: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu',
  MSTRx: 'Xsnot1XRd6FSKV8eabA4b2hgWVQHuUy8xGHWdSmMpb6',
  CRCLx: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1',
  QQQx:  'XsQeRwHPNvHRQHvMzBGqgmEbhE8yxBbJU5WxFqBPmrV',
};

function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
}

async function getSolPortfolio(solAddress, userId) {
  if (!solAddress) return { chain: 'sui', usdcBalance: 0, positions: [] };

  try {
    const connection = getConnection();
    const pubkey = new PublicKey(solAddress);

    // Get USDC balance
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      mint: new PublicKey(USDC_SOL),
    });
    const usdcBalance = tokenAccounts.value.reduce((acc, a) =>
      acc + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
    );

    // Get xStock positions
    const positions = [];
    for (const [symbol, mint] of Object.entries(XSTOCK_MINTS)) {
      try {
        const accounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
          mint: new PublicKey(mint),
        });
        const balance = accounts.value.reduce((acc, a) =>
          acc + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
        );
        if (balance > 0) {
          positions.push({ symbol, shares: balance, mint });
        }
      } catch {}
    }

    return { chain: 'sui', address: solAddress, usdcBalance, positions };
  } catch (e) {
    console.error('SOL portfolio error:', e.message);
    return { chain: 'sui', usdcBalance: 0, positions: [] };
  }
}

// Jupiter swap: USDC → xStock
async function jupiterSwap(solAddress, symbol, usdcAmount) {
  const mint = XSTOCK_MINTS[symbol];
  if (!mint) throw new Error(`Unknown xStock: ${symbol}`);

  const amountLamports = Math.round(usdcAmount * 1e6);

  // Get Jupiter quote
  const quoteRes = await axios.get('https://quote-api.jup.ag/v6/quote', {
    params: {
      inputMint: USDC_SOL,
      outputMint: mint,
      amount: amountLamports,
      slippageBps: 50,
    }
  });

  const quote = quoteRes.data;

  // Get swap transaction
  const swapRes = await axios.post('https://quote-api.jup.ag/v6/swap', {
    quoteResponse: quote,
    userPublicKey: solAddress,
    wrapAndUnwrapSol: false,
  });

  return {
    swapTransaction: swapRes.data.swapTransaction,
    outputAmount: quote.outAmount / 1e6,
    quote,
  };
}

async function getXStockPrice(symbol) {
  const mint = XSTOCK_MINTS[symbol];
  if (!mint) return null;

  try {
    const res = await axios.get(`https://price.jup.ag/v6/price?ids=${mint}&vsToken=${USDC_SOL}`);
    const price = res.data.data[mint]?.price;
    return price ? { price: price.toFixed(2), symbol } : null;
  } catch { return null; }
}

module.exports = { getSolPortfolio, jupiterSwap, getXStockPrice, XSTOCK_MINTS };
