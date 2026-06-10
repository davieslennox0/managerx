const axios = require('axios');
const { ethers } = require('ethers');
const { receiveMessageOnSolana } = require('./cctp_solana_mint');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');
const { pollSignatureStatus, ensureUserUsdcAta, getUserUsdcAta } = require('./solana');

// Sui CCTP V1 Mainnet addresses
const SUI_CCTP = {
  tokenMessengerMinter: '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e',
  messageTransmitter:   '0x08d87d37ba49e785dde270a83f8e979605b03dc552b5548f26fdf2f49bf7ed1b',
  // Shared objects
  tokenMessengerMinterState: '0x45993eecc0382f37419864992c12faee2238f5cfe22b98ad3bf455baf65c8a2f',
  messageTransmitterState:   '0xf68268c3d9b1df3215f2439400c1c4ea08ac4ef4bb7d6f3ca6a2a239e17510af',
  usdcTreasury: '0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7',
  denyList: '0x0000000000000000000000000000000000000000000000000000000000000403',
  domain: 8,
};

// Solana CCTP V1 Mainnet
const SOLANA_CCTP = {
  messageTransmitter: 'CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd',
  tokenMessenger:     'CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3',
  domain: 5,
};

const USDC_SUI_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const IRIS_API = 'https://iris-api.circle.com/v1/attestations';

// Cache the TokenMessengerMinter IDL to avoid repeated on-chain RPC fetches
let _tokenMessengerMinterIdl = null;

function getSuiClient() {
  return new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
}

function getAgentKeypair() {
  const key = process.env.SUI_AGENT_PRIVATE_KEY;
  if (!key) throw new Error('SUI_AGENT_PRIVATE_KEY not set');
  return Ed25519Keypair.fromSecretKey(key);
}

// Convert a Solana base58 address to a 32-byte array for use as CCTP mintRecipient.
// Pass the destination token account (ATA), not the wallet address.
function solanaAddressToBytes32(solanaAddress) {
  const { PublicKey } = require('@solana/web3.js');
  return Array.from(new PublicKey(solanaAddress).toBytes());
}

// Poll Circle attestation API
async function pollAttestation(messageHash, maxWait = 300_000) {
  const start = Date.now();
  console.log('Polling attestation for:', messageHash);

  while (Date.now() - start < maxWait) {
    try {
      const res = await axios.get(`${IRIS_API}/${messageHash}`, { timeout: 10_000 });
      if (res.data?.status === 'complete' && res.data?.attestation) {
        console.log('Attestation complete');
        return res.data.attestation;
      }
      console.log('Attestation status:', res.data?.status || 'pending');
    } catch (e) {
      if (e.response?.status !== 404) console.log('Polling error:', e.response?.status || e.message);
    }
    await new Promise(r => setTimeout(r, 8_000));
  }
  throw new Error('Attestation timed out after ' + maxWait / 1000 + 's');
}

// Bridge USDC from agent's Sui wallet to user's Solana wallet.
// Agent signs (only agent can spend its own Sui USDC).
// solanaWalletAddress is the user's Solana wallet address (not ATA — derived internally).
async function bridgeUsdcSuiToSolana(amountUsdc, solanaWalletAddress) {
  const client = getSuiClient();
  const keypair = getAgentKeypair();
  const amountMist = BigInt(Math.round(amountUsdc * 1e6));
  const agentSuiAddress = keypair.getPublicKey().toSuiAddress();

  // Derive destination ATA from wallet address (sync, no network call needed)
  const userUsdcAta = getUserUsdcAta(solanaWalletAddress);
  const solanaDestination = userUsdcAta.toBase58();

  console.log(`Bridging ${amountUsdc} USDC: Sui(agent) → Solana(${solanaWalletAddress}) ATA(${solanaDestination})`);

  // Get agent's USDC coins on Sui
  const coins = await client.getCoins({
    owner: agentSuiAddress,
    coinType: USDC_SUI_TYPE,
  });

  if (!coins.data.length) throw new Error('No USDC found in agent Sui wallet');

  // Find coin with enough balance
  const coin = coins.data.find(c => BigInt(c.balance) >= amountMist);
  if (!coin) throw new Error(`Insufficient USDC in agent Sui wallet. Have: ${coins.data.reduce((a, c) => a + BigInt(c.balance), 0n) / 1000000n} USDC`);

  // Convert Solana destination ATA to 0x-prefixed hex for tx.pure.address
  const { PublicKey } = require('@solana/web3.js');
  const mintRecipientHex = '0x' + Buffer.from(new PublicKey(solanaDestination).toBytes()).toString('hex');

  const tx = new Transaction();

  // Split exact amount if needed
  let coinToUse;
  if (BigInt(coin.balance) === amountMist) {
    coinToUse = tx.object(coin.coinObjectId);
  } else {
    const [splitCoin] = tx.splitCoins(tx.object(coin.coinObjectId), [amountMist]);
    coinToUse = splitCoin;
  }

  // Call deposit_for_burn on Sui CCTP
  tx.moveCall({
    target: `${SUI_CCTP.tokenMessengerMinter}::deposit_for_burn::deposit_for_burn`,
    typeArguments: [USDC_SUI_TYPE],
    arguments: [
      coinToUse,
      tx.pure.u32(SOLANA_CCTP.domain),
      tx.pure.address(mintRecipientHex),
      tx.object(SUI_CCTP.tokenMessengerMinterState),
      tx.object(SUI_CCTP.messageTransmitterState),
      tx.object(SUI_CCTP.denyList),
      tx.object(SUI_CCTP.usdcTreasury),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showEvents: true },
  });

  console.log('Burn tx:', result.digest);

  // The Sui MessageSent event carries the raw 248-byte CCTP message as a u8 array.
  // There is no message_hash field — compute keccak256 ourselves for Iris polling.
  const messageEvent = result.events?.find(e => e.type.includes('MessageSent'));
  if (!messageEvent) throw new Error('No MessageSent event found in Sui burn tx');

  const rawBytes = messageEvent.parsedJson?.message;
  if (!Array.isArray(rawBytes) || rawBytes.length === 0) {
    throw new Error('MessageSent event missing message bytes');
  }
  const messageHex  = '0x' + Buffer.from(rawBytes).toString('hex');
  const messageHash = ethers.keccak256(messageHex);

  // Wait for Circle attestation
  const attestation = await pollAttestation(messageHash);

  // Ensure the destination USDC ATA is initialized before minting.
  await ensureUserUsdcAta(solanaWalletAddress);
  console.log('Step 3: Minting USDC on Solana...');
  const mintResult = await receiveMessageOnSolana(messageHex, attestation, solanaDestination);
  console.log('USDC minted:', mintResult.txHash);

  return {
    sourceTxHash: result.digest,
    mintTxHash: mintResult.txHash,
    messageHash,
    amount: amountUsdc,
    destination: solanaDestination,
    status: 'complete',
  };
}

// ─── Solana → Sui direction ───────────────────────────────────────────────────

// Burn USDC on Solana CCTP, routing it to userSuiAddress on Sui.
// rawUsdcAmount is in micro-USDC (6 decimals), e.g. 5 USDC = 5_000_000.
async function depositForBurnOnSolana(rawUsdcAmount, userSuiAddress) {
  const { PublicKey, Keypair, SystemProgram } = require('@solana/web3.js');
  const anchor = require('@project-serum/anchor');
  const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
  const bs58 = require('bs58');
  const { withFallback } = require('./solana_connection');

  const MT  = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
  const TMM = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3');
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const SUI_DOMAIN_ID = 8;

  const agentKeypair = Keypair.fromSecretKey(bs58.default.decode(process.env.AGENT_SOL_PRIVATE_KEY));
  const burnTokenAccount = new PublicKey(process.env.AGENT_SOL_USDC_ATA);
  const suiAddrHex = userSuiAddress.replace('0x', '').padStart(64, '0');
  const mintRecipient = new PublicKey(Buffer.from(suiAddrHex, 'hex'));

  return withFallback(async (connection) => {
    const messageSentEventDataKeypair = Keypair.generate();

    // Pre-flight SOL check: CCTP depositForBurn creates a new on-chain account that
    // requires ~0.003 SOL in rent. Auto-topup from USDC via Jupiter if underfunded.
    const agentSolBalance = await connection.getBalance(agentKeypair.publicKey);
    const MIN_SOL_FOR_CCTP = 4_000_000;
    const effectiveUsdcAmount = rawUsdcAmount;
    if (agentSolBalance < MIN_SOL_FOR_CCTP) {
      console.log(`Agent SOL low (${(agentSolBalance/1e9).toFixed(6)}), swapping USDC → SOL for gas...`);
      try {
        const USDC_MINT_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const WSOL_MINT_ADDR = 'So11111111111111111111111111111111111111112';
        const TOPUP_USDC = 1_500_000; // 1.50 USDC
        const usdcAvail = parseInt((await connection.getTokenAccountBalance(burnTokenAccount)).value.amount, 10);
        const swapInputUsdc = Math.min(TOPUP_USDC, Math.floor(usdcAvail * 0.5));
        if (swapInputUsdc < 100_000) throw new Error(`insufficient USDC for SOL topup (${(usdcAvail/1e6).toFixed(6)} USDC available)`);
        const quoteRes = await axios.get('https://api.jup.ag/swap/v1/quote', {
          params: { inputMint: USDC_MINT_ADDR, outputMint: WSOL_MINT_ADDR, amount: swapInputUsdc, swapMode: 'ExactIn', slippageBps: 100 },
          timeout: 10_000,
        });
        const swapRes = await axios.post('https://api.jup.ag/swap/v1/swap', {
          quoteResponse: quoteRes.data,
          userPublicKey: agentKeypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 100_000,
        }, { timeout: 15_000 });
        const { VersionedTransaction } = require('@solana/web3.js');
        const swapTx = VersionedTransaction.deserialize(Buffer.from(swapRes.data.swapTransaction, 'base64'));
        swapTx.sign([agentKeypair]);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        const swapSerialized = swapTx.serialize();
        const sig = await connection.sendRawTransaction(swapSerialized, { skipPreflight: true, maxRetries: 0 });
        console.log('CCTP SOL topup submitted:', sig);
        await pollSignatureStatus(connection, sig, {
          label: 'CCTP SOL topup',
          blockhash,
          lastValidBlockHeight,
          resendFn: () => connection.sendRawTransaction(swapSerialized, { skipPreflight: true, maxRetries: 0 }),
        });
        console.log(`SOL topup complete: ${sig}`);
      } catch (e) {
        throw new Error(
          `Agent wallet has insufficient SOL for CCTP bridge (${(agentSolBalance/1e9).toFixed(6)} SOL) ` +
          `and auto-topup from USDC failed: ${e.message}`
        );
      }
    }

    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(agentKeypair),
      { commitment: 'confirmed' }
    );

    if (!_tokenMessengerMinterIdl) {
      console.log('Fetching TokenMessengerMinter IDL from on-chain (one-time)...');
      _tokenMessengerMinterIdl = await anchor.Program.fetchIdl(TMM, provider);
    }
    const idl = _tokenMessengerMinterIdl;
    if (!idl) throw new Error('Could not fetch TokenMessengerMinter IDL from on-chain');
    const program = new anchor.Program(idl, TMM, provider);

    const pda = (seeds, prog) => PublicKey.findProgramAddressSync(seeds, prog)[0];
    const messageTransmitterPDA   = pda([Buffer.from('message_transmitter')], MT);
    const tokenMessengerPDA       = pda([Buffer.from('token_messenger')], TMM);
    const tokenMinterPDA          = pda([Buffer.from('token_minter')], TMM);
    const localTokenPDA           = pda([Buffer.from('local_token'), USDC_MINT.toBuffer()], TMM);
    const remoteTokenMessengerPDA = pda([Buffer.from('remote_token_messenger'), Buffer.from(SUI_DOMAIN_ID.toString())], TMM);
    const senderAuthorityPDA      = pda([Buffer.from('sender_authority')], TMM);
    const eventAuthorityPDA       = pda([Buffer.from('__event_authority')], TMM);

    console.log('depositForBurn:', effectiveUsdcAmount, 'μUSDC → Sui', userSuiAddress);

    const txSig = await program.methods
      .depositForBurn({
        amount: new anchor.BN(effectiveUsdcAmount.toString()),
        destinationDomain: SUI_DOMAIN_ID,
        mintRecipient,
      })
      .accounts({
        owner: agentKeypair.publicKey,
        eventRentPayer: agentKeypair.publicKey,
        senderAuthorityPda: senderAuthorityPDA,
        burnTokenAccount,
        messageTransmitter: messageTransmitterPDA,
        tokenMessenger: tokenMessengerPDA,
        remoteTokenMessenger: remoteTokenMessengerPDA,
        tokenMinter: tokenMinterPDA,
        localToken: localTokenPDA,
        burnTokenMint: USDC_MINT,
        messageSentEventData: messageSentEventDataKeypair.publicKey,
        messageTransmitterProgram: MT,
        tokenMessengerMinterProgram: TMM,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: eventAuthorityPDA,
        program: TMM,
      })
      .signers([agentKeypair, messageSentEventDataKeypair])
      .rpc();

    console.log('depositForBurn tx:', txSig);
    await pollSignatureStatus(connection, txSig, { label: 'CCTP depositForBurn' });

    // Read CCTP message from event data account: disc(8)+sender(32)+vec_len(4)+msg(248) → offset 44
    const accountInfo = await connection.getAccountInfo(messageSentEventDataKeypair.publicKey);
    if (!accountInfo) throw new Error('messageSentEventData account not found after burn');

    const MSG_OFFSET = 44, MSG_LENGTH = 248;
    const messageBytes = accountInfo.data.slice(MSG_OFFSET, MSG_OFFSET + MSG_LENGTH);
    const messageHex   = '0x' + messageBytes.toString('hex');
    const messageHash  = ethers.keccak256(messageHex);

    console.log('CCTP message hash:', messageHash);
    return { txSig, messageHex, messageHash };
  });
}

// Mint USDC on Sui from a validated CCTP message+attestation.
// The mintRecipient encoded in the message receives the USDC.
async function receiveMessageOnSui(messageHex, attestationHex) {
  const client   = getSuiClient();
  const keypair  = getAgentKeypair();
  const msgBytes = Array.from(Buffer.from(messageHex.replace('0x', ''), 'hex'));
  const attBytes = Array.from(Buffer.from(attestationHex.replace('0x', ''), 'hex'));

  const tx = new Transaction();

  const [receipt] = tx.moveCall({
    target: `${SUI_CCTP.messageTransmitter}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector('u8', msgBytes),
      tx.pure.vector('u8', attBytes),
      tx.object(SUI_CCTP.messageTransmitterState),
    ],
  });

  const [stampTicketWithBurnMsg] = tx.moveCall({
    target: `${SUI_CCTP.tokenMessengerMinter}::handle_receive_message::handle_receive_message`,
    typeArguments: [USDC_SUI_TYPE],
    arguments: [
      receipt,
      tx.object(SUI_CCTP.tokenMessengerMinterState),
      tx.object(SUI_CCTP.denyList),
      tx.object(SUI_CCTP.usdcTreasury),
    ],
  });

  const [stampReceiptTicket] = tx.moveCall({
    target: `${SUI_CCTP.tokenMessengerMinter}::handle_receive_message::deconstruct_stamp_receipt_ticket_with_burn_message`,
    arguments: [stampTicketWithBurnMsg],
  });

  const [stampedReceipt] = tx.moveCall({
    target: `${SUI_CCTP.messageTransmitter}::receive_message::stamp_receipt`,
    typeArguments: [`${SUI_CCTP.tokenMessengerMinter}::message_transmitter_authenticator::MessageTransmitterAuthenticator`],
    arguments: [stampReceiptTicket, tx.object(SUI_CCTP.messageTransmitterState)],
  });

  tx.moveCall({
    target: `${SUI_CCTP.messageTransmitter}::receive_message::complete_receive_message`,
    arguments: [stampedReceipt, tx.object(SUI_CCTP.messageTransmitterState)],
  });

  console.log('Submitting receiveMessage on Sui...');
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

// Full Solana → Sui bridge: burn USDC on Solana, attest, mint on Sui.
async function bridgeUsdcSolanaToSui(rawUsdcAmount, userSuiAddress) {
  console.log(`Bridging ${rawUsdcAmount} μUSDC: Solana → Sui(${userSuiAddress})`);

  const { txSig, messageHex, messageHash } = await depositForBurnOnSolana(rawUsdcAmount, userSuiAddress);
  console.log('Solana burn tx:', txSig);

  console.log('Polling Circle attestation...');
  const attestation = await pollAttestation(messageHash);

  console.log('Minting USDC on Sui...');
  const suiDigest = await receiveMessageOnSui(messageHex, attestation);

  return { burnTxHash: txSig, suiMintTxHash: suiDigest, messageHash };
}

module.exports = {
  bridgeUsdcSuiToSolana,
  bridgeUsdcSolanaToSui,
  pollAttestation,
  SUI_CCTP,
  SOLANA_CCTP,
  USDC_SUI_TYPE,
};

