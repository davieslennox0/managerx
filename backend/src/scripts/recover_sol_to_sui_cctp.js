'use strict';
/**
 * Recovery script: complete an in-flight Solana→Sui CCTP V1 transfer.
 *
 * The depositForBurn already happened (Solana tx
 * 5MiL4Z8qG6qDwC6zEs513PXwCP3fqUySDmFUG8ncPQBfyx1vLVMdbwbb3mxKNJ2YbF455bGFjnge2VXwafRC9d17).
 * The messageSentEventData account
 * (HccnWpVhtxZdzcx1j1mX8ZAmMJsLwtGvyhZ1obXSyXtx) already holds the 248-byte
 * CCTP message at byte offset 44.
 *
 * Account layout (292 bytes total):
 *   [0..8)   Anchor discriminator
 *   [8..40)  sender_authority pubkey (32 bytes, same value as BurnMessage.messageSender)
 *   [40..44) Vec<u8> length LE u32 = 248
 *   [44..292) CCTP V1 message (248 bytes)
 *
 * This script:
 *   1. Extracts message bytes from the hardcoded raw hex (or live account fetch)
 *   2. Computes keccak256 hash and validates source/dest domains + mintRecipient
 *   3. Polls Circle Iris API until attestation is complete
 *   4. Calls receiveMessage on Sui to mint $3 USDC
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../..', '.env') });
// Also try backend/.env directly in case the monorepo root .env doesn't exist
require('dotenv').config({ path: require('path').resolve(__dirname, '../..', '.env') });

const { Connection, PublicKey } = require('@solana/web3.js');
const { ethers } = require('ethers');
const axios = require('axios');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');

// ── Known constants ────────────────────────────────────────────────────────────
const EVENT_DATA_ACCOUNT = 'HccnWpVhtxZdzcx1j1mX8ZAmMJsLwtGvyhZ1obXSyXtx';
const SOLANA_BURN_TX    = '5MiL4Z8qG6qDwC6zEs513PXwCP3fqUySDmFUG8ncPQBfyx1vLVMdbwbb3mxKNJ2YbF455bGFjnge2VXwafRC9d17';

// Raw hex captured from the 292-byte messageSentEventData account.
// Used as fallback when the live RPC account fetch is unavailable.
const RAW_ACCOUNT_HEX =
  '83648538a6e1973c7b4383237494a4db0ac6b50b976f0f678ce1c4251132848f' +
  'f32322c53d73118df800000000000000000000050000000800000000000aec55' +
  'a65fc943419a5ad590042fd67c9791fd015acf53a54cc823edb8ff81b9ed722e' +
  'afdc792c79ad11215d6661cc06320d48b9f7dd46f4e9d4901c45986fa430e3c8' +
  '000000000000000000000000000000000000000000000000000000000000000000000000' +
  'c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61' +
  'f8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e4' +
  '00000000000000000000000000000000000000000000000000000000002dc6c0' +
  '7b4383237494a4db0ac6b50b976f0f678ce1c4251132848ff32322c53d73118d';

const MSG_OFFSET = 44;   // byte offset where CCTP message begins in account data
const MSG_LENGTH = 248;  // CCTP V1 message is always 248 bytes for a BurnMessage

// Expected field values for sanity-check
const EXPECTED_SOURCE_DOMAIN = 5;   // Solana
const EXPECTED_DEST_DOMAIN   = 8;   // Sui
const EXPECTED_MINT_RECIPIENT = 'f8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e4';

// ── Sui CCTP V1 addresses ─────────────────────────────────────────────────────
const SUI_CCTP = {
  MT_PKG:    '0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b',
  TMM_PKG:   '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e',
  MT_STATE:  '0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af',
  TMM_STATE: '0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f',
  TREASURY:  '0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7',
  DENY_LIST: '0x0000000000000000000000000000000000000000000000000000000000000403',
};
const USDC_SUI_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// ── Step 1: extract + validate message bytes ───────────────────────────────────
async function extractMessageBytes() {
  let accountData;

  // Try live RPC first, fall back to hardcoded hex.
  try {
    const connection = require('../lib/solana_connection').getConnection();
    const info = await connection.getAccountInfo(new PublicKey(EVENT_DATA_ACCOUNT));
    if (!info) throw new Error('Account not found on-chain');
    accountData = info.data;
    console.log('Fetched live account data from RPC (%d bytes).', accountData.length);
  } catch (e) {
    console.warn('RPC fetch failed (%s) — using hardcoded hex.', e.message);
    accountData = Buffer.from(RAW_ACCOUNT_HEX.replace(/\s/g, ''), 'hex');
  }

  if (accountData.length < MSG_OFFSET + MSG_LENGTH) {
    throw new Error(
      `Account data too short: ${accountData.length} bytes, expected at least ${MSG_OFFSET + MSG_LENGTH}`
    );
  }

  // Verify Vec<u8> length prefix at bytes 40-43 (LE u32).
  const vecLen = accountData.readUInt32LE(40);
  if (vecLen !== MSG_LENGTH) {
    throw new Error(`Unexpected Vec<u8> length: ${vecLen}, expected ${MSG_LENGTH}`);
  }

  const msgBuf = accountData.slice(MSG_OFFSET, MSG_OFFSET + MSG_LENGTH);

  // Validate CCTP fields (all big-endian per spec).
  const version      = msgBuf.readUInt32BE(0);
  const sourceDomain = msgBuf.readUInt32BE(4);
  const destDomain   = msgBuf.readUInt32BE(8);

  // mintRecipient is at BurnMessage offset 152-183 (within the 248-byte message).
  // BurnMessage starts at message offset 116.
  // mintRecipient = BurnMessage offset 36 → message offset 152.
  const mintRecipient = msgBuf.slice(152, 184).toString('hex');

  // amount (uint256 big-endian) is at BurnMessage offset 68 → message offset 184.
  const amountHex = msgBuf.slice(184, 216).toString('hex');
  const amount    = BigInt('0x' + amountHex);

  console.log('\n=== CCTP message validation ===');
  console.log('  version:        ', version);
  console.log('  sourceDomain:   ', sourceDomain, '(Solana = 5)');
  console.log('  destDomain:     ', destDomain,   '(Sui = 8)');
  console.log('  mintRecipient:  ', '0x' + mintRecipient);
  console.log('  amount:         ', amount.toString(), 'μUSDC =', (Number(amount) / 1e6).toFixed(6), 'USDC');

  if (version !== 0) throw new Error(`Bad CCTP version: ${version}`);
  if (sourceDomain !== EXPECTED_SOURCE_DOMAIN) throw new Error(`Bad source domain: ${sourceDomain}`);
  if (destDomain   !== EXPECTED_DEST_DOMAIN)   throw new Error(`Bad dest domain: ${destDomain}`);
  if (mintRecipient !== EXPECTED_MINT_RECIPIENT) {
    throw new Error(`mintRecipient mismatch:\n  got:      ${mintRecipient}\n  expected: ${EXPECTED_MINT_RECIPIENT}`);
  }

  const messageHex  = '0x' + msgBuf.toString('hex');
  const messageHash = ethers.keccak256(messageHex);

  console.log('  messageHash:    ', messageHash);
  return { messageHex, messageHash };
}

// ── Step 2: poll Circle Iris API ───────────────────────────────────────────────
async function pollAttestation(messageHash, timeoutMs = 300_000) {
  const url      = `https://iris-api.circle.com/v1/attestations/${messageHash}`;
  const deadline = Date.now() + timeoutMs;

  console.log('\nPolling Circle Iris for attestation...');
  console.log('  hash:', messageHash);

  while (Date.now() < deadline) {
    try {
      const res = await axios.get(url, { timeout: 10_000 });
      const { status, attestation } = res.data || {};
      console.log('  status:', status || 'unknown');
      if (status === 'complete' && attestation) return attestation;
    } catch (e) {
      const code = e.response?.status;
      if (code !== 404) console.log('  poll error:', code || e.message);
    }
    await new Promise(r => setTimeout(r, 8_000));
  }
  throw new Error(`Attestation timed out after ${timeoutMs / 1000}s`);
}

// ── Step 3: receiveMessage on Sui ──────────────────────────────────────────────
async function receiveMessageOnSui(messageHex, attestationHex) {
  const suiRpc  = process.env.SUI_RPC_URL || getFullnodeUrl('mainnet');
  const client  = new SuiClient({ url: suiRpc });
  const keypair = Ed25519Keypair.fromSecretKey(process.env.SUI_AGENT_PRIVATE_KEY);

  const messageBytes = Array.from(Buffer.from(messageHex.replace('0x', ''), 'hex'));
  const attestBytes  = Array.from(Buffer.from(attestationHex.replace('0x', ''), 'hex'));

  const tx = new Transaction();

  // [0] Verify attestation + mark nonce used → Receipt
  const [receipt] = tx.moveCall({
    target: `${SUI_CCTP.MT_PKG}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector('u8', messageBytes),
      tx.pure.vector('u8', attestBytes),
      tx.object(SUI_CCTP.MT_STATE),
    ],
  });

  // [1] Mint USDC → StampReceiptTicketWithBurnMessage
  const [stampTicketWithBurnMsg] = tx.moveCall({
    target: `${SUI_CCTP.TMM_PKG}::handle_receive_message::handle_receive_message`,
    typeArguments: [USDC_SUI_TYPE],
    arguments: [
      receipt,
      tx.object(SUI_CCTP.TMM_STATE),
      tx.object(SUI_CCTP.DENY_LIST),
      tx.object(SUI_CCTP.TREASURY),
    ],
  });

  // [2] Deconstruct → StampReceiptTicket + BurnMessage (BurnMessage has `drop`)
  const [stampReceiptTicket] = tx.moveCall({
    target: `${SUI_CCTP.TMM_PKG}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [stampTicketWithBurnMsg],
  });

  // [3] Stamp the receipt
  const [stampedReceipt] = tx.moveCall({
    target: `${SUI_CCTP.MT_PKG}::receive_message::stamp_receipt`,
    typeArguments: [`${SUI_CCTP.TMM_PKG}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
    arguments: [
      stampReceiptTicket,
      tx.object(SUI_CCTP.MT_STATE),
    ],
  });

  // [4] Finalize
  tx.moveCall({
    target: `${SUI_CCTP.MT_PKG}::receive_message::complete_receive_message`,
    arguments: [
      stampedReceipt,
      tx.object(SUI_CCTP.MT_STATE),
    ],
  });

  console.log('\nSubmitting Sui receiveMessage PTB...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  const status = result.effects?.status?.status;
  if (status !== 'success') {
    throw new Error('Sui tx failed: ' + JSON.stringify(result.effects?.status));
  }

  console.log('Sui digest:', result.digest);
  return result.digest;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Solana→Sui CCTP V1 recovery ===');
  console.log('Solana burn tx:', SOLANA_BURN_TX);
  console.log('Event account: ', EVENT_DATA_ACCOUNT);

  const { messageHex, messageHash } = await extractMessageBytes();

  const attestation = await pollAttestation(messageHash);

  const suiDigest = await receiveMessageOnSui(messageHex, attestation);

  console.log('\n=== Recovery complete ===');
  console.log('Solana burn tx:', SOLANA_BURN_TX);
  console.log('Sui mint tx:   ', suiDigest);
  console.log('USDC minted to:', '0x' + EXPECTED_MINT_RECIPIENT);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  if (e.logs) console.error('Logs:\n', e.logs.join('\n'));
  process.exit(1);
});
