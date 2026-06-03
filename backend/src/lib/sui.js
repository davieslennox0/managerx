const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');

const PACKAGE_ID = process.env.SUI_PACKAGE_ID;
const MANAGER_STATE = process.env.SUI_MANAGER_STATE;
const ADMIN_CAP = process.env.SUI_ADMIN_CAP;

function getClient() {
  return new SuiClient({ url: getFullnodeUrl('mainnet') });
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

module.exports = { getSuiPortfolio, executeSuiTrade };
