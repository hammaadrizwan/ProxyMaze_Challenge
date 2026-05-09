/**
 * server.js — ProxyMaze Express application entry point.
 * Wires up all routes, middleware, and starts listening.
 */

const express = require('express');

// ─── Route modules ───
const healthRoutes = require('./routes/health');
const configRoutes = require('./routes/config');
const proxyRoutes = require('./routes/proxies');
const alertRoutes = require('./routes/alerts');
const webhookRoutes = require('./routes/webhooks');
const integrationRoutes = require('./routes/integrations');
const metricRoutes = require('./routes/metrics');

// ─── Create app ───
const app = express();

// ─── Middleware ───
app.use(express.json());

// ─── Mount routes ───
app.use(healthRoutes);
app.use(configRoutes);
app.use(proxyRoutes);
app.use(alertRoutes);
app.use(webhookRoutes);
app.use(integrationRoutes);
app.use(metricRoutes);

// ─── Root endpoint ───
app.get('/', (req, res) => {
  res.json({
    message: "Welcome to ProxyMaze API",
    status: "running"
  });
});

// ─── 404 catch-all ───
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ───
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔥 ProxyMaze is live on http://localhost:${PORT}\n`);
  console.log('  Endpoints:');
  console.log('    GET    /health');
  console.log('    POST   /config');
  console.log('    GET    /config');
  console.log('    POST   /proxies');
  console.log('    GET    /proxies');
  console.log('    GET    /proxies/:id');
  console.log('    GET    /proxies/:id/history');
  console.log('    DELETE /proxies');
  console.log('    GET    /alerts');
  console.log('    POST   /webhooks');
  console.log('    POST   /integrations');
  console.log('    GET    /metrics');
  console.log('');
});
