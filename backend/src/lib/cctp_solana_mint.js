const { Connection, PublicKey, Keypair, SystemProgram } = require('@solana/web3.js');
const anchor = require('@project-serum/anchor');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');
const axios = require('axios');

// Solana CCTP V1 Program IDs
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
const TOKEN_MESSENGER_MINTER_PROGRAM_ID = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3');
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Cache IDLs to avoid repeated on-chain RPC fetches (slow and sometimes timeout)
let _messageTransmitterIdl = null;
let _tokenMessengerMinterIdl = null;

function getConnection() {
  return new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
}

function getAgentKeypair() {
  const key = process.env.AGENT_SOL_PRIVATE_KEY;
  if (!key) throw new Error('AGENT_SOL_PRIVATE_KEY not set');
  const secretKey = bs58.default.decode(key);
  return Keypair.fromSecretKey(secretKey);
}

// Find PDAs for CCTP
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

function findLocalTokenPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('local_token'), mint.toBuffer()],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findRemoteTokenMessengerPDA(domain) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('remote_token_messenger'), Buffer.from(domain.toString())],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findTokenPairPDA(remoteDomain, remoteToken) {
  const remoteTokenBuf = Buffer.from(remoteToken.replace('0x', ''), 'hex');
  return PublicKey.findProgramAddressSync(
    [Buffer.from('token_pair'), Buffer.from(remoteDomain.toString()), remoteTokenBuf],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

function findUsedNoncePDA(nonce, sourceDomain) {
  // Circle CCTP V1 Solana: seeds are ASCII strings, nonces grouped in buckets of 6400.
  // first_nonce = ((nonce - 1) / MAX_NONCES) * MAX_NONCES + 1  (1-indexed buckets)
  const MAX_NONCES = 6400n;
  const n = BigInt(nonce);
  const firstNonce = ((n - 1n) / MAX_NONCES) * MAX_NONCES + 1n;
  return PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), Buffer.from(sourceDomain.toString()), Buffer.from(firstNonce.toString())],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
}

function findCustodyTokenAccountPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('custody'), mint.toBuffer()],
    TOKEN_MESSENGER_MINTER_PROGRAM_ID
  )[0];
}

// authority_pda owned by MessageTransmitter, seeds = ["message_transmitter_authority", receiver]
function findAuthorityPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('message_transmitter_authority'), TOKEN_MESSENGER_MINTER_PROGRAM_ID.toBuffer()],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
}

// Receive USDC on Solana (mint side of bridge)
async function receiveMessageOnSolana(messageHex, attestationHex) {
  const connection = getConnection();
  const agentKeypair = getAgentKeypair();

  const messageBytes = Buffer.from(messageHex.replace('0x', ''), 'hex');
  const attestationBytes = Buffer.from(attestationHex.replace('0x', ''), 'hex');

  // Parse nonce from message (bytes 12-20)
  const nonce = messageBytes.readBigUInt64BE(12);
  const sourceDomain = messageBytes.readUInt32BE(4);

  console.log('Receiving message on Solana...');
  console.log('Nonce:', nonce.toString());
  console.log('Source domain:', sourceDomain);

  // Generate event account keypair
  const eventAccountKeypair = Keypair.generate();

  // PDAs
  const messageTransmitterPDA = findMessageTransmitterPDA();
  const authorityPDA = findAuthorityPda();
  const tokenMessengerPDA = findTokenMessengerPDA();
  const remoteTokenMessengerPDA = findRemoteTokenMessengerPDA(sourceDomain);
  const tokenMinterPDA = findTokenMinterPDA();
  const localTokenPDA = findLocalTokenPDA(USDC_MINT);
  const custodyTokenPDA = findCustodyTokenAccountPDA(USDC_MINT);
  const usedNoncePDA = findUsedNoncePDA(nonce, sourceDomain);

  // Extract burn_token from message body (CCTP header=116 bytes, body version=4 bytes, then 32-byte burn_token)
  const burnToken = messageBytes.slice(120, 152).toString('hex');
  const tokenPairPDA = findTokenPairPDA(sourceDomain, burnToken);

  // Recipient token account
  const recipientTokenAccount = new PublicKey(process.env.AGENT_SOL_USDC_ATA);

  // Load IDL from on-chain
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(agentKeypair),
    { commitment: 'confirmed' }
  );

  try {
    // Fetch IDL from on-chain (cached after first call to avoid repeated slow RPC fetches)
    if (!_messageTransmitterIdl) {
      console.log('Fetching MessageTransmitter IDL from on-chain (one-time)...');
      _messageTransmitterIdl = await anchor.Program.fetchIdl(MESSAGE_TRANSMITTER_PROGRAM_ID, provider);
    }
    if (!_tokenMessengerMinterIdl) {
      console.log('Fetching TokenMessengerMinter IDL from on-chain (one-time)...');
      _tokenMessengerMinterIdl = await anchor.Program.fetchIdl(TOKEN_MESSENGER_MINTER_PROGRAM_ID, provider);
    }

    const messageTransmitterIdl = _messageTransmitterIdl;
    const tokenMessengerIdl = _tokenMessengerMinterIdl;

    if (!messageTransmitterIdl || !tokenMessengerIdl) {
      throw new Error('Could not fetch IDL from on-chain');
    }

    const messageTransmitterProgram = new anchor.Program(
      messageTransmitterIdl,
      MESSAGE_TRANSMITTER_PROGRAM_ID,
      provider
    );

    const tokenMessengerProgram = new anchor.Program(
      tokenMessengerIdl,
      TOKEN_MESSENGER_MINTER_PROGRAM_ID,
      provider
    );

    // Call receiveMessage
    const tx = await messageTransmitterProgram.methods
      .receiveMessage({
        message: messageBytes,
        attestation: attestationBytes,
      })
      .accounts({
        payer: agentKeypair.publicKey,
        caller: agentKeypair.publicKey,
        authorityPda: authorityPDA,
        messageTransmitter: messageTransmitterPDA,
        usedNonces: usedNoncePDA,
        receiver: TOKEN_MESSENGER_MINTER_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: PublicKey.findProgramAddressSync(
          [Buffer.from('__event_authority')],
          MESSAGE_TRANSMITTER_PROGRAM_ID
        )[0],
        program: MESSAGE_TRANSMITTER_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: tokenMessengerPDA, isWritable: false, isSigner: false },
        { pubkey: remoteTokenMessengerPDA, isWritable: false, isSigner: false },
        { pubkey: tokenMinterPDA, isWritable: true, isSigner: false },
        { pubkey: localTokenPDA, isWritable: true, isSigner: false },
        { pubkey: tokenPairPDA, isWritable: false, isSigner: false },
        { pubkey: recipientTokenAccount, isWritable: true, isSigner: false },
        { pubkey: custodyTokenPDA, isWritable: true, isSigner: false },
        { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
        {
          pubkey: PublicKey.findProgramAddressSync(
            [Buffer.from('__event_authority')],
            TOKEN_MESSENGER_MINTER_PROGRAM_ID
          )[0],
          isWritable: false,
          isSigner: false,
        },
        { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM_ID, isWritable: false, isSigner: false },
      ])
      .signers([agentKeypair])
      .rpc();

    console.log('USDC minted on Solana:', tx);
    return { txHash: tx, status: 'minted' };

  } catch (e) {
    console.error('Solana mint error:', e.message);
    throw e;
  }
}

module.exports = { receiveMessageOnSolana };
