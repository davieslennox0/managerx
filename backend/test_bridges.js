require('dotenv').config();
const { bridgeUsdcSolanaToSui, bridgeUsdcSuiToSolana } = require('./src/lib/cctp');

const USER_SUI = '0xf8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e4';
const USER_SOL = 'E5R1ii9Zuj4hiHSA9YjcKfKd8vkUTo1uGKWxAh6L4n5B'; // user's Solana wallet address
const RAW = 100_000; // $0.10 in micro-USDC

(async () => {
  // ── TEST 1: Solana → Sui ──────────────────────────────────────────────────
  console.log('\n🔵 TEST 1: Solana → Sui');
  console.log('   Burning $0.10 USDC on Solana, minting to user Sui wallet…');
  try {
    const r = await bridgeUsdcSolanaToSui(RAW, USER_SUI);
    console.log('   ✅ Burn tx (Solana):', r.burnTxHash);
    console.log('   ✅ Mint tx (Sui)   :', r.suiMintTxHash);
  } catch (e) {
    console.log('   ❌', e.message);
  }

  // ── TEST 2: Sui → Solana ──────────────────────────────────────────────────
  console.log('\n🟣 TEST 2: Sui → Solana');
  console.log('   Burning $0.10 USDC on Sui, minting to user Solana wallet…');
  try {
    const r = await bridgeUsdcSuiToSolana(RAW / 1e6, USER_SOL);
    console.log('   ✅ Burn tx (Sui)   :', r.sourceTxHash);
    console.log('   ✅ Mint tx (Solana):', r.mintTxHash);
  } catch (e) {
    console.log('   ❌', e.message || e);
    if (e.cause) console.log('      cause:', e.cause);
    if (e.logs) console.log('      logs:', e.logs);
    if (e.stack) console.log('      stack:', e.stack.split('\n').slice(0, 5).join('\n'));
  }
})();
