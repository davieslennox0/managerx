const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHAIN_CONTEXT = {
  arbitrum: {
    name: 'Arbitrum',
    assets: `Robinhood tokenized stocks — 1,997 assets available. Top liquid ones:
    AAPLX (Apple), TSLAX (Tesla), NVDAX (Nvidia), MSFTX (Microsoft), GOOGLX (Google),
    AMZNX (Amazon), METAX (Meta), SPYX (S&P 500 ETF), COINX (Coinbase), MSTRX (MicroStrategy),
    NFLX (Netflix), AMGN (Amgen), BRKBX (Berkshire), JPMX (JPMorgan), VX (Visa).
    All symbols end in X on Arbitrum. Users trade with USDC.`,
    currency: 'USDC on Arbitrum',
    dex: 'Robinhood Chain DEX',
  },
  solana: {
    name: 'Solana',
    assets: `xStocks by Backed Finance:
    TSLAx (Tesla), AAPLx (Apple), NVDAx (Nvidia), SPYx (S&P 500),
    METAx (Meta), GOOGLx (Google), COINx (Coinbase), MSTRx (MicroStrategy),
    CRCLx (Circle), QQQx (Nasdaq ETF)`,
    currency: 'USDC on Solana',
    dex: 'Jupiter aggregator',
  },
  sui: {
    name: 'Sui',
    assets: `xStocks bridged from Solana via CCTP:
    TSLAx, AAPLx, NVDAx, SPYx, METAx, GOOGLx, COINx, MSTRx`,
    currency: 'USDC on Sui',
    dex: 'DeepBook / Jupiter via CCTP bridge',
  },
};

async function chat({ messages, chain, portfolio }) {
  const ctx = CHAIN_CONTEXT[chain] || CHAIN_CONTEXT.arbitrum;

  const system = `You are ManagerX, an AI portfolio agent for tokenized RWA stocks on blockchain.

Active chain: ${ctx.name}
Available assets: ${ctx.assets}
Settlement currency: ${ctx.currency}
Execution venue: ${ctx.dex}

Current portfolio:
${JSON.stringify(portfolio, null, 2)}

IMPORTANT INSTRUCTIONS:
- You DO have access to real-time price data for major stocks via our price feed
- When asked about prices, use the portfolio context above which includes live prices
- You CAN execute trades — when user wants to buy/sell, respond with the JSON action block
- Never say you don't have access to prices or can't execute trades
- For the full catalog of 1,997 Robinhood tokenized stocks, direct users to robinhood.com/stocks
- Always confirm trade details before executing large amounts (>$100)
- Amounts under $100 can be executed immediately with the JSON action

You help users:
- Buy and sell tokenized stocks conversationally
- Analyze their portfolio performance
- Suggest allocations based on their goals
- Execute trades by returning structured JSON actions

When the user wants to trade, respond with your analysis AND include this EXACT format at the end:
\`\`\`json
{"action": "buy", "symbol": "AAPLX", "amount": 100, "currency": "usd"}
\`\`\`
CRITICAL: Always wrap the JSON in triple backticks with json tag. Never output raw JSON without backticks.

Keep responses concise. Always confirm before executing large trades.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    messages,
  });

  return response.content[0].text;
}

module.exports = { chat };
