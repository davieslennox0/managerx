const { PublicKey } = require('@solana/web3.js');

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
const expectedPDA = new PublicKey('79bQm84K3HGtS3t8g8AhEBLo9Swdhnh8tZ591u4cTrnC');

console.log('Deep analysis of seed structure');
console.log('Expected PDA:', expectedPDA.toBase58());
console.log('');

// Based on Circle's documentation and understanding of CCTP architecture:
// The used_nonces account is typically indexed by:
// 1. A "prefix" like "used_nonces"
// 2. The source domain (where the message came from)
// 3. A nonce or nonce bucket identifier

// Let's try with different interpretations of the message structure
// Message format for CCTP is typically:
// - version (1 byte)
// - sourceDomain (4 bytes)
// - destinationDomain (4 bytes)
// - nonce (8 bytes)
// - sender (32 bytes)
// - ...

// From the receiveMessageOnSolana function, I see:
// nonce = messageBytes.readBigUInt64BE(12);  // bytes 12-20
// sourceDomain = messageBytes.readUInt32BE(4); // bytes 4-8

// This means sourceDomain is read as u32 BE from the message

console.log('Testing if source_domain should be encoded as u32 BE in seeds:');
const nonceBufLE = Buffer.alloc(8);
nonceBufLE.writeBigUInt64LE(389901n);

const domainBE = Buffer.alloc(4);
domainBE.writeUInt32BE(8);

const pda1 = PublicKey.findProgramAddressSync(
  [Buffer.from('used_nonces'), domainBE, nonceBufLE],
  MESSAGE_TRANSMITTER_PROGRAM_ID
)[0];

console.log('used_nonces, domain(BE), nonce(LE):', pda1.toBase58());
console.log('Match:', pda1.toBase58() === expectedPDA.toBase58());
console.log('');

// Maybe it's not about buckets, but about a different message parsing?
// Let me try different combinations with different seed prefixes

console.log('Testing different seed prefixes:');
const prefixes = ['used_nonces', 'nonce_used', 'used_nonce', 'used-nonce', 'usedNonce'];

for (const prefix of prefixes) {
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from(prefix), domainBE, nonceBufLE],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  const match = pda.toBase58() === expectedPDA.toBase58() ? ' >>> MATCH <<<' : '';
  console.log(`${prefix}: ${pda.toBase58()}${match}`);
}

// Maybe domain is not included? Or nonce has a special format?
console.log('\nTesting without domain:');
const pdaNoDomain = PublicKey.findProgramAddressSync(
  [Buffer.from('used_nonces'), nonceBufLE],
  MESSAGE_TRANSMITTER_PROGRAM_ID
)[0];
console.log('just used_nonces + nonce:', pdaNoDomain.toBase58());
console.log('Match:', pdaNoDomain.toBase58() === expectedPDA.toBase58());

// Maybe the nonce is encoded differently? Let's try reading it as the message parsing does
console.log('\nTesting with nonce parsed as from message bytes:');
// If we're parsing from message bytes, maybe we need to understand the exact message structure

// Actually, let me re-read the code more carefully
// In receiveMessageOnSolana:
// const nonce = messageBytes.readBigUInt64BE(12);
// const sourceDomain = messageBytes.readUInt32BE(4);

// So in the seeds, maybe we should use them exactly as they appear in the message?
// Let's try that

const nonceBufBE = Buffer.alloc(8);
nonceBufBE.writeBigUInt64BE(389901n);

const pda2 = PublicKey.findProgramAddressSync(
  [Buffer.from('used_nonces'), domainBE, nonceBufBE],
  MESSAGE_TRANSMITTER_PROGRAM_ID
)[0];

console.log('Message-style encoding (both BE): ', pda2.toBase58());
console.log('Match:', pda2.toBase58() === expectedPDA.toBase58());
