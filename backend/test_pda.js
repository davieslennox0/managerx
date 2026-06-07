const { PublicKey } = require('@solana/web3.js');

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');

// From the error message
const nonce = 389901n;
const sourceDomain = 8;
const expectedAddress = '79bQm84K3HGtS3t8g8AhEBLo9Swdhnh8tZ591u4cTrnC';

console.log('Testing PDA derivations for nonce=389901, sourceDomain=8');
console.log('Expected address:', expectedAddress);
console.log('');

// Test bucket concept with different sizes
const bucketSizes = [100, 256, 1024, 2048, 4096, 6400, 8192, 10000];

for (const bucketSize of bucketSizes) {
  const bucketFirstNonce = (nonce / BigInt(bucketSize)) * BigInt(bucketSize);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(bucketFirstNonce);
  
  // Try with domain as string
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), Buffer.from(sourceDomain.toString()), nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  // Try with domain as LE bytes
  const domainBufLE = Buffer.alloc(4);
  domainBufLE.writeUInt32LE(sourceDomain);
  const pdaLE = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), domainBufLE, nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  // Try with domain as BE bytes
  const domainBufBE = Buffer.alloc(4);
  domainBufBE.writeUInt32BE(sourceDomain);
  const pdaBE = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), domainBufBE, nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  if (pda.toBase58() === expectedAddress) {
    console.log(`MATCH FOUND: Bucket size ${bucketSize}, first nonce ${bucketFirstNonce}, domain as string`);
    console.log('PDA:', pda.toBase58());
  }
  if (pdaLE.toBase58() === expectedAddress) {
    console.log(`MATCH FOUND: Bucket size ${bucketSize}, first nonce ${bucketFirstNonce}, domain as LE bytes`);
    console.log('PDA:', pdaLE.toBase58());
  }
  if (pdaBE.toBase58() === expectedAddress) {
    console.log(`MATCH FOUND: Bucket size ${bucketSize}, first nonce ${bucketFirstNonce}, domain as BE bytes`);
    console.log('PDA:', pdaBE.toBase58());
  }
}

console.log('');
console.log('Testing direct nonce with different encodings:');

// Try direct nonce with different encoding combinations
const nonceBufLE = Buffer.alloc(8);
nonceBufLE.writeBigUInt64LE(nonce);

const nonceBufBE = Buffer.alloc(8);
nonceBufBE.writeBigUInt64BE(nonce);

// Domain variations
const domainStr = Buffer.from(sourceDomain.toString());
const domainLE = Buffer.alloc(4);
domainLE.writeUInt32LE(sourceDomain);
const domainBE = Buffer.alloc(4);
domainBE.writeUInt32BE(sourceDomain);

const combinations = [
  ['nonce LE, domain string', nonceBufLE, domainStr],
  ['nonce BE, domain string', nonceBufBE, domainStr],
  ['nonce LE, domain LE', nonceBufLE, domainLE],
  ['nonce BE, domain LE', nonceBufBE, domainLE],
  ['nonce LE, domain BE', nonceBufLE, domainBE],
  ['nonce BE, domain BE', nonceBufBE, domainBE],
];

for (const [desc, nonceBuf, domainBuf] of combinations) {
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), domainBuf, nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  console.log(`${desc}: ${pda.toBase58()}`);
  if (pda.toBase58() === expectedAddress) {
    console.log('>>> MATCH FOUND <<<');
  }
}
