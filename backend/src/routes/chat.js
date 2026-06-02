const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { getPrice, getAllPrices, getSymbols } = require('./prices');
const { bridgeSuiToArbitrum } = require('../lib/cctp');

const router = express.Router();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
  defaultHeaders: {
    'anthropic-beta': 'interleaved-thinking-2025-05-14',
    'user-agent': 'claude-code/1.0',
  },
});

function getPortfolioContext(userId) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const holdings = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND chain = 'arbitrum'").all(userId);
    const suiHoldings = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND chain = 'sui'").all(userId);
    const recentTxs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10').all(userId);
    const pendingBridge = db.prepare("SELECT * FROM bridge_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(userId);

    let arbValue = 0;
    const enrichedArb = holdings.map(h => {
      const price = getPrice(h.symbol) || h.avg_price;
      const value = price * h.shares;
      arbValue += value;
      return `${h.symbol}: ${h.shares} shares @ avg $${h.avg_price.toFixed(2)}, current $${price.toFixed(2)}, value $${value.toFixed(2)}`;
    });

    return {
      arbCash: user?.arb_usdc_balance ?? 10000,
      suiCash: user?.sui_usdc_balance ?? 0,
      arbStockValue: arbValue,
      arbHoldings: enrichedArb,
      suiHoldings: suiHoldings.map(h => `${h.symbol}: ${h.shares} shares`),
      recentTxs: recentTxs.slice(0, 5).map(t => `${t.type.toUpperCase()} ${t.shares} ${t.symbol} @ $${t.price} on ${t.chain}`),
      evmAddress: user?.evm_address,
      suiAddress: user?.sui_address,
      pendingBridge: pendingBridge ? `Bridge pending: $${pendingBridge.amount_usdc} Sui→Arb` : null,
    };
  } catch { return { arbCash: 10000, suiCash: 0, arbStockValue: 0, arbHoldings: [], suiHoldings: [], recentTxs: [] }; }
}

const SYSTEM_PROMPT = `You are Manager — an AI portfolio agent for tokenized RWA stocks.

CHAINS YOU SUPPORT:
- Arbitrum (primary): Robinhood tokenized stocks — ${getSymbols().join(', ')}
- Sui: stocksrwa.io — AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, SPY, MSTR

BRIDGING (CCTP by Circle):
When a user wants to buy on Arbitrum but has USDC on Sui, you automatically bridge first.
You bridge WITHOUT asking permission — just inform the user as you do it.
Example: "Bridging $500 USDC from Sui → Arbitrum via CCTP, then buying 1 NVDAX."

PERSONALITY: Concise, sharp, professional. Like a quant PM.

TRADE ACTIONS — include at end of response when trading:
<action>
{
  "type": "buy" | "sell" | "bridge_and_buy",
  "chain": "arbitrum" | "sui",
  "symbol": "NVDAX",
  "shares": 2,
  "estimatedCost": 1026.00,
  "bridgeAmount": 1100,
  "requiresConfirm": true,
  "reasoning": "One line reason"
}
</action>

BRIDGE ACTION — when bridging only:
<action>
{
  "type": "bridge",
  "fromChain": "sui",
  "toChain": "arbitrum",
  "amount": 500,
  "requiresConfirm": false,
  "reasoning": "Moving funds to Arbitrum for trading"
}
</action>

SAFETY GUARDS:
1. Single trade ≤ 40% of total portfolio
2. Single position ≤ 50% of portfolio
3. Cash buffer is $0.50 minimum (NOT $500) — ignore $500 buffer warnings for small accounts
4. Warn before bridging if it would drain Sui balance

Never include <action> for informational queries.`;

router.post('/', async (req, res) => {
  const { messages, userId } = req.body;
  if (!messages || !userId) return res.status(400).json({ error: 'Missing params' });

  try {
    const ctx = getPortfolioContext(userId);
    const prices = getAllPrices();

    const contextBlock = `
PORTFOLIO STATE:
Arbitrum USDC: $${ctx.arbCash.toFixed(2)} | Stock Value: $${ctx.arbStockValue.toFixed(2)} | Total ARB: $${(ctx.arbCash + ctx.arbStockValue).toFixed(2)}
Sui USDC: $${ctx.suiCash.toFixed(2)}
EVM Wallet: ${ctx.evmAddress || 'not set'}
Sui Wallet: ${ctx.suiAddress || 'not set'}
${ctx.pendingBridge ? '⚠️ ' + ctx.pendingBridge : ''}

Arbitrum Holdings:
${ctx.arbHoldings.length > 0 ? ctx.arbHoldings.join('\n') : 'None'}

Sui Holdings:
${ctx.suiHoldings.length > 0 ? ctx.suiHoldings.join('\n') : 'None'}

Recent Trades:
${ctx.recentTxs.length > 0 ? ctx.recentTxs.join('\n') : 'None'}

Live Arbitrum Prices:
${Object.entries(prices).map(([k,v]) => `${k}: $${v}`).join(' | ')}
`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: SYSTEM_PROMPT + '\n\n' + contextBlock,
      messages: messages.slice(-20),
    });

    const rawReply = response?.content?.[0]?.text ||
      response?.content?.map(b => b.text || '').join('') ||
      'Sorry, try again.';

    const actionMatch = rawReply.match(/<action>([\s\S]*?)<\/action>/);
    let action = null;
    const reply = rawReply.replace(/<action>[\s\S]*?<\/action>/g, '').trim();

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1].trim());
        if (!action.estimatedCost && action.symbol && action.shares) {
          const price = getPrice(action.symbol.toUpperCase());
          if (price) action.estimatedCost = parseFloat((price * action.shares).toFixed(2));
        }
        // Auto-trigger bridge if type is bridge (no confirm needed)
        if (action.type === 'bridge' && !action.requiresConfirm) {
          const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          if (user?.evm_address) {
            bridgeSuiToArbitrum({
              userId, amountUsdc: action.amount * 1e6,
              suiAddress: user.sui_address,
              evmAddress: user.evm_address,
              db,
            }).catch(e => console.error('Auto-bridge error:', e.message));
          }
        }
      } catch (e) { console.error('Action parse error:', e); }
    }

    res.json({ reply, action });
  } catch (e) {
    console.error('Claude error:', e.message);
    res.status(500).json({ error: 'Agent error. Try again.' });
  }
});

module.exports = router;
