const { PublicKey } = require('@solana/web3.js');

// Let's work backwards - try to understand what seeds would create the expected PDA
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');
const expectedPDA = new PublicKey('79bQm84K3HGtS3t8g8AhEBLo9Swdhnh8tZ591u4cTrnC');

console.log('Analyzing expected PDA:', expectedPDA.toBase58());
console.log('Program ID:', MESSAGE_TRANSMITTER_PROGRAM_ID.toBase58());
console.log('');

// Let's try to think about bucket-based nonce indexing
// If NONCES_PER_ACCOUNT = 6400, then:
// - Nonce 389901 would be in bucket: floor(389901 / 6400) = 60
// - Bucket start nonce: 60 * 6400 = 384000
// - Bucket end nonce: 61 * 6400 = 387600
// - But 389901 > 387600, so let's recalculate

console.log('Checking bucket calculations for nonce 389901:');
const NONCES_PER_ACCOUNT = 6400;
const nonce = 389901n;
const bucketIndex = nonce / BigInt(NONCES_PER_ACCOUNT);
const bucketStart = bucketIndex * BigInt(NONCES_PER_ACCOUNT);
const bucketEnd = (bucketIndex + 1n) * BigInt(NONCES_PER_ACCOUNT);

console.log(`Bucket index: ${bucketIndex}`);
console.log(`Bucket start: ${bucketStart}`);
console.log(`Bucket end: ${bucketEnd}`);
console.log(`Nonce in bucket: ${nonce >= bucketStart && nonce < bucketEnd}`);
console.log('');

// Maybe there's an alternative bucket size? Try different values
console.log('Trying different bucket sizes to find pattern:');
for (let bucketSize = 1000; bucketSize <= 10000; bucketSize += 100) {
  const bIdx = nonce / BigInt(bucketSize);
  const bStart = bIdx * BigInt(bucketSize);
  const bEnd = (bIdx + 1n) * BigInt(bucketSize);
  
  // Try with this bucket start nonce
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(bStart);
  
  const domainLEB = Buffer.alloc(4);
  domainLEB.writeUInt32LE(8);
  
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), domainLEB, nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  if (pda.toBase58() === expectedPDA.toBase58()) {
    console.log(`MATCH: Bucket size ${bucketSize}, bucket start ${bStart}`);
  }
}

// Try with specific numbers
console.log('\nTrying specific bucket boundary calculations:');
const testBuckets = [
  { name: 'Nonce directly', nonce: 389901n },
  { name: 'Nonce - 1', nonce: 389900n },
  { name: 'Nonce // 100 * 100', nonce: (389901n / 100n) * 100n },
  { name: 'Nonce // 1000 * 1000', nonce: (389901n / 1000n) * 1000n },
  { name: 'Nonce // 256 * 256', nonce: (389901n / 256n) * 256n },
];

for (const { name, nonce: testNonce } of testBuckets) {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(testNonce);
  
  const domainLEB = Buffer.alloc(4);
  domainLEB.writeUInt32LE(8);
  
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from('used_nonces'), domainLEB, nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  const match = pda.toBase58() === expectedPDA.toBase58() ? ' >>> MATCH <<<' : '';
  console.log(`${name} (${testNonce}): ${pda.toBase58()}${match}`);
}
