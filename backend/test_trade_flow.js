/**
 * End-to-end test: buy $1.5 NVDAx → wait 90s → sell → bridge USDC to user's Sui wallet.
 *
 * Uses agent's own wallets for signing (user wallets are non-custodial / browser-only):
 *   - Agent Sui USDC → bridged to agent Solana ATA (to fund the buy if needed)
 *   - Agent Solana USDC → Jupiter buy NVDAx
 *   - Jupiter sell NVDAx → agent Solana USDC
 *   - bridgeUsdcSolanaToSui → USDC lands in user's Sui wallet
 */

require('dotenv').config();

const {
  jupiterSwap,
  jupiterSwapXStockToUsdc,
  XSTOCK_MINTS,
} = require('./src/lib/solana');

const {
  bridgeUsdcSolanaToSui,
  bridgeUsdcSuiToSolana,
} = require('./src/lib/cctp');

const { Connection, PublicKey } = require('@solana/web3.js');

const AGENT_SOL_USDC_ATA = process.env.AGENT_SOL_USDC_ATA;
const AGENT_SOL_ADDRESS   = '9JArbFbYDjz261GHEXB5PjoqJAHATuFVtD6yvovGky4x';
const USER_SUI            = '0xf8f1282b7c221ed8f75205abd6dac51f971d8705c816b40cf3ecee16266884e4';
const SYMBOL              = 'NVDAx';
const BUY_USDC            = 0.95; // agent has ~$1.08 total; buffer for slippage/fees
const HOLD_SECONDS        = 90;
const PLATFORM_FEE_BPS    = parseInt(process.env.PLATFORM_FEE_BPS || '0');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getAgentSolanaUsdcBalance() {
  const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const bal  = await conn.getTokenAccountBalance(new PublicKey(AGENT_SOL_USDC_ATA));
  return parseFloat(bal.value.uiAmountString);
}

(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  End-to-End Trade Flow Test');
  console.log('  Buy $0.95 NVDAx → hold 90s → sell → bridge Sui');
  console.log('═══════════════════════════════════════════════\n');

  // ── STEP 0: Ensure agent has enough Solana USDC ──────────────────────────
  let agentUsdc = await getAgentSolanaUsdcBalance();
  console.log(`Step 0: Agent Solana USDC balance: $${agentUsdc.toFixed(6)}`);

  const needed = BUY_USDC + 0.1; // $0.10 buffer for slippage/fees
  if (agentUsdc < needed) {
    const bridgeAmount = (1.0).toFixed(2); // bridge all $1 from agent Sui wallet
    console.log(`        Insufficient — bridging $${bridgeAmount} from agent Sui wallet to Solana...`);
    const br = await bridgeUsdcSuiToSolana(parseFloat(bridgeAmount), AGENT_SOL_ADDRESS);
    console.log(`        ✅ Bridge Sui→Sol: burn=${br.sourceTxHash.slice(0,20)}… mint=${br.mintTxHash.slice(0,20)}…`);
    agentUsdc = await getAgentSolanaUsdcBalance();
    console.log(`        Agent Solana USDC after bridge: $${agentUsdc.toFixed(6)}`);
  } else {
    console.log(`        Sufficient — no bridge needed.\n`);
  }

  // ── STEP 1: Buy NVDAx ────────────────────────────────────────────────────
  const grossRaw = Math.round(BUY_USDC * 1e6);
  const feeRaw   = Math.round(grossRaw * PLATFORM_FEE_BPS / 10000);
  const swapUsdc = (grossRaw - feeRaw) / 1e6;

  console.log(`Step 1: Buying $${BUY_USDC} ${SYMBOL} (swap amount: $${swapUsdc.toFixed(6)})...`);
  const buyResult = await jupiterSwap(AGENT_SOL_ADDRESS, SYMBOL, swapUsdc);
  console.log(`        ✅ Buy tx:     ${buyResult.txHash}`);
  console.log(`           Got:        ${buyResult.outputAmount} ${SYMBOL}`);
  console.log(`           Mint:       ${buyResult.mintAddress}\n`);

  // ── STEP 2: Hold 90 seconds ──────────────────────────────────────────────
  console.log(`Step 2: Holding for ${HOLD_SECONDS} seconds...`);
  for (let i = HOLD_SECONDS; i > 0; i -= 10) {
    process.stdout.write(`        ${i}s remaining...   \r`);
    await sleep(Math.min(10_000, i * 1000));
  }
  console.log('\n        Hold complete.\n');

  // ── STEP 3: Sell NVDAx ───────────────────────────────────────────────────
  console.log(`Step 3: Selling ${buyResult.rawOutputAmount} raw ${SYMBOL}...`);
  const sellResult = await jupiterSwapXStockToUsdc(buyResult.mintAddress, buyResult.rawOutputAmount);
  console.log(`        ✅ Sell tx:    ${sellResult.txHash}`);
  console.log(`           Got:        $${sellResult.usdcAmount.toFixed(6)} USDC`);
  console.log(`           Raw:        ${sellResult.rawUsdcAmount} μUSDC\n`);

  // Deduct platform fee from bridge amount
  const sellFeeRaw = Math.round(sellResult.rawUsdcAmount * PLATFORM_FEE_BPS / 10000);
  const bridgeRaw  = sellResult.rawUsdcAmount - sellFeeRaw;
  console.log(`        Platform fee: $${(sellFeeRaw/1e6).toFixed(6)} | Bridging: $${(bridgeRaw/1e6).toFixed(6)}\n`);

  // ── STEP 4: Bridge USDC Solana → user's Sui wallet ───────────────────────
  console.log(`Step 4: Bridging $${(bridgeRaw/1e6).toFixed(6)} USDC → Sui(${USER_SUI.slice(0,14)}...)...`);
  const bridge = await bridgeUsdcSolanaToSui(bridgeRaw, USER_SUI);
  console.log(`        ✅ Burn tx (Solana): ${bridge.burnTxHash}`);
  console.log(`        ✅ Mint tx (Sui)   : ${bridge.suiMintTxHash}`);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ COMPLETE — Full round-trip done.');
  console.log(`  Buy tx:      ${buyResult.txHash}`);
  console.log(`  Sell tx:     ${sellResult.txHash}`);
  console.log(`  Sui mint tx: ${bridge.suiMintTxHash}`);
  console.log('═══════════════════════════════════════════════');
})().catch(e => {
  console.error('\n❌ FAILED:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
