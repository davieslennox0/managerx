require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolio');
const tradeRoutes     = require('./routes/trade');
const chatRoutes      = require('./routes/chat');
const bridgeRoutes    = require('./routes/bridge');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Global: 60 req/min per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Slow down.' }
}));

// Chat: 10 messages/min per IP
const chatLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Chat limit reached. Wait a moment.' }
});

app.use('/api/auth',      authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trade',     tradeRoutes);
app.use('/api/chat',      chatLimit, chatRoutes);
app.use('/api/bridge',    bridgeRoutes);

app.get('/api/health', (_, res) => res.json({
  status: 'ok', service: 'Manager v2',
  features: ['privy', 'zklogin', 'cctp', 'arbitrum', 'sui'],
  timestamp: new Date().toISOString(),
}));

app.listen(PORT, () => {
  console.log(`\n🟢 Manager v2 API on port ${PORT}`);
  console.log(`   Privy: ${process.env.PRIVY_APP_ID ? '✓' : '✗'}`);
  console.log(`   Claude: ${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  console.log(`   Mode: ${process.env.TRADE_MODE || 'mock'}\n`);
});
