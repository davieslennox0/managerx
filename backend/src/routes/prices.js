const BASE_PRICES = {
  // Arbitrum (Robinhood tokenized)
  AAPLX: 189.42, TSLAX: 248.71, NVDAX: 512.30,
  GOOGLX: 174.55, MSFTX: 415.22, AMZNX: 198.90,
  METAX: 521.44, SPYX: 543.10, QQQX: 471.85,
  COINX: 52.30, GLDX: 188.60,
  // Sui (stocksrwa.io)
  AAPL: 189.42, TSLA: 248.71, NVDA: 512.30,
  MSFT: 415.22, GOOGL: 174.55, AMZN: 198.90,
  SPY: 543.10, MSTR: 389.20,
};

function getPrice(symbol) {
  const base = BASE_PRICES[symbol.toUpperCase()];
  if (!base) return null;
  const jitter = (Math.random() - 0.5) * 0.01;
  return parseFloat((base * (1 + jitter)).toFixed(2));
}

function getAllPrices() {
  return Object.fromEntries(Object.keys(BASE_PRICES).map(s => [s, getPrice(s)]));
}

function isValidSymbol(symbol) { return !!BASE_PRICES[symbol?.toUpperCase()]; }
function getSymbols() { return Object.keys(BASE_PRICES); }

module.exports = { getPrice, getAllPrices, isValidSymbol, getSymbols };
