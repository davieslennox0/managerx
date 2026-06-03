require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  validate: { xForwardedForHeader: false }
}));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/portfolio', require('./routes/portfolio'));
app.use('/api/trade',     require('./routes/trade'));
app.use('/api/chat',      require('./routes/chat'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`
🟢 ManagerX API on port ${PORT}
   Chains: ARB | SOL | SUI
   Mode: ${process.env.TRADE_MODE || 'mock'}
  `);
});
