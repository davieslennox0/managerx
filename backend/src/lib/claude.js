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

const EXECUTE_TOOL = {
  name: 'execute_action',
  description: 'Execute a buy, sell, or bridge action. Call this tool whenever the user wants to trade or move USDC. Do NOT validate balances yourself — call the tool and the backend handles all validation.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['buy', 'sell', 'bridge'],
        description: 'buy = purchase an xStock with USDC; sell = sell an xStock for USDC returned to Sui; bridge = move USDC between Sui and Solana without trading (use direction field to specify which way)',
      },
      direction: {
        type: 'string',
        enum: ['sui_to_solana', 'solana_to_sui'],
        description: 'Required for bridge. sui_to_solana = burn USDC on Sui, receive on Solana. solana_to_sui = transfer USDC from Solana wallet to Sui wallet. Choose based on where the user says the funds are coming FROM.',
      },
      symbol: {
        type: 'string',
        description: 'xStock symbol e.g. TSLAx, NVDAx. Required for buy/sell. Omit for bridge.',
      },
      amount: {
        type: 'number',
        description: 'Dollar amount in USD',
      },
      currency: {
        type: 'string',
        enum: ['usd'],
        default: 'usd',
      },
    },
    required: ['action', 'amount'],
  },
};

async function chat({ messages, chain, portfolio }) {
  const ctx = CHAIN_CONTEXT[chain] || CHAIN_CONTEXT.arbitrum;

  const crossChain = portfolio.crossChain;
  const crossChainSummary = crossChain ? `
User wallets:
- Sui wallet: ${crossChain.sui.address || 'not connected'} — $${crossChain.sui.usdcBalance.toFixed(2)} USDC
- Solana wallet: ${crossChain.solana.address || 'not connected'} — $${crossChain.solana.usdcBalance.toFixed(2)} USDC${crossChain.solana.positions.length ? `, holdings: ${crossChain.solana.positions.map(p => `${p.symbol} ${p.shares}`).join(', ')}` : ''}` : '';

  const activePortfolio = { ...portfolio };
  delete activePortfolio.crossChain;

  const system = `You are ManagerX, an AI portfolio agent for tokenized RWA stocks on blockchain.

Active chain: ${ctx.name}
Available assets: ${ctx.assets}
Settlement currency: ${ctx.currency}
Execution venue: ${ctx.dex}
${crossChainSummary}
Current portfolio (active chain):
${JSON.stringify(activePortfolio, null, 2)}

INSTRUCTIONS:
- You have real-time price data via the portfolio context above
- When the user wants to buy, sell, or bridge — call the execute_action tool immediately. Do NOT refuse based on your own balance calculations. The backend validates all balances and will return an error if something is wrong.
- For bridge actions, the direction field is mandatory — never omit it. Omitting it does not fail safely: the app defaults to the sui_to_solana direction, which silently moves funds the wrong way if the user meant solana_to_sui. Re-read which wallet the user said the funds are coming FROM before setting direction.
- The agent wallet is invisible infrastructure — it only collects platform fees. Never mention it, never include it in balance summaries, never factor it into anything shown to the user.
- The user's only balances are what appears under "Sui wallet" and "Solana wallet" above.
- Never say you can't execute trades or don't have prices
- Always confirm before executing trades over $100
- Under $100 execute immediately via the tool
- When user sells on Sui chain: USDC returns to their Sui wallet via CCTP (30–60s). Say "processing" until backend confirms.
- When user asks "sell all": call execute_action once per position with individual amounts
- When user asks for their address: show both Sui (for deposits) and Solana (for xStock holdings)
- BALANCE RULE: Always read balances from the portfolio context above — never from chat history

You help users buy/sell tokenized stocks, analyze portfolios, and execute trades.
Keep responses concise.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    tools: [EXECUTE_TOOL],
    tool_choice: { type: 'auto' },
    system,
    messages,
  });

  let text = '';
  let action = null;

  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use' && block.name === 'execute_action') {
      action = block.input;
    }
  }

  return { reply: text.trim(), action };
}

module.exports = { chat };
