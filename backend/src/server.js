const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');

dotenv.config();

const { createPool } = require('./db');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 5000;

// Security headers
app.use(helmet());

// CORS
const corsOrigin = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());
app.use(cors({ origin: corsOrigin, credentials: true }));

// Rate limiting (global)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Lightweight request logger
app.use((req, _res, next) => {
  if (req.method !== 'OPTIONS') {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  }
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'triveni-gst-erp', time: new Date().toISOString() });
});

// Ensure DB pool
createPool();

// Routes
app.use('/api', routes);

// Serve the built frontend (single-port deployment: laptop/VPS, one process)
const distDir = process.env.FRONTEND_DIST || path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: return index.html for non-API, non-asset GETs
  app.get(/^\/(?!api\/).*/i, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  console.warn(`[server] Frontend dist not found at ${distDir} - API only. Run: cd frontend && npm run build`);
}

// 404 + error handling
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\nTriVista GST backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health\n`);
});

// Recurring invoice automation (daily, ~00:05)
const { runDue } = require('./controllers/recurringController');
const runRecurring = async () => {
  try {
    const r = await runDue();
    if (r.created.length) console.log(`[recurring] generated ${r.created.length} invoice(s)`);
  } catch (e) {
    console.error('[recurring]', e.message);
  }
};
const MIN = 60 * 1000;
setTimeout(runRecurring, 5 * MIN);
setInterval(runRecurring, 24 * 60 * MIN);

module.exports = app;