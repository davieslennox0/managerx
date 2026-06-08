const { Connection } = require('@solana/web3.js');

// Ordered list of Solana RPC endpoints to try. Primary comes from env; the rest
// are public fallbacks used only when the primary returns 403/429.
const RPC_URLS = [
  process.env.SOLANA_RPC_URL,
].filter(Boolean);

function getConnection() {
  return new Connection(RPC_URLS[0], 'confirmed');
}

// Run fn(connection) against each RPC URL in order, skipping to the next on
// 403 / 429 / network errors. Non-RPC errors (bad tx, insufficient funds, etc.)
// are thrown immediately without trying other endpoints.
async function withFallback(fn) {
  let lastErr;
  for (const url of RPC_URLS) {
    try {
      return await fn(new Connection(url, 'confirmed'));
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      const isRateLimit =
        msg.includes('403') ||
        msg.includes('429') ||
        msg.includes('forbidden') ||
        msg.includes('too many requests') ||
        msg.includes('access denied') ||
        msg.includes('api key') ||
        msg.includes('not available') ||
        msg.includes('upgrade') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('etimedout');
      if (isRateLimit) {
        lastErr = e;
        console.warn(`[solana] RPC ${url} failed (${e.message.slice(0, 80)}), trying next…`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { RPC_URLS, getConnection, withFallback };
