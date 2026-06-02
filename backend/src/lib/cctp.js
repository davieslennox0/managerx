const axios = require('axios');
const { ethers } = require('ethers');

// Circle CCTP domain IDs
const DOMAINS = { sui: 8, arbitrum: 3, ethereum: 0 };

// Circle Attestation API
const CIRCLE_API = 'https://iris-api.circle.com/attestations';

// Arbitrum CCTP contracts
const ARB_MESSAGE_TRANSMITTER = process.env.CCTP_ARB_TRANSMITTER || '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC on Arbitrum

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

/**
 * Step 1: Burn USDC on source chain (Sui side — handled by Sui contract)
 * This function polls Circle for the attestation after burn TX is submitted
 */
async function waitForAttestation(burnTxHash, sourceDomain = DOMAINS.sui) {
  const messageHash = burnTxHash; // In prod: parse message bytes from burn TX log

  console.log(`⏳ Waiting for Circle attestation for TX: ${burnTxHash}`);

  // Poll Circle attestation API
  for (let i = 0; i < 30; i++) {
    try {
      await sleep(6000); // Poll every 6s, Circle takes ~15-30s
      const res = await axios.get(`${CIRCLE_API}/${messageHash}`);
      if (res.data?.status === 'complete') {
        console.log('✅ Attestation received');
        return {
          attestation: res.data.attestation,
          message: res.data.message,
        };
      }
    } catch (e) {
      // Not ready yet
    }
  }

  // Mock attestation for demo/testnet
  console.log('⚠️  Using mock attestation (demo mode)');
  return {
    attestation: '0x' + 'ab'.repeat(65),
    message: '0x' + 'cd'.repeat(100),
    mock: true,
  };
}

/**
 * Step 2: Mint USDC on Arbitrum using Circle attestation
 */
async function mintOnArbitrum(message, attestation, recipientAddress) {
  const tradeMode = process.env.TRADE_MODE || 'mock';

  if (tradeMode === 'mock') {
    console.log(`🔵 [MOCK] Minting USDC on Arbitrum for ${recipientAddress}`);
    return {
      txHash: '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
      mock: true,
    };
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const transmitter = new ethers.Contract(ARB_MESSAGE_TRANSMITTER, MESSAGE_TRANSMITTER_ABI, wallet);

  const tx = await transmitter.receiveMessage(message, attestation);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Full bridge flow: Sui → Arbitrum
 * Called by the AI agent automatically when needed
 */
async function bridgeSuiToArbitrum(params) {
  const { userId, amountUsdc, suiAddress, evmAddress, burnTxHash, db } = params;

  console.log(`🌉 Bridge initiated: $${amountUsdc / 1e6} USDC | ${suiAddress} → ${evmAddress}`);

  // Record bridge request
  const { v4: uuid } = require('uuid');
  const bridgeId = uuid();
  db.prepare(`
    INSERT INTO bridge_requests (id, user_id, amount_usdc, from_chain, to_chain, from_address, to_address, cctp_nonce, status)
    VALUES (?, ?, ?, 'sui', 'arbitrum', ?, ?, ?, 'pending')
  `).run(bridgeId, userId, amountUsdc / 1e6, suiAddress, evmAddress, burnTxHash || bridgeId);

  try {
    // Step 1: Wait for Circle attestation
    const { attestation, message, mock } = await waitForAttestation(burnTxHash || bridgeId);

    // Step 2: Mint on Arbitrum
    const { txHash } = await mintOnArbitrum(message, attestation, evmAddress);

    // Step 3: Update balances in DB
    db.prepare(`UPDATE users SET arb_usdc_balance = arb_usdc_balance + ? WHERE id = ?`)
      .run(amountUsdc / 1e6, userId);

    db.prepare(`UPDATE bridge_requests SET status = 'completed', attestation = ?, completed_at = datetime('now') WHERE id = ?`)
      .run(attestation, bridgeId);

    console.log(`✅ Bridge complete. Arbitrum TX: ${txHash}`);
    return { success: true, txHash, bridgeId, mock: !!mock };

  } catch (e) {
    db.prepare(`UPDATE bridge_requests SET status = 'failed' WHERE id = ?`).run(bridgeId);
    throw e;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { bridgeSuiToArbitrum, waitForAttestation, mintOnArbitrum, DOMAINS };
