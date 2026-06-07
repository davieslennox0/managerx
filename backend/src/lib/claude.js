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
    assets: `xStocks by Backed Finance (now Kraken) — 60+ tokenized US stocks on Solana:
    TSLAx, AAPLx, NVDAx, MSFTx, METAx, GOOGLx, AMZNx, SPYx, QQQx, TQQQx,
    COINx, MSTRx, CRCLx, HOODx, PLTRx, NFLXx, JPMx, GSx, BACx, MAx,
    Vx, WMTx, MCDx, KOx, PEPx, PGx, JNJx, PFEx, MRKx, LLYx, UNHx,
    ABTx, ABBVx, MDTx, DHRx, TMOx, XOMx, CVXx, LINx, HONx, CSCOx,
    INTCx, IBMx, ORCLx, CRMx, CRWDx, AVGOx, MRVLx, NVOx, AZNx,
    HDx, ACNx, CMCSAx, PMx, BRKBx, GLDx, VTIx, TBLLx, GSx, GMEx,
    AMBRx, APPx, DFDVx, HONx, OPENx, PEPx and more.
    All 1:1 backed by real shares. Trade 24/7 via Jupiter on Solana.`,
    currency: 'USDC on Solana',
    dex: 'Jupiter aggregator',
  },
  sui: {
    name: 'Sui',
    assets: `xStocks by Backed Finance (Kraken) — 74 tokenized US stocks on Solana, accessible via Sui:
    TSLAx (Tesla), AAPLx (Apple), NVDAx (Nvidia), SPYx (S&P 500 ETF),
    METAx (Meta), GOOGLx (Google), AMZNx (Amazon), MSFTx (Microsoft),
    COINx (Coinbase), MSTRx (MicroStrategy), CRCLx (Circle), QQQx (Nasdaq ETF),
    and 60+ more. Each is 1:1 backed by real shares held by regulated custodians.`,
    currency: 'USDC on Sui (bridged to Solana via CCTP for execution)',
    dex: 'Jupiter aggregator on Solana',
    note: 'User deposits USDC on Sui. Agent bridges via CCTP to Solana, buys xStocks on Jupiter, position tracked on Sui.',
    sellNote: 'Selling returns USDC to the user\'s Sui wallet. The full cycle is: xStock transferred to agent on Solana → Jupiter swaps xStock→USDC → CCTP bridges USDC Solana→Sui → USDC arrives in user\'s Sui wallet. This takes 30–60 seconds.',
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
- CRITICAL: Never claim a trade is confirmed or complete until the backend explicitly confirms it. Trades on the Sui chain involve multi-step cross-chain operations (CCTP bridge + Jupiter swap) and take 30–60 seconds to settle. Say "your trade is being processed" until you receive confirmation from the backend.
- When a user sells on the Sui chain: USDC is returned to their Sui wallet via CCTP bridge. This takes 30–60 seconds. Do not claim the USDC has arrived until the backend confirms.

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
