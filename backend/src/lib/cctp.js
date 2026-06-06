const axios = require('axios');
const { receiveMessageOnSolana } = require('./cctp_solana_mint');
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { Transaction } = require('@mysten/sui/transactions');

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

function getSuiClient() {
  return new SuiClient({ url: getFullnodeUrl('mainnet') });
}

function getAgentKeypair() {
  const key = process.env.SUI_AGENT_PRIVATE_KEY;
  if (!key) throw new Error('SUI_AGENT_PRIVATE_KEY not set');
  return Ed25519Keypair.fromSecretKey(key);
}

// Convert Solana address to bytes32 format for Sui
function solanaAddressToBytes32(solanaAddress) {
  const { PublicKey } = require('@solana/web3.js');
  // Use USDC token account, not wallet address
  const ata = process.env.AGENT_SOL_USDC_ATA || solanaAddress;
  const pubkey = new PublicKey(ata);
  const bytes = pubkey.toBytes();
  return Array.from(bytes); // Already 32 bytes for Solana pubkeys
}

// Poll Circle attestation API
async function pollAttestation(messageHash, maxWait = 120000) {
  const start = Date.now();
  console.log('Polling attestation for:', messageHash);

  while (Date.now() - start < maxWait) {
    try {
      const res = await axios.get(`${IRIS_API}/${messageHash}`);
      if (res.data?.status === 'complete') {
        console.log('Attestation complete');
        return res.data.attestation;
      }
      console.log('Attestation status:', res.data?.status || 'pending');
    } catch (e) {
      console.log('Polling...', e.response?.status || e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Attestation timed out');
}

// Bridge USDC from user's Sui wallet to Solana destination
async function bridgeUsdcSuiToSolana(userSuiAddress, amountUsdc, solanaDestination) {
  const client = getSuiClient();
  const keypair = getAgentKeypair();
  const amountMist = BigInt(Math.round(amountUsdc * 1e6));

  console.log(`Bridging ${amountUsdc} USDC: Sui → Solana(${solanaDestination})`);

  // Get user's USDC coins
  const coins = await client.getCoins({
    owner: userSuiAddress,
    coinType: USDC_SUI_TYPE,
  });

  if (!coins.data.length) throw new Error('No USDC found in Sui wallet');

  // Find coin with enough balance
  const coin = coins.data.find(c => BigInt(c.balance) >= amountMist);
  if (!coin) throw new Error(`Insufficient USDC. Have: ${coins.data.reduce((a, c) => a + BigInt(c.balance), 0n) / 1000000n} USDC`);

  // Convert Solana destination to bytes32
  const mintRecipientBytes = solanaAddressToBytes32(solanaDestination);

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
      tx.pure.vector('u8', mintRecipientBytes),
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

  // Extract message hash from events
  const messageEvent = result.events?.find(e => e.type.includes('MessageSent'));
  if (!messageEvent) throw new Error('No MessageSent event found');

  const messageHash = messageEvent.parsedJson?.message_hash
    || messageEvent.parsedJson?.hash;

  // Wait for Circle attestation
  const attestation = await pollAttestation(messageHash);

  // Mint USDC on Solana
  console.log('Step 3: Minting USDC on Solana...');
  const mintResult = await receiveMessageOnSolana(messageHash, attestation);
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

module.exports = {
  bridgeUsdcSuiToSolana,
  pollAttestation,
  SUI_CCTP,
  SOLANA_CCTP,
  USDC_SUI_TYPE,
};

// Mint USDC on Solana after attestation (complete the bridge)
async function mintUsdcOnSolana(message, attestation) {
  const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
  const anchor = require('@project-serum/anchor');
  const bs58 = require('bs58');

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );

  const privateKeyB58 = process.env.AGENT_SOL_PRIVATE_KEY;
  const secretKey = bs58.default.decode(privateKeyB58);
  const agentKeypair = Keypair.fromSecretKey(secretKey);

  // CCTP V1 Solana program IDs
  const MESSAGE_TRANSMITTER = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
  const TOKEN_MESSENGER = new PublicKey('CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3');

  // Convert message and attestation to buffers
  const messageBytes = Buffer.from(message.replace('0x', ''), 'hex');
  const attestationBytes = Buffer.from(attestation.replace('0x', ''), 'hex');

  console.log('Minting USDC on Solana...');

  // For now log the data - full Anchor integration needed
  console.log('Message length:', messageBytes.length);
  console.log('Attestation length:', attestationBytes.length);
  console.log('Agent:', agentKeypair.publicKey.toBase58());
  console.log('USDC ATA:', process.env.AGENT_SOL_USDC_ATA);

  // TODO: Full Anchor program call to receiveMessage
  return { status: 'mint_pending', message, attestation };
}

module.exports.mintUsdcOnSolana = mintUsdcOnSolana;
