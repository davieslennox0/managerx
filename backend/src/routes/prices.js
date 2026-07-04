const express = require('express');
const axios = require('axios');
const router = express.Router();

// Cache prices for 60s, keyed by chain (each chain has a different symbol set).
const cache = {};

const STOCKS = {
  arbitrum: ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'COIN', 'MSTR', 'NFLX'],
  sui: ['TSLA', 'AAPL', 'NVDA', 'SPY', 'META', 'MSFT', 'GOOGL', 'AMZN', 'COIN', 'MSTR',
        'PLTR', 'NFLX', 'JPM', 'GS', 'BAC', 'MA', 'V', 'WMT', 'MCD', 'KO',
        'PEP', 'PG', 'JNJ', 'PFE', 'MRK', 'LLY', 'UNH', 'ABT', 'ABBV', 'DHR',
        'TMO', 'XOM', 'CVX', 'AVGO', 'INTC', 'IBM', 'ORCL', 'CRM', 'CRWD', 'HOOD'],
};

router.get('/:chain', async (req, res) => {
  const chain = req.params.chain;
  const now = Date.now();
  const cached = cache[chain];
  if (cached && now - cached.ts < 60000) return res.json(cached.data);

  try {
    const symbols = STOCKS[chain] || STOCKS.arbitrum;
    const results = {};
    await Promise.all(symbols.map(async sym => {
      try {
        const r = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`, { timeout: 3000 });
        const price = r.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        const prev = r.data?.chart?.result?.[0]?.meta?.chartPreviousClose;
        if (price) results[sym] = { price: price.toFixed(2), change: prev ? (((price - prev) / prev) * 100).toFixed(2) : '0.00' };
      } catch { results[sym] = { price: '—', change: '0.00' }; }
    }));
    cache[chain] = { data: results, ts: now };
    res.json(results);
  } catch (e) {
    res.json({});
  }
});



async function getPrice(symbol) {
  try {
    const r = await require('axios').get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { timeout: 3000 }
    );
    const price = r.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price ? { price: price.toFixed(2) } : null;
  } catch { return null; }
}

module.exports = { router, getPrice };
