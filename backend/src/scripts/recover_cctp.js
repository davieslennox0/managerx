#!/usr/bin/env node
/**
 * Recovery script for failed CCTP V1 Solana receiveMessage transactions.
 * Fetches message bytes from the failed tx instruction data, gets a fresh
 * attestation from Circle's Iris API, and retries with the fixed PDA.
 *
 * Usage: node recover_cctp.js [txSig1] [txSig2] ...
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');
const { ethers } = require('ethers');
const { receiveMessageOnSolana } = require('../lib/cctp_solana_mint');

const IRIS_API = 'https://iris-api.circle.com/v1/attestations';

// Failed tx signatures to recover
const FAILED_TXS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '8RWoCrrqw7FMpoyKGp3oWFi4YeMWVkbZSkdbScfhTAkK',
      '86cSVwAN62YxqV9jtLyfUb6XcUC6LZFMDE4vKBjBpWTc',
      'Byc42CV2rhEm26vVY5HjdR8MJVvTPFhgobcv1Qs999CL',
    ];

function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
}

// Parse message bytes from Anchor-encoded receiveMessage instruction data.
// Layout: [8-byte discriminator][u32 LE message_len][message_bytes][u32 LE attest_len][attest_bytes]
function parseMessageFromInstructionData(data) {
  const buf = Buffer.from(data, 'base64');
  const msgLen = buf.readUInt32LE(8);
  const msgBytes = buf.slice(12, 12 + msgLen);
  return '0x' + msgBytes.toString('hex');
}

async function fetchMessageHexFromFailedTx(connection, txSig) {
  const tx = await connection.getTransaction(txSig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) throw new Error(`Transaction not found: ${txSig}`);

  const MESSAGE_TRANSMITTER = 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd';

  const msg = tx.transaction.message;
  const accountKeys = msg.staticAccountKeys ?? msg.accountKeys;

  // Find the instruction targeting the message transmitter program
  for (const ix of msg.compiledInstructions ?? msg.instructions) {
    const programKey = accountKeys[ix.programIdIndex].toBase58();
    if (programKey === MESSAGE_TRANSMITTER) {
      const data = Buffer.isBuffer(ix.data) ? ix.data.toString('base64') : ix.data;
      return parseMessageFromInstructionData(data);
    }
  }
  throw new Error(`No message_transmitter instruction found in tx ${txSig}`);
}

async function pollAttestation(messageHash, maxRetries = 30, delayMs = 10000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axios.get(`${IRIS_API}/${messageHash}`);
      if (res.data?.status === 'complete' && res.data?.attestation) {
        return res.data.attestation;
      }
      console.log(`  Attestation pending (${i + 1}/${maxRetries})...`);
    } catch (e) {
      if (e.response?.status !== 404) throw e;
      console.log(`  Attestation not found yet (${i + 1}/${maxRetries})...`);
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error('Timed out waiting for attestation');
}

async function recoverTx(connection, txSig) {
  console.log(`\nRecovering: ${txSig}`);

  console.log('  Fetching message bytes from failed tx...');
  const messageHex = await fetchMessageHexFromFailedTx(connection, txSig);
  const messageHash = ethers.keccak256(messageHex);
  console.log(`  Message hash: ${messageHash}`);

  console.log('  Fetching attestation from Circle Iris...');
  const attestation = await pollAttestation(messageHash);
  console.log('  Attestation received.');

  console.log('  Submitting receiveMessage with fixed PDA...');
  const result = await receiveMessageOnSolana(messageHex, attestation);
  console.log(`  Success: ${result.txHash}`);
  return result;
}

async function main() {
  const connection = getConnection();
  const results = [];

  for (const txSig of FAILED_TXS) {
    try {
      const result = await recoverTx(connection, txSig);
      results.push({ txSig, ...result });
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      results.push({ txSig, error: e.message });
    }
  }

  console.log('\n=== Recovery summary ===');
  for (const r of results) {
    if (r.error) {
      console.log(`FAIL ${r.txSig}: ${r.error}`);
    } else {
      console.log(`OK   ${r.txSig} => ${r.txHash}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
