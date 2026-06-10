const { Connection, PublicKey, Keypair, VersionedTransaction, Transaction, ComputeBudgetProgram, TransactionMessage } = require('@solana/web3.js');
const axios = require('axios');
const bs58 = require('bs58');
const { withFallback } = require('./solana_connection');

const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Gas management: keep 0.005 SOL on hand — enough to cover CCTP depositForBurn
// rent (~0.003 SOL) plus normal tx fees. Top up with $0.50 USDC when low.
// NOTE: the very first CCTP receive on Solana requires an initial seed from the platform.
const GAS_MIN_LAMPORTS  = 5_000_000; // 0.005 SOL — trigger top-up below this
const GAS_TOPUP_USDC   = 0.50;      // swap $0.50 USDC → SOL on each top-up
const GAS_SWAP_MIN_SOL = 5_000;     // minimum SOL needed to pay for the topup swap itself

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
  return Keypair.fromSecretKey(bs58.default.decode(key));
}

function getConnection() {
  return require('./solana_connection').getConnection();
}

// Returns { solBalance (lamports), usdcBalance (USD) } for the agent wallet.
async function getAgentGasStatus() {
  const agentKeypair = getAgentKeypair();
  return withFallback(async (connection) => {
    const solBalance = await connection.getBalance(agentKeypair.publicKey);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(agentKeypair.publicKey, {
      mint: new PublicKey(USDC_SOL),
    });
    const usdcBalance = tokenAccounts.value.reduce((acc, a) =>
      acc + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
    );
    return { solBalance, usdcBalance };
  });
}

// Swap $0.50 USDC → native SOL via Jupiter. Requires at least GAS_SWAP_MIN_SOL lamports.
async function topUpGasFromUsdc() {
  const agentKeypair = getAgentKeypair();
  const amountLamports = Math.round(GAS_TOPUP_USDC * 1e6);

  const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
    params: { inputMint: USDC_SOL, outputMint: WSOL_MINT, amount: amountLamports, slippageBps: 100 },
  });

  const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
    quoteResponse: quoteRes.data,
    userPublicKey: agentKeypair.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    prioritizationFeeLamports: 'auto',
    dynamicComputeUnitLimit: true,
  });

  const buf = Buffer.from(swapRes.data.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(buf);
  tx.sign([agentKeypair]);

  return withFallback(async (connection) => {
    const id = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    const conf = await connection.confirmTransaction(id, 'confirmed');
    if (conf.value.err) throw new Error(`USDC→SOL gas topup failed: ${JSON.stringify(conf.value.err)}`);
    console.log('Gas topped up from USDC:', id);
    return id;
  });
}

// Ensure the agent wallet has enough SOL for gas.
// Returns { ok: true } or { ok: false, needsBridge: true, solBalance, usdcBalance }.
async function ensureGas() {
  const status = await getAgentGasStatus();

  if (status.solBalance >= GAS_MIN_LAMPORTS) return { ok: true };

  console.log(`Low gas: ${status.solBalance} lamports, $${status.usdcBalance.toFixed(4)} USDC`);

  if (status.solBalance >= GAS_SWAP_MIN_SOL && status.usdcBalance >= GAS_TOPUP_USDC) {
    try {
      await topUpGasFromUsdc();
      return { ok: true };
    } catch (e) {
      console.error('Gas auto-topup failed:', e.message);
    }
  }

  return { ok: false, needsBridge: true, solBalance: status.solBalance, usdcBalance: status.usdcBalance };
}

// Kept for external callers (sell deduction in trade.js) but no longer used internally.
async function estimateGasCostUsdc(numTxs = 1) {
  const LAMPORTS_PER_TX = 25_000;
  try {
    const res = await axios.get('https://api.jup.ag/price/v2', {
      params: { ids: WSOL_MINT },
      timeout: 3000,
    });
    const solPrice = parseFloat(res.data?.data?.[WSOL_MINT]?.price || 0);
    if (solPrice > 0) return (LAMPORTS_PER_TX * numTxs / 1e9) * solPrice;
  } catch {}
  return (LAMPORTS_PER_TX * numTxs / 1e9) * 150;
}

async function getSolPortfolio(solAddress, userId) {
  if (!solAddress) return { chain: 'solana', usdcBalance: 0, positions: [] };

  try {
    return await withFallback(async (connection) => {
      const pubkey = new PublicKey(solAddress);

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        mint: new PublicKey(USDC_SOL),
      });
      const usdcBalance = tokenAccounts.value.reduce((acc, a) =>
        acc + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
      );

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

      const solBalance = await connection.getBalance(pubkey) / 1e9;
      return { chain: 'solana', address: solAddress, usdcBalance, solBalance, positions };
    });
  } catch (e) {
    console.error('SOL portfolio error:', e.message);
    return { chain: 'solana', usdcBalance: 0, positions: [] };
  }
}

async function jupiterSwap(solAddress, symbol, usdcAmount) {
  // Normalise to canonical PLTRx / NVDAx form — strip trailing X/x, uppercase base, append 'x'.
  const canonical = symbol.replace(/x$/i, '').toUpperCase() + 'x';
  const mint = XSTOCK_MINTS[canonical];
  if (!mint) throw new Error(`Unknown xStock: ${symbol}`);

  const amountLamports = Math.round(usdcAmount * 1e6);

  const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
    params: {
      inputMint: USDC_SOL,
      outputMint: mint,
      amount: amountLamports,
      slippageBps: 50,
    }
  });

  const quote = quoteRes.data;
  const agentKeypair = getAgentKeypair();

  const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
    quoteResponse: quote,
    userPublicKey: solAddress,
    wrapAndUnwrapSol: false,
    prioritizationFeeLamports: 'auto',
    dynamicComputeUnitLimit: true,
  });

  const swapTransactionBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([agentKeypair]);
  const serialized = transaction.serialize();

  const txid = await withFallback(async (connection) => {
    const id = await connection.sendRawTransaction(serialized, { skipPreflight: true, maxRetries: 3 });
    const conf = await connection.confirmTransaction(id, 'confirmed');
    if (conf.value.err) {
      const txData = await connection.getTransaction(id, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);
      const logs = txData?.meta?.logMessages?.join('\n') || '';
      throw new Error(`Jupiter swap failed on-chain (${id}): ${JSON.stringify(conf.value.err)}\nLogs:\n${logs}`);
    }
    return id;
  });

  return {
    txHash: txid,
    outputAmount: quote.outAmount / 1e6,
    mintAddress: mint,
    rawOutputAmount: Number(quote.outAmount),
  };
}

async function getXStockPrice(symbol) {
  const canonical = symbol.replace(/x$/i, '').toUpperCase() + 'x';
  const mint = XSTOCK_MINTS[canonical];
  if (!mint) return null;
  try {
    const res = await axios.get('https://api.jup.ag/swap/v1/quote', {
      params: { inputMint: mint, outputMint: USDC_SOL, amount: 1_000_000, slippageBps: 50 },
    });
    const outAmount = parseFloat(res.data.outAmount);
    return outAmount > 0 ? { price: (outAmount / 1e6).toFixed(2), symbol: canonical } : null;
  } catch { return null; }
}

// Swap xStock → USDC via Jupiter (sell direction). Returns USDC amounts.
// gasCostUsdc is passed in so the caller can deduct it from the bridged USDC output.
async function jupiterSwapXStockToUsdc(mintAddress, rawInputAmount) {
  const agentKeypair = getAgentKeypair();

  const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
    params: {
      inputMint: mintAddress,
      outputMint: USDC_SOL,
      amount: rawInputAmount,
      slippageBps: 50,
    }
  });

  const quote = quoteRes.data;

  const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
    quoteResponse: quote,
    userPublicKey: agentKeypair.publicKey.toBase58(),
    wrapAndUnwrapSol: false,
    prioritizationFeeLamports: 'auto',
    dynamicComputeUnitLimit: true,
  });

  const swapTransactionBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([agentKeypair]);
  const serialized = transaction.serialize();

  const txid = await withFallback(async (connection) => {
    const id = await connection.sendRawTransaction(serialized, { skipPreflight: true, maxRetries: 3 });
    const conf = await connection.confirmTransaction(id, 'confirmed');
    if (conf.value.err) {
      const txData = await connection.getTransaction(id, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);
      const logs = txData?.meta?.logMessages?.join('\n') || '';
      throw new Error(`Jupiter swap failed on-chain (${id}): ${JSON.stringify(conf.value.err)}\nLogs:\n${logs}`);
    }
    return id;
  });

  return {
    txHash: txid,
    usdcAmount: Number(quote.outAmount) / 1e6,
    rawUsdcAmount: Number(quote.outAmount),
  };
}

// Build a Solana SPL-token transfer transaction for the user to co-sign
// (xStock from user's ATA → agent's ATA).
// Agent is fee payer and pre-signs so the user's embedded wallet needs no SOL.
// Returns base64 partially-signed tx bytes; user must add their signature.
async function buildSellTransferTransaction(mintAddress, userSolAddress, rawAmount) {
  const {
    getOrCreateAssociatedTokenAccount,
    getAssociatedTokenAddressSync,
    createTransferCheckedInstruction,
    getMint,
    TOKEN_2022_PROGRAM_ID,
  } = require('@solana/spl-token');

  return withFallback(async (connection) => {
    const agentKeypair = getAgentKeypair();
    const mint = new PublicKey(mintAddress);
    const userPubkey = new PublicKey(userSolAddress);

    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    const decimals = mintInfo.decimals;

    const userATA = getAssociatedTokenAddressSync(mint, userPubkey, false, TOKEN_2022_PROGRAM_ID);

    // Ensure agent's ATA exists for this token (creates + funds it if first-time sell)
    const agentATAAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      agentKeypair,
      mint,
      agentKeypair.publicKey,
      false,
      'confirmed',
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const transferIx = createTransferCheckedInstruction(
      userATA,
      mint,
      agentATAAccount.address,
      userPubkey,
      BigInt(rawAmount),
      decimals,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    // Agent is fee payer — user's embedded wallet needs no SOL.
    // Agent does NOT pre-sign here; user signs first, then POSTs to
    // /submit-sell-transfer where the backend countersigns + submits.
    // Pre-signing here would be invalidated if the wallet refreshes the blockhash.
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: agentKeypair.publicKey });
    // Priority fee: 200k micro-lamports/CU — competitive enough for mainnet congestion
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    tx.add(transferIx);

    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    return { txBase64, blockhash, lastValidBlockHeight };
  });
}

// Receive a user-signed sell-transfer tx, countersign as fee payer, and submit.
// blockhash + lastValidBlockHeight come from the build step so we can use the
// block-height confirmation strategy (120s window instead of web3.js 30s default).
async function countersignAndSubmitSellTransfer(userSignedTxBase64, blockhash, lastValidBlockHeight) {
  const txBytes = Buffer.from(userSignedTxBase64, 'base64');
  const tx = Transaction.from(txBytes);
  const agentKeypair = getAgentKeypair();
  tx.partialSign(agentKeypair);
  const serialized = tx.serialize();

  return withFallback(async (connection) => {
    // maxRetries: 0 — we own the retry loop so the tx keeps being rebroadcast
    // until it lands or the blockhash expires (prevents silent drop from mempool).
    const sendRaw = () => connection.sendRawTransaction(serialized, { skipPreflight: true, maxRetries: 0 });

    const id = await sendRaw();
    console.log('Sell transfer submitted:', id, '— confirming (up to 120s)...');

    const retryTimer = setInterval(() => {
      sendRaw().catch(() => {});
    }, 3000);

    let conf;
    try {
      conf = await connection.confirmTransaction(
        { signature: id, blockhash, lastValidBlockHeight },
        'confirmed'
      );
    } finally {
      clearInterval(retryTimer);
    }

    if (conf.value.err) {
      const txData = await connection.getTransaction(id, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);
      const logs = txData?.meta?.logMessages?.join('\n') || '';
      throw new Error(`Sell transfer failed on-chain (${id}): ${JSON.stringify(conf.value.err)}\nLogs:\n${logs}`);
    }
    return id;
  });
}

async function transferXStockToUser(mintAddress, userSolAddress, rawAmount) {
  const {
    getOrCreateAssociatedTokenAccount,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
    getMint,
    TOKEN_2022_PROGRAM_ID,
  } = require('@solana/spl-token');

  return withFallback(async (connection) => {
    const agentKeypair = getAgentKeypair();
    const mint = new PublicKey(mintAddress);
    const userPubkey = new PublicKey(userSolAddress);

    const agentATA = getAssociatedTokenAddressSync(
      mint,
      agentKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Query the actual on-chain balance — catches silent swap failures before we
    // send a transfer that would fail with a cryptic "insufficient funds" error.
    const balanceInfo = await connection.getTokenAccountBalance(agentATA).catch(() => null);
    const actualRaw = BigInt(balanceInfo?.value?.amount || '0');
    if (actualRaw === 0n) {
      throw new Error(
        `Agent ATA has no ${mint.toBase58().slice(0, 8)}… tokens to transfer. ` +
        `The Jupiter swap likely failed on-chain (use the swap txHash to investigate).`
      );
    }
    const amountToTransfer = actualRaw;

    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
    const decimals = mintInfo.decimals;

    // Create user's ATA if it doesn't exist yet; agent pays the rent.
    // getOrCreateAssociatedTokenAccount is idempotent — safe to retry.
    const userATA = await getOrCreateAssociatedTokenAccount(
      connection,
      agentKeypair,
      mint,
      userPubkey,
      false,
      'confirmed',
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    const transferIx = createTransferCheckedInstruction(
      agentATA,
      mint,
      userATA.address,
      agentKeypair.publicKey,
      amountToTransfer,
      decimals,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: agentKeypair.publicKey });
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    tx.add(transferIx);

    const txid = await connection.sendTransaction(tx, [agentKeypair], { maxRetries: 3 });
    await connection.confirmTransaction(txid, 'confirmed');

    return txid;
  });
}

// Returns the deterministic USDC ATA address for a Solana wallet.
// USDC uses the legacy SPL Token program, not Token-2022.
function getUserUsdcAta(userSolAddress) {
  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID: SPL_TOKEN } = require('@solana/spl-token');
  return getAssociatedTokenAddressSync(
    new PublicKey(USDC_SOL),
    new PublicKey(userSolAddress),
    false,
    SPL_TOKEN
  );
}

// Create user's USDC ATA if it doesn't exist yet. Agent pays rent.
async function ensureUserUsdcAta(userSolAddress) {
  const { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID: SPL_TOKEN } = require('@solana/spl-token');
  return withFallback(async (connection) => {
    const agentKeypair = getAgentKeypair();
    return getOrCreateAssociatedTokenAccount(
      connection,
      agentKeypair,
      new PublicKey(USDC_SOL),
      new PublicKey(userSolAddress),
      false,
      'confirmed',
      undefined,
      SPL_TOKEN
    );
  });
}

// Build a Jupiter buy transaction where:
//  - User's USDC ATA is the input (not the agent's)
//  - A fee transfer (user → agent) is prepended in the same tx
//  - Agent is the fee payer (pre-signed), user just adds their signature
//
// Returns { txBase64, blockhash, lastValidBlockHeight, mintAddress, feeRaw, swapRaw }
// The caller returns this to the frontend for user signing.
async function buildJupiterBuyTransaction(userSolAddress, symbol, grossUsdcRaw, feeBps) {
  const { createTransferInstruction, TOKEN_PROGRAM_ID: SPL_TOKEN } = require('@solana/spl-token');

  const canonical = symbol.replace(/x$/i, '').toUpperCase() + 'x';
  const mint = XSTOCK_MINTS[canonical];
  if (!mint) throw new Error(`Unknown xStock: ${symbol}`);

  const agentKeypair = getAgentKeypair();
  const userPubkey = new PublicKey(userSolAddress);
  const userUsdcAta = getUserUsdcAta(userSolAddress);
  const agentUsdcAta = new PublicKey(process.env.AGENT_SOL_USDC_ATA);

  const feeRaw = Math.round(grossUsdcRaw * feeBps / 10000);
  const swapRaw = grossUsdcRaw - feeRaw;

  // Jupiter v6 quote for swapRaw USDC → xStock
  const quoteRes = await axios.get('https://quote-api.jup.ag/v6/quote', {
    params: { inputMint: USDC_SOL, outputMint: mint, amount: swapRaw, slippageBps: 50 },
  });

  // Jupiter v6 swap-instructions (individual instructions, not full tx)
  const instrRes = await axios.post('https://quote-api.jup.ag/v6/swap-instructions', {
    quoteResponse: quoteRes.data,
    userPublicKey: userSolAddress,
    wrapAndUnwrapSol: false,
    prioritizationFeeLamports: 'auto',
    dynamicComputeUnitLimit: true,
  });

  const {
    computeBudgetInstructions = [],
    setupInstructions = [],
    swapInstruction,
    cleanupInstruction,
    addressLookupTableAddresses = [],
  } = instrRes.data;

  function deserializeIx(ix) {
    return {
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map(a => ({
        pubkey: new PublicKey(a.pubkey),
        isSigner: a.isSigner,
        isWritable: a.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    };
  }

  // Fee transfer: user's USDC ATA → agent's fee ATA
  const feeIx = feeRaw > 0
    ? createTransferInstruction(userUsdcAta, agentUsdcAta, userPubkey, feeRaw, [], SPL_TOKEN)
    : null;

  const allIxs = [
    ...computeBudgetInstructions.map(deserializeIx),
    ...(feeIx ? [feeIx] : []),
    ...setupInstructions.map(deserializeIx),
    deserializeIx(swapInstruction),
    ...(cleanupInstruction ? [deserializeIx(cleanupInstruction)] : []),
  ];

  return withFallback(async (connection) => {
    // Fetch address lookup tables required by Jupiter
    const altAccounts = (await Promise.all(
      addressLookupTableAddresses.map(addr =>
        connection.getAddressLookupTable(new PublicKey(addr)).then(r => r.value)
      )
    )).filter(Boolean);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const message = new TransactionMessage({
      payerKey: agentKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: allIxs,
    }).compileToV0Message(altAccounts);

    const tx = new VersionedTransaction(message);
    tx.sign([agentKeypair]); // agent pre-signs as fee payer

    return {
      txBase64: Buffer.from(tx.serialize()).toString('base64'),
      blockhash,
      lastValidBlockHeight,
      mintAddress: mint,
      feeRaw,
      swapRaw,
    };
  });
}

// Submit a Jupiter buy tx that the user has signed. Agent already signed at build time.
// Keeps rebroadcasting until confirmed or blockhash expires.
async function submitJupiterBuyTransaction(userSignedTxBase64, blockhash, lastValidBlockHeight) {
  const txBytes = Buffer.from(userSignedTxBase64, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);
  const serialized = tx.serialize();

  return withFallback(async (connection) => {
    const sendRaw = () => connection.sendRawTransaction(serialized, { skipPreflight: true, maxRetries: 0 });

    const id = await sendRaw();
    console.log('Jupiter buy submitted:', id, '— confirming (up to 120s)...');

    const retryTimer = setInterval(() => { sendRaw().catch(() => {}); }, 3000);
    let conf;
    try {
      conf = await connection.confirmTransaction(
        { signature: id, blockhash, lastValidBlockHeight },
        'confirmed'
      );
    } finally {
      clearInterval(retryTimer);
    }

    if (conf.value.err) {
      const txData = await connection.getTransaction(id, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);
      const logs = txData?.meta?.logMessages?.join('\n') || '';
      throw new Error(`Jupiter buy failed on-chain (${id}): ${JSON.stringify(conf.value.err)}\nLogs:\n${logs}`);
    }
    return id;
  });
}

// Return user's Solana USDC balance (for gas-path decision).
async function getUserSolUsdcBalance(solAddress) {
  if (!solAddress) return 0;
  try {
    return await withFallback(async (connection) => {
      const accounts = await connection.getParsedTokenAccountsByOwner(
        new PublicKey(solAddress),
        { mint: new PublicKey(USDC_SOL) }
      );
      return accounts.value.reduce((acc, a) =>
        acc + (a.account.data.parsed.info.tokenAmount.uiAmount || 0), 0
      );
    });
  } catch { return 0; }
}

// Build an unsigned Solana tx to transfer USDC from user's ATA → agent's USDC ATA.
// Agent is fee payer so the user needs no SOL.
async function buildSolUsdcTransferToAgent(userSolAddress, rawUsdcAmount) {
  const { createTransferInstruction, TOKEN_PROGRAM_ID: SPL_TOKEN } = require('@solana/spl-token');

  return withFallback(async (connection) => {
    const agentKeypair = getAgentKeypair();
    const userPubkey   = new PublicKey(userSolAddress);
    const userUsdcAta  = getUserUsdcAta(userSolAddress);
    const agentUsdcAta = new PublicKey(process.env.AGENT_SOL_USDC_ATA);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: agentKeypair.publicKey });
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }));
    tx.add(createTransferInstruction(
      userUsdcAta,
      agentUsdcAta,
      userPubkey,
      rawUsdcAmount,
      [],
      SPL_TOKEN
    ));

    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    return { txBase64, blockhash, lastValidBlockHeight };
  });
}

// $1 USDC transfer to agent — used for gas top-up.
async function buildSolGasTopupTransaction(userSolAddress) {
  return buildSolUsdcTransferToAgent(userSolAddress, 1_000_000);
}

// Receive a user-signed USDC→agent transfer, countersign as fee payer, submit,
// then swap $0.50 of the received USDC for SOL so the agent can pay tx fees.
async function submitSolGasTopup(userSignedTxBase64, blockhash, lastValidBlockHeight) {
  const txBytes = Buffer.from(userSignedTxBase64, 'base64');
  const tx = Transaction.from(txBytes);
  const agentKeypair = getAgentKeypair();
  tx.partialSign(agentKeypair);
  const serialized = tx.serialize();

  await withFallback(async (connection) => {
    const sendRaw = () => connection.sendRawTransaction(serialized, { skipPreflight: true, maxRetries: 0 });
    const id = await sendRaw();
    console.log('Sol gas topup transfer submitted:', id);

    const retryTimer = setInterval(() => sendRaw().catch(() => {}), 3000);
    let conf;
    try {
      conf = await connection.confirmTransaction(
        { signature: id, blockhash, lastValidBlockHeight },
        'confirmed'
      );
    } finally {
      clearInterval(retryTimer);
    }
    if (conf.value.err) throw new Error(`Gas topup transfer failed: ${JSON.stringify(conf.value.err)}`);
    console.log('Gas topup transfer confirmed:', id);
  });

  await topUpGasFromUsdc();
}

module.exports = {
  getSolPortfolio,
  jupiterSwap,
  jupiterSwapXStockToUsdc,
  buildSellTransferTransaction,
  countersignAndSubmitSellTransfer,
  transferXStockToUser,
  estimateGasCostUsdc,
  getXStockPrice,
  ensureGas,
  topUpGasFromUsdc,
  getAgentGasStatus,
  buildJupiterBuyTransaction,
  submitJupiterBuyTransaction,
  ensureUserUsdcAta,
  getUserUsdcAta,
  getUserSolUsdcBalance,
  buildSolUsdcTransferToAgent,
  buildSolGasTopupTransaction,
  submitSolGasTopup,
  XSTOCK_MINTS,
};
