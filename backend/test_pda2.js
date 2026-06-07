const { PublicKey } = require('@solana/web3.js');

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey('CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd');

const nonce = 389901n;
const sourceDomain = 8;
const expectedAddress = '79bQm84K3HGtS3t8g8AhEBLo9Swdhnh8tZ591u4cTrnC';

console.log('Testing different seed orderings and formats');
console.log('Expected:', expectedAddress);
console.log('');

// Different seed preparations
const nonceLEB = Buffer.alloc(8);
nonceLEB.writeBigUInt64LE(nonce);

const nonceBEB = Buffer.alloc(8);
nonceBEB.writeBigUInt64BE(nonce);

const domainStr = Buffer.from(sourceDomain.toString());
const domainLEB = Buffer.alloc(4);
domainLEB.writeUInt32LE(sourceDomain);
const domainBEB = Buffer.alloc(4);
domainBEB.writeUInt32BE(sourceDomain);

// Different seed orderings
const seeds = [
  // Original order: used_nonces, domain, nonce
  { name: 'used_nonces, domain_str, nonce_LE', seeds: [Buffer.from('used_nonces'), domainStr, nonceLEB] },
  { name: 'used_nonces, domain_LE, nonce_LE', seeds: [Buffer.from('used_nonces'), domainLEB, nonceLEB] },
  { name: 'used_nonces, domain_BE, nonce_LE', seeds: [Buffer.from('used_nonces'), domainBEB, nonceLEB] },
  { name: 'used_nonces, domain_str, nonce_BE', seeds: [Buffer.from('used_nonces'), domainStr, nonceBEB] },
  { name: 'used_nonces, domain_LE, nonce_BE', seeds: [Buffer.from('used_nonces'), domainLEB, nonceBEB] },
  { name: 'used_nonces, domain_BE, nonce_BE', seeds: [Buffer.from('used_nonces'), domainBEB, nonceBEB] },
  
  // Reversed order: used_nonces, nonce, domain
  { name: 'used_nonces, nonce_LE, domain_str', seeds: [Buffer.from('used_nonces'), nonceLEB, domainStr] },
  { name: 'used_nonces, nonce_LE, domain_LE', seeds: [Buffer.from('used_nonces'), nonceLEB, domainLEB] },
  { name: 'used_nonces, nonce_LE, domain_BE', seeds: [Buffer.from('used_nonces'), nonceLEB, domainBEB] },
  { name: 'used_nonces, nonce_BE, domain_str', seeds: [Buffer.from('used_nonces'), nonceBEB, domainStr] },
  { name: 'used_nonces, nonce_BE, domain_LE', seeds: [Buffer.from('used_nonces'), nonceBEB, domainLEB] },
  { name: 'used_nonces, nonce_BE, domain_BE', seeds: [Buffer.from('used_nonces'), nonceBEB, domainBEB] },
];

for (const { name, seeds: seedArray } of seeds) {
  const pda = PublicKey.findProgramAddressSync(
    seedArray,
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  const match = pda.toBase58() === expectedAddress ? ' >>> MATCH <<<' : '';
  console.log(`${name}: ${pda.toBase58()}${match}`);
}

// Also check with source_domain as u16, u8
console.log('\nTrying with nonce and different domain sizes:');

// Try u16
const domainU16LE = Buffer.alloc(2);
domainU16LE.writeUInt16LE(sourceDomain);
const domainU16BE = Buffer.alloc(2);
domainU16BE.writeUInt16BE(sourceDomain);

const moreSeeds = [
  { name: 'used_nonces, domain_u16LE, nonce_LE', seeds: [Buffer.from('used_nonces'), domainU16LE, nonceLEB] },
  { name: 'used_nonces, domain_u16BE, nonce_LE', seeds: [Buffer.from('used_nonces'), domainU16BE, nonceLEB] },
  { name: 'used_nonces, domain_u8, nonce_LE', seeds: [Buffer.from('used_nonces'), Buffer.from([sourceDomain]), nonceLEB] },
];

for (const { name, seeds: seedArray } of moreSeeds) {
  const pda = PublicKey.findProgramAddressSync(
    seedArray,
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  const match = pda.toBase58() === expectedAddress ? ' >>> MATCH <<<' : '';
  console.log(`${name}: ${pda.toBase58()}${match}`);
}

// Also try with the nonce as string
console.log('\nTrying with nonce as string:');
const nonceStr = Buffer.from(nonce.toString());

const stringSeeds = [
  { name: 'used_nonces, domain_str, nonce_str', seeds: [Buffer.from('used_nonces'), domainStr, nonceStr] },
  { name: 'used_nonces, domain_LE, nonce_str', seeds: [Buffer.from('used_nonces'), domainLEB, nonceStr] },
  { name: 'used_nonces, domain_BE, nonce_str', seeds: [Buffer.from('used_nonces'), domainBEB, nonceStr] },
];

for (const { name, seeds: seedArray } of stringSeeds) {
  const pda = PublicKey.findProgramAddressSync(
    seedArray,
    MESSAGE_TRANSMITTER_PROGRAM_ID
  )[0];
  
  const match = pda.toBase58() === expectedAddress ? ' >>> MATCH <<<' : '';
  console.log(`${name}: ${pda.toBase58()}${match}`);
}
