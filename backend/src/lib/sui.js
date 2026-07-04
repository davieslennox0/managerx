const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const MANAGER_STATE = process.env.SUI_MANAGER_STATE;
const ADMIN_CAP = process.env.SUI_ADMIN_CAP;

// Only known-safe move calls may be gas-sponsored by the agent. Must match the CCTP
// package deposit_for_burn calls built by the frontend (see cctp.js SUI_CCTP).
const SPONSORABLE_CALLS = [
  { module: 'deposit_for_burn', function: 'deposit_for_burn', package: '0x2aa6c5d56376c371f88a6cc42e852824994993cb9bab8d3e6450cbe3cb32b94e' },
];

function getClient() {
  return new SuiClient({ url: process.env.SUI_RPC_URL || getFullnodeUrl('mainnet') });
}

function getAgentKeypair() {
  const privateKey = process.env.SUI_AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('SUI_AGENT_PRIVATE_KEY not set');
  return Ed25519Keypair.fromSecretKey(privateKey);
}

async function getSuiPortfolio(suiAddress, userId) {
  if (!suiAddress) return { chain: 'sui', usdcBalance: 0, positions: [] };

  try {
    const client = getClient();

    // Get USDC balance on Sui
    const coins = await client.getCoins({
      owner: suiAddress,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    });

    const usdcBalance = coins.data.reduce((acc, c) => acc + Number(c.balance), 0) / 1e6;

    // Get portfolio object if exists
    const objects = await client.getOwnedObjects({
      owner: suiAddress,
      filter: { StructType: `${PACKAGE_ID}::portfolio::UserPortfolio` },
      options: { showContent: true },
    });

    let positions = [];
    if (objects.data.length > 0) {
      const portfolio = objects.data[0].data?.content?.fields;
      if (portfolio?.positions) {
        positions = portfolio.positions.map(p => ({
          symbol: Buffer.from(p.fields.symbol).toString('utf8').replace(/\0/g, ''),
          shares: Number(p.fields.shares) / 1e6,
          avgPrice: Number(p.fields.avg_price) / 100,
        }));
      }
    }

    return { chain: 'sui', address: suiAddress, usdcBalance, positions };
  } catch (e) {
    console.error('SUI portfolio error:', e.message);
    return { chain: 'sui', usdcBalance: 0, positions: [] };
  }
}

async function executeSuiTrade(userAddress, portfolioObjectId, type, symbol, shares, priceCents) {
  if (!PACKAGE_ID) throw new Error('SUI_PACKAGE_ID not set');

  const client = getClient();
  const keypair = getAgentKeypair();
  const tx = new Transaction();

  const symbolBytes = Array.from(Buffer.from(symbol.padEnd(32, '\0')));
  const sharesScaled = Math.round(shares * 1_000_000);

  if (type === 'buy') {
    tx.moveCall({
      target: `${PACKAGE_ID}::portfolio::execute_buy`,
      arguments: [
        tx.object(MANAGER_STATE),
        tx.object(portfolioObjectId),
        tx.pure.vector('u8', symbolBytes),
        tx.pure.u64(sharesScaled),
        tx.pure.u64(priceCents),
      ],
    });
  } else {
    tx.moveCall({
      target: `${PACKAGE_ID}::portfolio::execute_sell`,
      arguments: [
        tx.object(MANAGER_STATE),
        tx.object(portfolioObjectId),
        tx.pure.vector('u8', symbolBytes),
        tx.pure.u64(sharesScaled),
        tx.pure.u64(priceCents),
      ],
    });
  }

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  console.log(`SUI trade confirmed: ${result.digest}`);
  return { txHash: result.digest };
}

// Build a sponsored version of a gasless Sui transaction.
// Frontend sends `onlyTransactionKind` bytes; agent wraps with its gas coin and signs.
// Returns { txBytes (base64), agentSignature } for the frontend to countersign and submit.
async function sponsorSuiTransaction(txKindBase64, senderAddress) {
  const client    = getClient();
  const keypair   = getAgentKeypair();
  const agentAddr = keypair.getPublicKey().toSuiAddress();

  // Rebuild as a full Transaction with the sender set
  const txKindBytes = Buffer.from(txKindBase64, 'base64');
  const tx = Transaction.fromKind(txKindBytes);
  tx.setSender(senderAddress);
  tx.setGasOwner(agentAddr);

  // Never sponsor gas for an arbitrary move call — restrict to the known CCTP
  // deposit_for_burn call, otherwise any authenticated user could grief the agent's
  // SUI gas reserve by requesting sponsorship for unrelated transactions.
  const { commands } = tx.getData();
  if (!commands || commands.length !== 1 || commands[0].$kind !== 'MoveCall') {
    throw new Error('Sponsorship only supports a single move-call transaction');
  }
  const call = commands[0].MoveCall;
  const isAllowed = SPONSORABLE_CALLS.some((c) =>
    call.module === c.module &&
    call.function === c.function &&
    call.package.toLowerCase() === c.package.toLowerCase()
  );
  if (!isAllowed) {
    throw new Error(`Move call ${call.package}::${call.module}::${call.function} is not sponsorable`);
  }

  // Pick the agent's highest-balance SUI coin as gas payment
  const { data: coins } = await client.getCoins({ owner: agentAddr, coinType: '0x2::sui::SUI' });
  if (!coins.length) throw new Error('Agent wallet has no SUI for gas sponsorship');
  const gasCoin = coins.sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))[0];

  tx.setGasPayment([{ objectId: gasCoin.coinObjectId, version: gasCoin.version, digest: gasCoin.digest }]);
  tx.setGasBudget(10_000_000); // 0.01 SUI — covers a CCTP depositForBurn comfortably

  const txBytes = await tx.build({ client });
  const { signature: agentSignature } = await keypair.signTransaction(txBytes);

  return {
    txBytes:        Buffer.from(txBytes).toString('base64'),
    agentSignature,
  };
}

module.exports = { getSuiPortfolio, executeSuiTrade, sponsorSuiTransaction };
