const express = require('express');
const axios = require('axios');
const router = express.Router();

// Cache prices for 60s
let cache = { data: null, ts: 0 };

const STOCKS = {
  arbitrum: ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL'],
  sui: ['TSLA', 'AAPL', 'NVDA', 'SPY', 'META'],
};

router.get('/:chain', async (req, res) => {
  const now = Date.now();
  if (cache.data && now - cache.ts < 60000) return res.json(cache.data);

  try {
    const symbols = STOCKS[req.params.chain] || STOCKS.arbitrum;
    const results = {};
    await Promise.all(symbols.map(async sym => {
      try {
        const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { timeout: 3000 });
        const price = r.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        const prev = r.data?.chart?.result?.[0]?.meta?.chartPreviousClose;
        if (price) results[sym] = { price: price.toFixed(2), change: prev ? (((price - prev) / prev) * 100).toFixed(2) : '0.00' };
      } catch { results[sym] = { price: '—', change: '0.00' }; }
    }));
    cache = { data: results, ts: now };
    res.json(results);
  } catch (e) {
    res.json({});
  }
});

module.exports = router;
