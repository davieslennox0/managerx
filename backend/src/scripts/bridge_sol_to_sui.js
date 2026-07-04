'use strict';

/**
 * Bridge USDC from Solana → Sui via CCTP V1
 *
 * Flow:
 *   1. depositForBurn on Solana TokenMessengerMinter
 *   2. Extract CCTP message from messageSentEventData account
 *   3. Poll Circle Iris API until attestation is complete
 *   4. Call receiveMessage PTB on Sui to mint USDC
 */

require('dotenv').config();

const { Connection, PublicKey, Keypair, SystemProgram } = require('@solana/web3.js');
const anchor = require('@project-serum/anchor');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const { ethers } = require('ethers');
const axios = require('axios');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');

// ── Solana CCTP V1 program IDs ────────────────────────────────────────────────
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
const TOKEN_MESSENGER_MINTER_PROGRAM_ID = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

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
const SUI_DOMAIN = 8;

// ── Config ───────────────────────────────────────────────────────────────────
const AMOUNT = 3_000_000n;  // 3 USDC (6 decimals)
const MINT_RECIPIENT_HEX = 'f8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e4';

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSolanaConnection() {
  return require('../lib/solana_connection').getConnection();
}

function getAgentSolKeypair() {
  const key = process.env.AGENT_SOL_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_SOL_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.default.decode(key));
}

function getAgentSuiKeypair() {
  const key = process.env.SUI_AGENT_PRIVATE_KEY;
  if (!key) throw new Error('SUI_AGENT_PRIVATE_KEY not set');
  return Ed25519Keypair.fromSecretKey(key);
}

// ── Solana PDA derivations ────────────────────────────────────────────────────
function findMessageTransmitterPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('message_transmitter')],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
}

function findTokenMessengerPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_messenger')],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findTokenMinterPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_minter')],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findLocalTokenPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('local_token'), USDC_MINT.toBuffer()],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findRemoteTokenMessengerPDA(domain) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('remote_token_messenger'), Buffer.from(domain.toString())],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

// senderAuthorityPda: seeds = ["sender_authority"], program = TOKEN_MESSENGER_MINTER
// UncheckedAccount — validates address only, account need not be initialized.
function findSenderAuthorityPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('sender_authority')],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findEventAuthorityPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

// ── Step 1: depositForBurn on Solana ─────────────────────────────────────────
async function depositForBurn() {
  const connection = getSolanaConnection();
  const agentKeypair = getAgentSolKeypair();

  const burnTokenAccount = new PublicKey(process.env.AGENT_SOL_USDC_ATA);
  const messageSentEventDataKeypair = Keypair.generate();

  // mintRecipient is bytes32 — Anchor IDL type is "publicKey" (32 bytes)
  const mintRecipient = new PublicKey(Buffer.from(MINT_RECIPIENT_HEX, 'hex'));

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(agentKeypair),
    { commitment: 'confirmed' }
  );

  const idl = await anchor.Program.fetchIdl(TOKEN_MESSENGER_MINTER_PROGRAM_ID, provider);
  if (!idl) throw new Error('Could not fetch TokenMessengerMinter IDL');

  const program = new anchor.Program(idl, TOKEN_MESSENGER_MINTER_PROGRAM_ID, provider);

  console.log('Calling depositForBurn...');
  console.log('  amount:            ', AMOUNT.toString(), 'μUSDC (3 USDC)');
  console.log('  destinationDomain: ', SUI_DOMAIN, '(Sui)');
  console.log('  mintRecipient:     ', '0x' + MINT_RECIPIENT_HEX);
  console.log('  burnTokenAccount:  ', burnTokenAccount.toBase58());
  console.log('  eventDataKeypair:  ', messageSentEventDataKeypair.publicKey.toBase58());

  const txSig = await program.methods
    .depositForBurn({
      amount: new anchor.BN(AMOUNT.toString()),
      destinationDomain: SUI_DOMAIN,
      mintRecipient,
    })
    .accounts({
      owner: agentKeypair.publicKey,
      eventRentPayer: agentKeypair.publicKey,
      senderAuthorityPda: findSenderAuthorityPDA(),
      burnTokenAccount,
      messageTransmitter: findMessageTransmitterPDA(),
      tokenMessenger: findTokenMessengerPDA(),
      remoteTokenMessenger: findRemoteTokenMessengerPDA(SUI_DOMAIN),
      tokenMinter: findTokenMinterPDA(),
      localToken: findLocalTokenPDA(),
      burnTokenMint: USDC_MINT,
      messageSentEventData: messageSentEventDataKeypair.publicKey,
      messageTransmitterProgram: MESSAGE_TRANSMITTER_PROGRAM_ID,
      tokenMessengerMinterProgram: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      eventAuthority: findEventAuthorityPDA(),
      program: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
    })
    .signers([agentKeypair, messageSentEventDataKeypair])
    .rpc();

  console.log('depositForBurn tx:', txSig);
  const { pollSignatureStatus } = require('../lib/solana');
  await pollSignatureStatus(connection, txSig, { label: 'depositForBurn' });

  // Read the CCTP message from the event data account.
  // Account layout (292 bytes): disc(8) + sender_key(32) + vec_len_LE_u32(4) + cctp_msg(248)
  // The CCTP message is always exactly 248 bytes and starts at offset 44.
  const accountInfo = await connection.getAccountInfo(messageSentEventDataKeypair.publicKey);
  if (!accountInfo) throw new Error('messageSentEventData account not found after tx');

  const data = accountInfo.data;
  const MSG_OFFSET = 44;
  const MSG_LENGTH = 248;

  if (data.length < MSG_OFFSET + MSG_LENGTH) {
    throw new Error(`messageSentEventData too short: ${data.length} bytes`);
  }

  // Verify the Vec<u8> length prefix at bytes 40-43 (LE u32) matches expected message size.
  const vecLen = data.readUInt32LE(40);
  if (vecLen !== MSG_LENGTH) {
    throw new Error(`Unexpected message length in account: ${vecLen}, expected ${MSG_LENGTH}`);
  }

  // Slice exactly the 248-byte CCTP message — do not include trailing account bytes.
  const messageBytes = data.slice(MSG_OFFSET, MSG_OFFSET + MSG_LENGTH);

  // Sanity-check CCTP header fields.
  if (messageBytes.readUInt32BE(0) !== 0) {
    throw new Error('CCTP message version is not 0 — wrong offset or corrupt account');
  }
  console.log(`CCTP message extracted at offset ${MSG_OFFSET}, length ${messageBytes.length}`);

  const messageHex = '0x' + messageBytes.toString('hex');
  const messageHash = ethers.keccak256(messageHex);

  console.log('Message hash:', messageHash);
  return { txSig, messageHex, messageHash };
}

// ── Step 2: Poll Circle Iris API ──────────────────────────────────────────────
async function pollAttestation(messageHash, timeoutMs = 300_000) {
  const url = `https://iris-api.circle.com/v1/attestations/${messageHash}`;
  const deadline = Date.now() + timeoutMs;
  console.log('Polling attestation for:', messageHash);

  while (Date.now() < deadline) {
    try {
      const res = await axios.get(url);
      if (res.data?.status === 'complete') {
        console.log('Attestation complete.');
        return res.data.attestation;
      }
      console.log('  status:', res.data?.status || 'pending');
    } catch (e) {
      const status = e.response?.status;
      if (status !== 404) console.log('  poll error:', status || e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Attestation timed out after ' + timeoutMs / 1000 + 's');
}

// ── Step 3: receiveMessage on Sui ─────────────────────────────────────────────
// PTB structure (confirmed from on-chain txs):
//   [0] MT::receive_message(msg, att, mt_state)                        → Receipt
//   [1] TMM::handle_receive_message<USDC>(receipt, tmm_state, deny, t) → StampReceiptTicketWithBurnMessage
//   [2] TMM::deconstruct_stamp_receipt_ticket_with_burn_message(ticket) → (StampReceiptTicket, BurnMessage)
//   [3] MT::stamp_receipt<MessageTransmitterAuthenticator>(ticket, mt_state) → StampedReceipt
//   [4] MT::complete_receive_message(stamped_receipt, mt_state)        → ()
async function receiveMessageOnSui(messageHex, attestationHex) {
  const client = new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
  const keypair = getAgentSuiKeypair();

  const messageBytes  = Array.from(Buffer.from(messageHex.replace('0x', ''), 'hex'));
  const attestBytes   = Array.from(Buffer.from(attestationHex.replace('0x', ''), 'hex'));

  const tx = new Transaction();

  // [0] Verify attestation, mark nonce used → Receipt
  const [receipt] = tx.moveCall({
    target: `${SUI_CCTP.MT_PKG}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector('u8', messageBytes),
      tx.pure.vector('u8', attestBytes),
      tx.object(SUI_CCTP.MT_STATE),
    ],
  });

  // [1] Mint USDC to recipient → StampReceiptTicketWithBurnMessage
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

  // [2] Deconstruct → (StampReceiptTicket<Auth>, BurnMessage); BurnMessage has `drop`
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

  // [4] Finalize — destroys the StampedReceipt
  tx.moveCall({
    target: `${SUI_CCTP.MT_PKG}::receive_message::complete_receive_message`,
    arguments: [
      stampedReceipt,
      tx.object(SUI_CCTP.MT_STATE),
    ],
  });

  console.log('Submitting Sui receiveMessage...');
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status !== 'success') {
    throw new Error('Sui receiveMessage failed: ' + JSON.stringify(result.effects?.status));
  }

  console.log('USDC minted on Sui:', result.digest);
  return result.digest;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Bridge 3 USDC: Solana → Sui via CCTP V1 ===\n');

  // Step 1: Burn on Solana
  const { txSig, messageHex, messageHash } = await depositForBurn();
  console.log('\nSolana burn tx:', txSig);

  // Step 2: Attest
  console.log('\nWaiting for Circle attestation...');
  const attestation = await pollAttestation(messageHash);

  // Step 3: Mint on Sui
  console.log('\nMinting on Sui...');
  const suiDigest = await receiveMessageOnSui(messageHex, attestation);

  console.log('\n=== Bridge complete ===');
  console.log('Solana burn:   ', txSig);
  console.log('Sui mint:      ', suiDigest);
  console.log('USDC recipient:', '0x' + MINT_RECIPIENT_HEX);
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  if (e.logs) console.error('Logs:\n', e.logs.join('\n'));
  process.exit(1);
});
