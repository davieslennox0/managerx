const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getPrice } = require('./prices');
const { executeArbTrade } = require('../lib/arbitrum');
const { executeSuiTrade, sponsorSuiTransaction } = require('../lib/sui');
const { jupiterSwap, jupiterSwapXStockToUsdc, buildSellTransferTransaction, transferXStockToUser, estimateGasCostUsdc, XSTOCK_MINTS } = require('../lib/solana');
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

    // xStock tokens use 6 decimals (consistent with Jupiter's outAmount / 1e6 convention)
    const rawAmount = Math.round(shares * 1e6);
    const transaction = await buildSellTransferTransaction(mintAddress, user.sol_address, rawAmount);

    res.json({ transaction, mintAddress, rawAmount, shares });
  } catch (e) {
    console.error('Build sell transfer error:', e);
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

          const rawAmount = Math.round(shares * 1e6);

          // Step 1: Swap xStock → USDC via Jupiter (agent wallet)
          console.log('Sell Step 1: Jupiter xStock → USDC');
          const swapResult = await jupiterSwapXStockToUsdc(mintAddress, rawAmount);
          txHash = swapResult.txHash;
          console.log('Swap complete:', txHash, '→', swapResult.usdcAmount, 'USDC');

          // Deduct gas for swap tx + bridge burn tx from the USDC output before bridging.
          const sellGasCostUsdc = await estimateGasCostUsdc(2);
          const sellGasCostRaw  = Math.round(sellGasCostUsdc * 1e6);
          const bridgeRaw = Math.max(swapResult.rawUsdcAmount - sellGasCostRaw, 0);
          if (bridgeRaw <= 0) throw new Error(`Sell proceeds too small to cover gas fees (~$${sellGasCostUsdc.toFixed(4)})`);
          console.log(`Sell gas deduction: $${sellGasCostUsdc.toFixed(4)} → bridging ${(bridgeRaw/1e6).toFixed(6)} USDC`);

          // Step 2: Bridge USDC Solana → Sui (burn on Solana, attest, mint on Sui)
          console.log('Sell Step 2: Bridging USDC Solana → Sui for', userSuiAddress);
          const bridge = await bridgeUsdcSolanaToSui(bridgeRaw, userSuiAddress);
          console.log('Bridge complete. Sui mint tx:', bridge.suiMintTxHash);

        } else {
          // ── Buy: USDC (Sui) → xStock (Solana) ────────────────────────────────
          const usdcAmount = currency === 'usd' ? amount : shares * price;

          if (!suiTxHash) return res.status(400).json({ error: 'Missing Sui burn transaction' });

          // Step 1: Get attestation for the user-signed burn tx
          console.log('Step 1: Getting attestation for burn tx:', suiTxHash);
          const { pollAttestation } = require('../lib/cctp');
          const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');

          const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
          const client = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
          const txData = await client.getTransactionBlock({
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

          // Step 3: Mint USDC on Solana
          console.log('Step 3: Minting on Solana...');
          await receiveMessageOnSolana(messageHex, attestation);

          // Step 4: Swap on Jupiter
          console.log('Step 4: Swapping on Jupiter...');
          const swap = await jupiterSwap(process.env.AGENT_SOL_ADDRESS, symbol, usdcAmount);
          txHash = swap.txHash;
          console.log('Swap complete:', txHash);

          // Step 5: Transfer xStock tokens from agent wallet to user's Solana address
          const userSolAddress = db.prepare('SELECT sol_address FROM users WHERE id = ?').get(user.id)?.sol_address;
          if (userSolAddress) {
            console.log('Step 5: Transferring xStock to user:', userSolAddress);
            const transferTx = await transferXStockToUser(swap.mintAddress, userSolAddress, swap.rawOutputAmount);
            console.log('Transfer complete:', transferTx);
          } else {
            console.warn('Step 5: No sol_address for user', user.id, '— tokens remain in agent wallet');
          }
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
    db.prepare('INSERT INTO transactions (id, user_id, chain, type, symbol, shares, price, total, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), user.id, chain, type, symbol, shares, price, total, txHash);

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
    res.status(500).json({ error: e.message });
  }
});

// Build CCTP burn transaction for user to sign
router.post('/build-burn', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { amount, currency, suiAddress } = req.body;
  
  try {
    const { Transaction } = require('@mysten/sui/transactions');
    const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

    const SUI_CCTP = {
      tokenMessengerMinter: '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e',
      tokenMessengerMinterState: '0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f',
      messageTransmitterState: '0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af',
      usdcTreasury: '0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7',
      denyList: '0x0000000000000000000000000000000000000000000000000000000000000403',
    };

    const USDC_SUI_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    const SOLANA_DOMAIN = 5;
    const AGENT_SOL_USDC_ATA = process.env.AGENT_SOL_USDC_ATA;

    // Convert Solana ATA to bytes32
    const { PublicKey } = require('@solana/web3.js');
    const ataBytes = Array.from(new PublicKey(AGENT_SOL_USDC_ATA).toBytes());

    const client = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
    const amountUsdc = currency === 'usd' ? amount : amount;
    const amountMist = BigInt(Math.round(amountUsdc * 1e6));

    // Get user's USDC coins
    const coins = await client.getCoins({ owner: suiAddress, coinType: USDC_SUI_TYPE });
    if (!coins.data.length) return res.status(400).json({ error: 'No USDC in Sui wallet' });

    const coin = coins.data.find(c => BigInt(c.balance) >= amountMist);
    if (!coin) return res.status(400).json({ error: 'Insufficient USDC balance' });

    const tx = new Transaction();
    tx.setSender(suiAddress);

    let coinToUse;
    if (BigInt(coin.balance) === amountMist) {
      coinToUse = tx.object(coin.coinObjectId);
    } else {
      const [splitCoin] = tx.splitCoins(tx.object(coin.coinObjectId), [amountMist]);
      coinToUse = splitCoin;
    }

    tx.moveCall({
      target: `${SUI_CCTP.tokenMessengerMinter}::deposit_for_burn::deposit_for_burn`,
      typeArguments: [USDC_SUI_TYPE],
      arguments: [
        coinToUse,
        tx.pure.u32(SOLANA_DOMAIN),
        tx.pure.vector('u8', ataBytes),
        tx.object(SUI_CCTP.tokenMessengerMinterState),
        tx.object(SUI_CCTP.messageTransmitterState),
        tx.object(SUI_CCTP.denyList),
        tx.object(SUI_CCTP.usdcTreasury),
      ],
    });

    // Serialize transaction for frontend
    const txBytes = await tx.build({ client });
    const txBase64 = Buffer.from(txBytes).toString('base64');

    res.json({ transaction: txBase64, amount: amountUsdc });
  } catch (e) {
    console.error('Build burn error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Check agent's Solana USDC balance and bridge any amount to the user's Sui wallet.
// Useful for recovering USDC that got stuck in the agent wallet from a failed/incomplete bridge.
router.post('/recover-solana-usdc', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { userSuiAddress } = req.body;
  if (!userSuiAddress) return res.status(400).json({ error: 'Missing userSuiAddress' });

  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed'
    );

    const usdcATA = new PublicKey(process.env.AGENT_SOL_USDC_ATA);
    const balanceInfo = await connection.getTokenAccountBalance(usdcATA);
    const rawBalance = parseInt(balanceInfo.value.amount, 10);

    if (rawBalance === 0) {
      return res.json({ success: true, message: 'No USDC found on Solana agent wallet', balance: 0 });
    }

    console.log(`Recovering ${rawBalance} μUSDC from Solana → Sui (${userSuiAddress})`);
    const result = await bridgeUsdcSolanaToSui(rawBalance, userSuiAddress);

    res.json({
      success: true,
      message: `Bridged ${(rawBalance / 1e6).toFixed(6)} USDC from Solana to your Sui wallet`,
      usdcAmount: rawBalance / 1e6,
      ...result,
    });
  } catch (e) {
    console.error('Recover USDC error:', e);
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
