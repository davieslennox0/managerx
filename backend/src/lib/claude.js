const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHAIN_CONTEXT = {
  arbitrum: {
    name: 'Arbitrum',
    assets: 'Robinhood tokenized stocks (AAPLX, TSLAX, NVDAX, MSFTX, GOOGLX, AMZNX, METAX, SPYX and 1990+ more)',
    currency: 'USDC on Arbitrum',
    dex: 'Robinhood Chain DEX',
  },
  solana: {
    name: 'Solana',
    assets: 'xStocks by Backed Finance (TSLAx, AAPLx, NVDAx, SPYx, METAx, GOOGLx, COINx, MSTRx, CRCLx, QQQx)',
    currency: 'USDC on Solana',
    dex: 'Jupiter aggregator',
  },
  sui: {
    name: 'Sui',
    assets: 'xStocks bridged from Solana via CCTP',
    currency: 'USDC on Sui',
    dex: 'DeepBook',
  },
};

async function chat({ messages, chain, portfolio }) {
  const ctx = CHAIN_CONTEXT[chain] || CHAIN_CONTEXT.arbitrum;

  const system = `You are ManagerX, an AI portfolio agent for tokenized RWA stocks.

Active chain: ${ctx.name}
Available assets: ${ctx.assets}
Settlement currency: ${ctx.currency}
Execution venue: ${ctx.dex}

Current portfolio:
${JSON.stringify(portfolio, null, 2)}

You help users:
- Buy and sell tokenized stocks conversationally
- Analyze their portfolio performance
- Suggest allocations based on their goals
- Execute trades by returning structured JSON actions

When the user wants to trade, respond with your analysis AND include a JSON block:
\`\`\`json
{"action": "buy"|"sell", "symbol": "TSLAX", "amount": 100, "currency": "usd"|"shares"}
\`\`\`

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
