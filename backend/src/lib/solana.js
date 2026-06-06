const { Connection, PublicKey, Keypair, VersionedTransaction } = require('@solana/web3.js');
const axios = require('axios');

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Full verified xStock mint addresses — official Solana case study Aug 2025
const XSTOCK_MINTS = {
  ABTx:   'XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7',
  ABBVx:  'XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie',
  ACNx:   'Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU',
  GOOGLx: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
  AMZNx:  'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
  AMBRx:  'XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb',
  AAPLx:  'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
  APPx:   'XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV',
  AZNx:   'Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU',
  BACx:   'XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP',
  BRKBx:  'Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x',
  AVGOx:  'XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo',
  CVXx:   'XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts',
  CRCLx:  'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1',
  CSCOx:  'Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf',
  KOx:    'XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ',
  COINx:  'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu',
  CMCSAx: 'XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8',
  CRWDx:  'Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw',
  DHRx:   'Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV',
  DFDVx:  'Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy',
  LLYx:   'Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH',
  XOMx:   'XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh',
  GMEx:   'Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc',
  GLDx:   'Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re',
  GSx:    'XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1',
  HDx:    'XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3',
  HONx:   'XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2',
  INTCx:  'XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM',
  IBMx:   'XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr',
  JNJx:   'XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn',
  JPMx:   'XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C',
  LINx:   'XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z',
  MRVLx:  'XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA',
  MAx:    'XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC',
  MCDx:   'XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2',
  MDTx:   'XsDgw22qRLTv5Uwuzn6T63cW69exG41T6gwQhEK22u2',
  MRKx:   'XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X',
  METAx:  'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
  MSFTx:  'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
  MSTRx:  'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ',
  QQQx:   'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
  NFLXx:  'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL',
  NVOx:   'XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n',
  NVDAx:  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
  OPENx:  'XsGtpmjhmC8kyjVSWL4VicGu36ceq9u55PTgF8bhGv6',
  ORCLx:  'XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL',
  PLTRx:  'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4',
  PEPx:   'Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF',
  PFEx:   'XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw',
  PMx:    'Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3',
  PGx:    'XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV',
  HOODx:  'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg',
  CRMx:   'XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN',
  SPYx:   'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  TBLLx:  'XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp',
  TSLAx:  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
  TMOx:   'Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57',
  TQQQx:  'XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc',
  UNHx:   'XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe',
  VTIx:   'XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9',
  Vx:     'XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p',
  WMTx:   'Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci',
};

function getAgentKeypair() {
  const key = process.env.AGENT_SOL_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_SOL_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(Buffer.from(key, 'base64'));
}

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

    // Get ALL token accounts in one call instead of 60 separate calls
    const positions = [];
    try {
      const allAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
      });
      const mintToSymbol = Object.fromEntries(
        Object.entries(XSTOCK_MINTS).map(([sym, mint]) => [mint, sym])
      );
      for (const account of allAccounts.value) {
        const info = account.account.data.parsed.info;
        const symbol = mintToSymbol[info.mint];
        if (symbol && info.tokenAmount.uiAmount > 0) {
          positions.push({ symbol, shares: info.tokenAmount.uiAmount, mint: info.mint });
        }
      }
    } catch (e) {
      console.error('Token fetch error:', e.message);
    }

    return { chain: 'sui', address: solAddress, usdcBalance, positions };
  } catch (e) {
    console.error('SOL portfolio error:', e.message);
    return { chain: 'sui', usdcBalance: 0, positions: [] };
  }
}

async function jupiterSwap(solAddress, symbol, usdcAmount) {
  const mint = XSTOCK_MINTS[symbol];
  if (!mint) throw new Error(`Unknown xStock: ${symbol}`);

  const amountLamports = Math.round(usdcAmount * 1e6);

  const quoteRes = await axios.get('https://quote-api.jup.ag/v6/quote', {
    params: {
      inputMint: USDC_SOL,
      outputMint: mint,
      amount: amountLamports,
      slippageBps: 50,
    }
  });

  const quote = quoteRes.data;

  const agentKeypair = getAgentKeypair();

  const swapRes = await axios.post('https://quote-api.jup.ag/v6/swap', {
    quoteResponse: quote,
    userPublicKey: agentKeypair.publicKey.toBase58(),
    wrapAndUnwrapSol: false,
  });

  // Deserialize, sign and send
  const connection = getConnection();
  const swapTransactionBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([agentKeypair]);

  const txid = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });

  await connection.confirmTransaction(txid, 'confirmed');

  return {
    txHash: txid,
    outputAmount: quote.outAmount / 1e6,
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
