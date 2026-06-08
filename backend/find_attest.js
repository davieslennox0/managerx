const { ethers } = require('ethers');
const axios = require('axios');

const hex = '83648538a6e1973c7b4383237494a4db0ac6b50b976f0f678ce1c4251132848ff32322c53d73118df800000000000000000000050000000800000000000aec55a65fc943419a5ad590042fd67c9791fd015acf53a54cc823edb8ff81b9ed722eafdc792c79ad11215d6661cc06320d48b9f7dd46f4e9d4901c45986fa430e3c8000000000000000000000000000000000000000000000000000000000000000000000000c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61f8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e400000000000000000000000000000000000000000000000000000000002dc6c07b4383237494a4db0ac6b50b976f0f678ce1c4251132848ff32322c53d73118d';

const data = Buffer.from(hex, 'hex');

async function find() {
  for (let i = 0; i < 20; i++) {
    const slice = data.slice(i);
    if (slice.readUInt32BE(0) === 0) {
      const msgHex = '0x' + slice.toString('hex');
      const hash = ethers.keccak256(msgHex);
      try {
        const res = await axios.get('https://iris-api.circle.com/v1/attestations/' + hash);
        console.log('Offset', i, 'status:', res.data?.status);
        if (res.data?.status === 'complete') console.log('FOUND at offset', i, 'hash:', hash);
      } catch(e) {
        console.log('Offset', i, ': 404');
      }
    }
  }
}
find().catch(console.error);
