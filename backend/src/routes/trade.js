const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { getPrice } = require('./prices');
const { executeArbTrade } = require('../lib/arbitrum');
const { executeSuiTrade } = require('../lib/sui');
const { jupiterSwap } = require('../lib/solana');
const { bridgeUsdcSuiToSolana } = require('../lib/cctp');

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

router.post('/execute', async (req, res) => {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { chain, action, suiTxHash } = req.body;
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
        const usdcAmount = currency === 'usd' ? amount : shares * price;

        if (!suiTxHash) return res.status(400).json({ error: 'Missing Sui burn transaction' });

        // Step 1: Get attestation for the user-signed burn tx
        console.log('Step 1: Getting attestation for burn tx:', suiTxHash);
        const { pollAttestation } = require('../lib/cctp');
        const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');

        // Get message hash from Sui tx events
        const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
        const client = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
        const txData = await client.getTransactionBlock({
          digest: suiTxHash,
          options: { showEvents: true },
        });

        const messageEvent = txData.events?.find(e => e.type.includes('MessageSent'));
        if (!messageEvent) throw new Error('No MessageSent event in burn tx');
        
        // message is a byte array - need to hash it for Circle's Iris API
        const { ethers } = require('ethers');
        const messageBytes = messageEvent.parsedJson?.message;
        if (!messageBytes) throw new Error('No message bytes in MessageSent event');
        
        const messageHex = '0x' + Buffer.from(messageBytes).toString('hex');
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
