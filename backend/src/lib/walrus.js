const fs = require('fs');
const path = require('path');

// Primary and fallback receipt directories on the server.
function getReceiptDir() {
  const primary  = '/root/walrus-receipt';
  const fallback = '/root/walrus-receipts';
  if (fs.existsSync(primary))  return primary;
  if (fs.existsSync(fallback)) return fallback;
  fs.mkdirSync(primary, { recursive: true });
  return primary;
}

// Lazy-init the WalrusReceipts client (ESM package, loaded via dynamic import).
let _notaClient = null;
async function getNotaClient() {
  if (_notaClient) return _notaClient;

  const { WalrusReceipts } = await import('@sykeclone/nota-sdk');
  _notaClient = new WalrusReceipts({
    suiRpcUrl:           process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443',
    privateKey:          process.env.SUI_AGENT_PRIVATE_KEY,
    packageId:           process.env.RECEIPTS_PACKAGE_ID,
    registryId:          process.env.RECEIPTS_REGISTRY_ID,
    walrusAggregatorUrl: process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus.space',
    walrusPublisherUrl:  process.env.WALRUS_PUBLISHER_URL  || 'https://publisher.walrus.space',
    namespace:           process.env.NOTA_NAMESPACE || 'managerx',
  });
  return _notaClient;
}

// Store a trade receipt via Nota (Walrus + Sui NFT anchor).
// Saves a local copy to /root/walrus-receipt/ regardless of outcome.
// Returns { receiptId, blobId, viewUrl, localPath } or null on total failure.
async function storeTradeReceipt(receiptData) {
  const dir = getReceiptDir();
  const ts  = Date.now();
  const localFile = path.join(dir, `receipt_${ts}_${(receiptData.txHash || 'unknown').slice(0, 12)}.json`);

  let anchoredReceipt = null;

  try {
    const nota = await getNotaClient();

    anchoredReceipt = await nota.issue({
      txHash:    receiptData.txHash || 'unknown',
      asset:     receiptData.symbol,
      action:    receiptData.type?.toUpperCase() || 'TRADE',
      amount:    Math.round((receiptData.total || 0) * 1e6),  // in μUSDC
      currency:  'USDC',
      recipient: receiptData.userId,
      price:     receiptData.price,
      priceUnit: 'USD',
      metadata:  {
        chain:  receiptData.chain,
        shares: receiptData.shares,
      },
    });

    console.log(`[Nota] Receipt #${anchoredReceipt.receiptId} — blobId=${anchoredReceipt.blobId} view=${anchoredReceipt.viewUrl}`);
  } catch (e) {
    console.warn('[Nota] Receipt upload failed (non-fatal):', e.message);
  }

  // Always write a local copy
  const localData = {
    ...receiptData,
    nota: anchoredReceipt || null,
    savedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(localFile, JSON.stringify(localData, null, 2));
  } catch (e) {
    console.warn('[Nota] Local receipt write failed:', e.message);
  }

  return anchoredReceipt
    ? { ...anchoredReceipt, localPath: localFile }
    : { localPath: localFile };
}

module.exports = { storeTradeReceipt };
