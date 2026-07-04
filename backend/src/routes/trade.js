const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getPrice } = require('./prices');
const { executeArbTrade } = require('../lib/arbitrum');
const { executeSuiTrade, sponsorSuiTransaction } = require('../lib/sui');
const { jupiterSwapXStockToUsdc, buildSellTransferTransaction, countersignAndSubmitSellTransfer, countersignAndSubmit, estimateGasCostUsdc, ensureGas, topUpGasFromUsdc, buildJupiterBuyTransaction, submitJupiterBuyTransaction, buildJupiterSellTransaction, submitJupiterSellTransaction, getUserSolBalance, buildUserGasBootstrapSwap, USER_GAS_THRESHOLD_LAMPORTS, ensureUserUsdcAta, getUserUsdcAta, getMintDecimals, getUserSolUsdcBalance, buildSolUsdcTransferToAgent, buildSolGasTopupTransaction, submitSolGasTopup, pollSignatureStatus, getTokenAtaDelta, XSTOCK_MINTS } = require('../lib/solana');
const { bridgeUsdcSuiToSolana, bridgeUsdcSolanaToSui } = require('../lib/cctp');
const { storeTradeReceipt } = require('../lib/walrus');

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

// Wrap a gasless Sui transaction kind with agent gas sponsorship.
// Frontend builds with onlyTransactionKind:true, sends bytes here, gets back
// the full sponsored tx + agent signature to countersign and submit.
router.post('/sponsor-sui-tx', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { txKindBytes, senderAddress } = req.body;
  if (!txKindBytes || !senderAddress) return res.status(400).json({ error: 'Missing txKindBytes or senderAddress' });
  if (senderAddress !== user.sui_address) {
    return res.status(403).json({ error: 'senderAddress does not match your account' });
  }

  try {
    const result = await sponsorSuiTransaction(txKindBytes, senderAddress);
    res.json(result);
  } catch (e) {
    console.error('Sponsor tx error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Build the unsigned Solana xStock→agent transfer transaction for the user to sign.
// Frontend signs + submits it, then passes solTxHash to /execute for the sell.
router.post('/build-sell-transfer', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });

  const { symbol, amount, currency } = req.body;
  if (!symbol || !amount) return res.status(400).json({ error: 'Missing params' });

  try {
    const sym = symbol.replace('X', '').replace('x', '').toUpperCase();
    const priceData = await getPrice(sym);
    const price = parseFloat(priceData?.price || 0);
    if (!price) return res.status(400).json({ error: `No price data for ${symbol}` });

    const shares = currency === 'usd' ? amount / price : amount;
    const canonical = symbol.replace(/x$/i, '').toUpperCase() + 'x';
    const mintAddress = XSTOCK_MINTS[canonical];
    if (!mintAddress) return res.status(400).json({ error: `Unknown xStock: ${symbol}` });

    // Pass shares; buildSellTransferTransaction fetches actual decimals on-chain
    const { txBase64, blockhash, lastValidBlockHeight, rawAmount } = await buildSellTransferTransaction(mintAddress, user.sol_address, shares);

    res.json({ transaction: txBase64, blockhash, lastValidBlockHeight, mintAddress, rawAmount, shares });
  } catch (e) {
    console.error('Build sell transfer error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Build a USDC→SOL bootstrap swap FROM the user's wallet.
// Agent pays tx fee for this one (user has zero SOL — unavoidable bootstrap).
// After this confirms, user has SOL and pays all future gas themselves.
router.post('/build-user-gas', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });
  try {
    const result = await buildUserGasBootstrapSwap(user.sol_address);
    res.json(result);
  } catch (e) {
    console.error('build-user-gas error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Submit the user-signed gas bootstrap tx and confirm.
router.post('/submit-user-gas', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { signedTx, blockhash, lastValidBlockHeight } = req.body;
  if (!signedTx || !blockhash || !lastValidBlockHeight) return res.status(400).json({ error: 'Missing fields' });
  try {
    const txHash = await submitJupiterBuyTransaction(signedTx, blockhash, lastValidBlockHeight);
    res.json({ ok: true, txHash });
  } catch (e) {
    console.error('submit-user-gas error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Build a Jupiter sell tx (xStock→USDC) for the user to sign.
// xStock goes directly from user wallet → Jupiter pool.
// USDC output lands in agent ATA for bridging to Sui.
// Agent is fee payer only — never takes custody of xStock.
router.post('/build-sell-swap', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });

  const { symbol, amount, currency } = req.body;
  if (!symbol || !amount) return res.status(400).json({ error: 'Missing params' });

  try {
    const sym = symbol.replace(/x$/i, '').toUpperCase();
    const priceData = await getPrice(sym);
    const price = parseFloat(priceData?.price || 0);
    if (!price) return res.status(400).json({ error: `No price data for ${symbol}` });

    const shares = currency === 'usd' ? amount / price : amount;
    const canonical = sym + 'x';
    const mintAddress = XSTOCK_MINTS[canonical];
    if (!mintAddress) return res.status(400).json({ error: `Unknown xStock: ${symbol}` });

    const [result, userSolLamports] = await Promise.all([
      buildJupiterSellTransaction(user.sol_address, mintAddress, shares),
      getUserSolBalance(user.sol_address),
    ]);
    res.json({
      ...result,
      price,
      symbol: canonical,
      userSolLamports,
      needsGas: userSolLamports < USER_GAS_THRESHOLD_LAMPORTS,
    });
  } catch (e) {
    console.error('build-sell-swap error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Receive user-signed Jupiter sell tx, confirm, then bridge USDC to user's Sui wallet.
router.post('/submit-sell-swap', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { signedTx, blockhash, lastValidBlockHeight, userSuiAddress, symbol, shares, price } = req.body;
  if (!signedTx || !blockhash || !lastValidBlockHeight || !userSuiAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Step 1: Confirm the Jupiter sell swap, then measure what it actually deposited into
  // the shared agent ATA. Never trust a client-supplied output amount here — the agent
  // ATA is shared across all users, so a forged amount would bridge out of the pool.
  let swapTxHash, verifiedRawUsdc;
  try {
    swapTxHash = await submitJupiterSellTransaction(signedTx, blockhash, lastValidBlockHeight);
    console.log('Sell swap confirmed:', swapTxHash, '— USDC in agent ATA, bridging to Sui…');
    verifiedRawUsdc = Number(await getTokenAtaDelta(swapTxHash, process.env.AGENT_SOL_USDC_ATA));
    if (!(verifiedRawUsdc > 0)) throw new Error('Sell swap did not deposit USDC into agent wallet');
  } catch (e) {
    console.error('submit-sell-swap error (swap step):', e);
    return res.status(500).json({ error: e.message });
  }

  try {
    // Step 2: Deduct platform fee, bridge the rest to user's Sui wallet
    const feeBps = parseInt(process.env.PLATFORM_FEE_BPS || '0');
    const feeRaw   = Math.round(verifiedRawUsdc * feeBps / 10000);
    const bridgeRaw = Math.max(verifiedRawUsdc - feeRaw, 0);
    if (bridgeRaw <= 0) throw new Error('Sell proceeds too small to bridge');

    const bridge = await bridgeUsdcSolanaToSui(bridgeRaw, userSuiAddress);
    console.log('Bridge complete:', bridge.suiMintTxHash);

    // Step 3: Record position update in DB
    if (symbol && shares && price) {
      const total = shares * price;
      const holding = db.prepare('SELECT * FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?')
        .get(user.id, 'sui', symbol);
      if (holding) {
        const newShares = holding.shares - shares;
        if (newShares < 0.0001) {
          db.prepare('DELETE FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?')
            .run(user.id, 'sui', symbol);
        } else {
          db.prepare('UPDATE positions SET shares = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
            .run(newShares, user.id, 'sui', symbol);
        }
      }
      db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), user.id, 'sui', 'sell', symbol, shares, price, total, swapTxHash, 'success');
      storeTradeReceipt({ userId: user.id, chain: 'sui', type: 'sell', symbol, shares, price, total, txHash: swapTxHash, timestamp: new Date().toISOString() }).catch(() => {});
    }

    res.json({
      success: true,
      swapTxHash,
      suiMintTxHash: bridge.suiMintTxHash,
      burnTxHash: bridge.burnTxHash,
      usdcBridged: (bridgeRaw / 1e6).toFixed(6),
    });
  } catch (e) {
    console.error('submit-sell-swap error (bridge step):', e);
    db.prepare('INSERT INTO pending_recoveries (id, user_id, raw_amount, reason) VALUES (?, ?, ?, ?)')
      .run(uuid(), user.id, verifiedRawUsdc, `sell-swap bridge-out failed: ${e.message}`.slice(0, 200));
    res.status(500).json({
      error: `Sell completed but bridging to Sui failed: ${e.message}. Your $${(verifiedRawUsdc / 1e6).toFixed(6)} USDC is safe — use Recover to retry.`,
    });
  }
});

// Receive the user-signed sell-transfer tx, countersign as fee payer, submit.
// Separate from /execute so the blockhash doesn't expire waiting for the backend.
router.post('/submit-sell-transfer', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { signedTx, blockhash, lastValidBlockHeight } = req.body;
  if (!signedTx) return res.status(400).json({ error: 'Missing signedTx' });

  try {
    const txHash = await countersignAndSubmitSellTransfer(signedTx, blockhash, lastValidBlockHeight);
    res.json({ txHash });
  } catch (e) {
    console.error('Submit sell transfer error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Submit a Jupiter buy tx that the user has signed with their Solana wallet.
// Records the trade position after on-chain confirmation.
router.post('/submit-buy-swap', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { signedTx, blockhash, lastValidBlockHeight, tradeInfo } = req.body;
  if (!signedTx || !tradeInfo) return res.status(400).json({ error: 'Missing signedTx or tradeInfo' });

  const { symbol, shares, price, total, chain } = tradeInfo;
  if (!symbol || !shares || !price || !chain) return res.status(400).json({ error: 'Incomplete tradeInfo' });

  try {
    const txHash = await submitJupiterBuyTransaction(signedTx, blockhash, lastValidBlockHeight);
    console.log('Buy swap confirmed:', txHash);

    // Record position
    const holding = db.prepare('SELECT * FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?')
      .get(user.id, chain, symbol);

    if (holding) {
      const newShares = holding.shares + shares;
      const newAvg = ((holding.avg_price * holding.shares) + (price * shares)) / newShares;
      db.prepare('UPDATE positions SET shares = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
        .run(newShares, newAvg, user.id, chain, symbol);
    } else {
      db.prepare('INSERT INTO positions (id, user_id, chain, symbol, shares, avg_price) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuid(), user.id, chain, symbol, shares, price);
    }

    db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, 'buy', symbol, shares, price, total, txHash, 'success');

    storeTradeReceipt({ userId: user.id, chain, type: 'buy', symbol, shares, price, total, txHash, timestamp: new Date().toISOString() }).catch(() => {});

    res.json({
      success: true,
      message: `Bought ${shares.toFixed(6)} ${symbol} @ $${price.toFixed(2)}`,
      txHash,
      total: total.toFixed(2),
    });
  } catch (e) {
    console.error('Submit buy swap error:', e);
    try {
      db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), user.id, chain, 'buy', symbol, shares, price, total, null, 'failed', e.message?.slice(0, 200));
    } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// Build an unsigned Solana tx to transfer $1 USDC from user's wallet → agent.
// Solana-native path: no Sui bridge needed when user already has Solana USDC.
router.post('/build-sol-gas-topup', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });

  try {
    const result = await buildSolGasTopupTransaction(user.sol_address);
    res.json(result);
  } catch (e) {
    console.error('build-sol-gas-topup error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Receive a user-signed USDC transfer to agent, countersign, submit, then topup SOL.
router.post('/submit-sol-gas-topup', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { signedTx, blockhash, lastValidBlockHeight } = req.body;
  if (!signedTx || !blockhash || !lastValidBlockHeight) {
    return res.status(400).json({ error: 'Missing signedTx, blockhash, or lastValidBlockHeight' });
  }

  try {
    await submitSolGasTopup(signedTx, blockhash, lastValidBlockHeight);
    res.json({ ok: true, message: 'Gas funded from Solana USDC. Proceeding with trade.' });
  } catch (e) {
    console.error('submit-sol-gas-topup error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Build an unsigned Solana tx to transfer arbitrary USDC from user's wallet → agent,
// in preparation for a Solana→Sui bridge.
router.post('/build-sol-to-sui-bridge', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });

  const { rawAmount } = req.body;
  if (!rawAmount || rawAmount <= 0) return res.status(400).json({ error: 'Missing or invalid rawAmount' });

  try {
    const result = await buildSolUsdcTransferToAgent(user.sol_address, rawAmount);
    res.json(result);
  } catch (e) {
    console.error('build-sol-to-sui-bridge error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Submit a user-signed USDC transfer (user→agent), then CCTP-bridge the USDC to Sui.
router.post('/submit-sol-to-sui-bridge', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { signedTx, blockhash, lastValidBlockHeight, userSuiAddress } = req.body;
  if (!signedTx || !blockhash || !lastValidBlockHeight || !userSuiAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Step 1: Submit the transfer, then measure what actually landed in the shared agent
  // ATA. Never trust a client-supplied rawAmount decoupled from the real signed transfer.
  let transferTxHash, verifiedRawAmount;
  try {
    transferTxHash = await countersignAndSubmit(signedTx, blockhash, lastValidBlockHeight, 'USDC bridge transfer');
    console.log('User USDC arrived in agent wallet — bridging to Sui...');
    verifiedRawAmount = Number(await getTokenAtaDelta(transferTxHash, process.env.AGENT_SOL_USDC_ATA));
    if (!(verifiedRawAmount > 0)) throw new Error('Transfer did not deposit USDC into agent wallet');
  } catch (e) {
    console.error('submit-sol-to-sui-bridge error (transfer step):', e);
    return res.status(500).json({ error: e.message });
  }

  try {
    const bridge = await bridgeUsdcSolanaToSui(verifiedRawAmount, userSuiAddress);
    res.json({ ok: true, suiMintTxHash: bridge.suiMintTxHash, burnTxHash: bridge.burnTxHash });
  } catch (e) {
    console.error('submit-sol-to-sui-bridge error (bridge step):', e);
    db.prepare('INSERT INTO pending_recoveries (id, user_id, raw_amount, reason) VALUES (?, ?, ?, ?)')
      .run(uuid(), user.id, verifiedRawAmount, `sol-to-sui bridge-out failed: ${e.message}`.slice(0, 200));
    res.status(500).json({
      error: `Transfer completed but bridging to Sui failed: ${e.message}. Your $${(verifiedRawAmount / 1e6).toFixed(6)} USDC is safe — use Recover to retry.`,
    });
  }
});

// Receive a Sui→Solana USDC bridge (by suiTxHash) and convert $0.50 to SOL for gas.
// Called by the frontend after the user approves a $1 gas-topup bridge from Sui.
router.post('/bridge-for-gas', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { suiTxHash } = req.body;
  if (!suiTxHash) return res.status(400).json({ error: 'Missing suiTxHash' });

  try {
    const { pollAttestation } = require('../lib/cctp');
    const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');
    const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
    const { ethers } = require('ethers');

    const client = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
    const txData = await client.getTransactionBlock({ digest: suiTxHash, options: { showEvents: true } });

    const messageEvent = txData.events?.find(e => e.type.includes('MessageSent'));
    if (!messageEvent) throw new Error('No MessageSent event in burn tx');
    const messageBytes = messageEvent.parsedJson?.message;
    if (!messageBytes) throw new Error('No message bytes in MessageSent event');

    const messageHex  = '0x' + Buffer.from(messageBytes).toString('hex');
    const messageHash = ethers.keccak256(messageHex);

    console.log('bridge-for-gas: polling attestation...');
    const attestation = await pollAttestation(messageHash);
    console.log('bridge-for-gas: minting USDC on Solana...');
    await receiveMessageOnSolana(messageHex, attestation);

    console.log('bridge-for-gas: topping up SOL from USDC...');
    await topUpGasFromUsdc();

    res.json({ ok: true, message: 'Gas funded. You can now proceed with your trade.' });
  } catch (e) {
    console.error('bridge-for-gas error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/execute', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { chain, action, suiTxHash, solTxHash, userSuiAddress } = req.body;
  if (!chain || !action) return res.status(400).json({ error: 'Missing params' });

  const { type, symbol, amount, currency } = action;
  if (!type || !symbol) return res.status(400).json({ error: 'Missing action params' });

  try {
    // Get current price
    const sym = symbol.replace('X', '').replace('x', '').toUpperCase();
    const priceData = await getPrice(sym);
    const price = parseFloat(priceData?.price || 0);
    if (!price) return res.status(400).json({ error: `No price data for ${symbol}` });

    // Calculate shares
    const shares = currency === 'usd' ? amount / price : amount;
    const priceCents = Math.round(price * 100);
    const total = shares * price;

    let txHash = null;

    if (process.env.TRADE_MODE === 'live') {
      if (chain === 'arbitrum' && user.evm_address) {
        const result = await executeArbTrade(user.evm_address, type, symbol, shares, priceCents);
        txHash = result.txHash;
      } else if (chain === 'sui') {
        if (type === 'sell') {
          // ── Sell: xStock (Solana) → USDC (Sui) ───────────────────────────────
          // The frontend has already transferred the user's xStock to the agent
          // wallet and submitted solTxHash. We swap and bridge back to Sui.
          if (!solTxHash)      return res.status(400).json({ error: 'Missing Solana transfer transaction (solTxHash)' });
          if (!userSuiAddress) return res.status(400).json({ error: 'Missing userSuiAddress' });

          const canonical  = symbol.replace(/x$/i, '').toUpperCase() + 'x';
          const mintAddress = XSTOCK_MINTS[canonical];
          if (!mintAddress) throw new Error(`Unknown xStock: ${symbol}`);

          const decimals = await getMintDecimals(mintAddress);
          const rawAmount = Math.round(shares * 10 ** decimals);

          // Gas check: ensure agent has SOL before swap. Auto-tops up from USDC if possible.
          const gasStatus = await ensureGas();
          if (!gasStatus.ok) {
            const userSolUsdcBalance = await getUserSolUsdcBalance(user.sol_address);
            return res.status(402).json({
              error: 'GAS_INSUFFICIENT',
              needsBridge: true,
              solBalance: gasStatus.solBalance,
              usdcBalance: gasStatus.usdcBalance,
              userSolUsdcBalance,
            });
          }

          // Step 1: Swap xStock → USDC via Jupiter (agent wallet)
          console.log('Sell Step 1: Jupiter xStock → USDC');
          const swapResult = await jupiterSwapXStockToUsdc(mintAddress, rawAmount);
          txHash = swapResult.txHash;
          console.log('Swap complete:', txHash, '→', swapResult.usdcAmount, 'USDC');

          const feeBps = parseInt(process.env.PLATFORM_FEE_BPS || '0');
          const sellFeeRaw = Math.round(swapResult.rawUsdcAmount * feeBps / 10000);
          const bridgeRaw = Math.max(swapResult.rawUsdcAmount - sellFeeRaw, 0);
          if (bridgeRaw <= 0) throw new Error('Sell proceeds too small to bridge');
          console.log(`Sell fee: $${(sellFeeRaw/1e6).toFixed(4)} → bridging ${(bridgeRaw/1e6).toFixed(6)} USDC`);

          // Step 2: Bridge USDC Solana → Sui (burn on Solana, attest, mint on Sui)
          console.log('Sell Step 2: Bridging USDC Solana → Sui for', userSuiAddress);
          const bridge = await bridgeUsdcSolanaToSui(bridgeRaw, userSuiAddress);
          console.log('Bridge complete. Sui mint tx:', bridge.suiMintTxHash);

        } else {
          // ── Buy: USDC (Sui) → xStock (Solana) ────────────────────────────────
          // USDC is minted directly to the user's own Solana USDC ATA.
          // The agent only collects the fee; the swap happens from the user's wallet.
          const usdcAmountGross = currency === 'usd' ? amount : shares * price;
          const feeBps = parseInt(process.env.PLATFORM_FEE_BPS || '0');
          const grossUsdcRaw = Math.round(usdcAmountGross * 1e6);

          if (!suiTxHash) return res.status(400).json({ error: 'Missing Sui burn transaction' });

          const userSolAddress = db.prepare('SELECT sol_address FROM users WHERE id = ?').get(user.id)?.sol_address;
          if (!userSolAddress) return res.status(400).json({ error: 'No Solana address on account' });

          // Step 1: Get attestation for the user-signed burn tx
          console.log('Step 1: Getting attestation for burn tx:', suiTxHash);
          const { pollAttestation } = require('../lib/cctp');
          const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');

          const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
          const suiClient = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
          const txData = await suiClient.getTransactionBlock({
            digest: suiTxHash,
            options: { showEvents: true },
          });

          const messageEvent = txData.events?.find(e => e.type.includes('MessageSent'));
          if (!messageEvent) throw new Error('No MessageSent event in burn tx');

          const { ethers } = require('ethers');
          const messageBytes = messageEvent.parsedJson?.message;
          if (!messageBytes) throw new Error('No message bytes in MessageSent event');

          const messageHex  = '0x' + Buffer.from(messageBytes).toString('hex');
          const messageHash = ethers.keccak256(messageHex);
          console.log('Message hex:', messageHex.slice(0, 20) + '...');
          console.log('Message hash:', messageHash);

          // Step 2: Poll Circle attestation
          console.log('Step 2: Polling attestation...');
          const attestation = await pollAttestation(messageHash);

          // Step 3: Gas check BEFORE minting — burn tx stays redeemable if this fails
          console.log('Step 3: Checking gas...');
          const gasStatus = await ensureGas();
          if (!gasStatus.ok) {
            const userSolUsdcBalance = await getUserSolUsdcBalance(user.sol_address);
            return res.status(402).json({
              error: 'GAS_INSUFFICIENT',
              needsBridge: true,
              suiTxHash,
              solBalance: gasStatus.solBalance,
              usdcBalance: gasStatus.usdcBalance,
              userSolUsdcBalance,
            });
          }

          // Step 4: Ensure user's USDC ATA exists (agent pays rent if first time)
          console.log('Step 4: Ensuring user USDC ATA exists...');
          await ensureUserUsdcAta(userSolAddress);
          const userUsdcAta = getUserUsdcAta(userSolAddress);

          // Step 5: Mint USDC to user's own USDC ATA (not agent's)
          console.log('Step 5: Minting USDC to user ATA:', userUsdcAta.toBase58());
          await receiveMessageOnSolana(messageHex, attestation, userUsdcAta.toBase58());

          // Step 6: Build Jupiter buy tx — fee transfer + swap in one tx, agent pre-signs as fee payer
          console.log('Step 6: Building Jupiter buy tx from user wallet...');
          const swapTxData = await buildJupiterBuyTransaction(userSolAddress, symbol, grossUsdcRaw, feeBps);

          // Return the unsigned tx to the frontend for user to sign with their Solana wallet.
          // Position is recorded after the user signs and /submit-buy-swap confirms.
          return res.json({
            needsSwapSignature: true,
            swapTx: swapTxData.txBase64,
            blockhash: swapTxData.blockhash,
            lastValidBlockHeight: swapTxData.lastValidBlockHeight,
            mintAddress: swapTxData.mintAddress,
            feeRaw: swapTxData.feeRaw,
            swapRaw: swapTxData.swapRaw,
            tradeInfo: { symbol, shares, price, total, chain },
          });
        }
      }
    } else {
      txHash = '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    }

    // Track position in DB
    const holding = db.prepare(
      'SELECT * FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?'
    ).get(user.id, chain, symbol);

    if (type === 'buy') {
      if (holding) {
        const newShares = holding.shares + shares;
        const newAvg = ((holding.avg_price * holding.shares) + (price * shares)) / newShares;
        db.prepare('UPDATE positions SET shares = ?, avg_price = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(newShares, newAvg, user.id, chain, symbol);
      } else {
        db.prepare('INSERT INTO positions (id, user_id, chain, symbol, shares, avg_price) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuid(), user.id, chain, symbol, shares, price);
      }
    } else if (type === 'sell') {
      if (!holding || holding.shares < shares) {
        return res.status(400).json({ error: `Insufficient ${symbol} shares` });
      }
      const newShares = holding.shares - shares;
      if (newShares < 0.0001) {
        db.prepare('DELETE FROM positions WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(user.id, chain, symbol);
      } else {
        db.prepare('UPDATE positions SET shares = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND chain = ? AND symbol = ?')
          .run(newShares, user.id, chain, symbol);
      }
    }

    // Record transaction
    db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, type, symbol, shares, price, total, txHash, 'success');

    // Store immutable trade receipt on Walrus (non-blocking — don't await)
    storeTradeReceipt({
      userId: user.id,
      chain,
      type,
      symbol,
      shares,
      price,
      total,
      txHash,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    res.json({
      success: true,
      message: `${type === 'buy' ? 'Bought' : 'Sold'} ${shares.toFixed(6)} ${symbol} @ $${price.toFixed(2)}`,
      txHash,
      total: total.toFixed(2),
    });

  } catch (e) {
    console.error('Trade error:', e);
    // Record the failed trade attempt so it shows in activity history
    try {
      const sym = symbol?.replace('X', '').replace('x', '').toUpperCase();
      const priceData = sym ? await getPrice(sym).catch(() => null) : null;
      const failPrice = parseFloat(priceData?.price || 0);
      const failShares = (currency === 'usd' && failPrice) ? amount / failPrice : (amount || 0);
      db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), user.id, chain, type, symbol, failShares, failPrice, failShares * failPrice, null, 'failed', e.message?.slice(0, 200));
    } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// Bridge USDC from Sui → Solana. The frontend burned USDC on Sui with the user's own
// USDC ATA as mintRecipient; this route attests and mints directly into that ATA.
router.post('/bridge-to-solana', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!user.sol_address) return res.status(400).json({ error: 'No Solana address on account' });

  const { suiTxHash, rawAmount } = req.body;
  if (!suiTxHash) return res.status(400).json({ error: 'Missing suiTxHash' });
  if (!rawAmount)  return res.status(400).json({ error: 'Missing rawAmount' });

  try {
    const { pollAttestation } = require('../lib/cctp');
    const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');
    const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
    const { ethers } = require('ethers');

    // Step 1: Extract CCTP message from Sui burn tx
    const suiClient = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
    const txData = await suiClient.getTransactionBlock({ digest: suiTxHash, options: { showEvents: true } });
    const messageEvent = txData.events?.find(e => e.type.includes('MessageSent'));
    if (!messageEvent) throw new Error('No MessageSent event in burn tx');
    const messageBytes = messageEvent.parsedJson?.message;
    if (!messageBytes) throw new Error('No message bytes in MessageSent event');

    const messageHex  = '0x' + Buffer.from(messageBytes).toString('hex');
    const messageHash = ethers.keccak256(messageHex);

    // Step 2: Poll Circle attestation
    console.log('bridge-to-solana: polling attestation...');
    const attestation = await pollAttestation(messageHash);

    // Step 3: Read mintRecipient directly from the CCTP message (offset 152, 32 bytes).
    // CCTP BurnMessage layout: 116-byte header + body[version(4), burnToken(32), mintRecipient(32), ...]
    // This is the exact address the Sui burn encoded — no re-derivation, no DB mismatch.
    const msgBuf = Buffer.from(messageHex.replace('0x', ''), 'hex');
    const { PublicKey: SolPubkey } = require('@solana/web3.js');
    const mintRecipientFromMessage = new SolPubkey(msgBuf.slice(152, 184)).toBase58();
    await ensureUserUsdcAta(user.sol_address);
    console.log('bridge-to-solana: minting USDC on Solana to', mintRecipientFromMessage);
    const mintResult = await receiveMessageOnSolana(messageHex, attestation, mintRecipientFromMessage);

    res.json({
      ok: true,
      mintTxHash: mintResult.txHash,
      amount: rawAmount / 1e6,
      message: `$${(rawAmount / 1e6).toFixed(2)} USDC bridged to your Solana wallet`,
    });
  } catch (e) {
    console.error('bridge-to-solana error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Bridge USDC that got stuck in the shared agent wallet from a failed/incomplete bridge
// back to the user's Sui wallet. The agent ATA pools funds from ALL users, so the amount
// recoverable is capped by this user's own pending_recoveries ledger, never by the pool's
// total balance or a client-supplied figure — otherwise one user could drain another's
// in-flight funds.
router.post('/recover-solana-usdc', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userSuiAddress } = req.body;
  if (!userSuiAddress) return res.status(400).json({ error: 'Missing userSuiAddress' });

  try {
    const { total: owedRaw } = db.prepare(
      `SELECT COALESCE(SUM(raw_amount), 0) as total FROM pending_recoveries WHERE user_id = ? AND consumed_at IS NULL`
    ).get(user.id);

    if (!owedRaw) {
      return res.json({ success: true, message: 'No recoverable USDC on record for your account', balance: 0 });
    }

    const { getConnection: _getSolConn } = require('../lib/solana_connection');
    const { PublicKey: _PublicKey } = require('@solana/web3.js');
    const connection = _getSolConn();
    const usdcATA = new _PublicKey(process.env.AGENT_SOL_USDC_ATA);
    const balanceInfo = await connection.getTokenAccountBalance(usdcATA);
    const agentBalance = parseInt(balanceInfo.value.amount, 10);

    if (agentBalance < owedRaw) {
      return res.status(409).json({ error: 'Agent wallet balance is temporarily lower than your recoverable amount — try again shortly.' });
    }

    console.log(`Recovering ${owedRaw} μUSDC from Solana → Sui (${userSuiAddress}) for user ${user.id}`);
    const result = await bridgeUsdcSolanaToSui(owedRaw, userSuiAddress);

    db.prepare(`UPDATE pending_recoveries SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = ? AND consumed_at IS NULL`)
      .run(user.id);

    res.json({
      success: true,
      message: `Bridged ${(owedRaw / 1e6).toFixed(6)} USDC from Solana to your Sui wallet`,
      usdcAmount: owedRaw / 1e6,
      ...result,
    });
  } catch (e) {
    console.error('Recover USDC error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Returns this user's own recoverable USDC (sum of unconsumed pending_recoveries), used by
// the frontend RECOVER button. Deliberately scoped per-user, not the agent's total balance.
router.get('/recoverable-balance', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { total } = db.prepare(
      `SELECT COALESCE(SUM(raw_amount), 0) as total FROM pending_recoveries WHERE user_id = ? AND consumed_at IS NULL`
    ).get(user.id);
    res.json({ rawAmount: total, usdcBalance: total / 1e6 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get transaction history
router.get('/history', (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const txs = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);
  res.json({ transactions: txs });
});

module.exports = router;
