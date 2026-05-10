/**
 * proxies.js — POST /proxies, GET /proxies, GET /proxies/:id,
 *              GET /proxies/:id/history, DELETE /proxies
 */
const { Router } = require('express');
const store    = require('../store/dataStore');
const { extractProxyId } = require('../utils/proxyIdParser');
const monitor  = require('../services/monitoringEngine');
 
const router = Router();
 
// POST /proxies — load proxies into pool
router.post('/proxies', (req, res) => {
  const { proxies, replace } = req.body;
 
  if (!Array.isArray(proxies)) {
    return res.status(400).json({ error: 'proxies must be an array of URLs' });
  }
 
  if (replace === true) {
    // Stop monitoring before clearing so the cycle doesn't race with the clear
    if (monitor.getStatus()) monitor.stop();
    store.clearProxies();
  }
 
  const added = [];
  for (const url of proxies) {
    const id    = extractProxyId(url);
    const proxy = store.addProxy(id, url);
    added.push({ id: proxy.id, url: proxy.url, status: proxy.status });
  }
 
  // Start monitoring if not already running (covers both replace and append cases)
  if (!monitor.getStatus() && store.getAllProxies().length > 0) {
    monitor.start().catch((err) => {
      console.error('[Monitor] Failed to start:', err);
    });
  }
 
  res.status(201).json({ accepted: added.length, proxies: added });
});
 
// GET /proxies — pool summary (reflects latest background check state)
router.get('/proxies', (req, res) => {
  const summary = store.getProxyPoolSummary();
  const all     = store.getAllProxies();
 
  res.json({
    total:        summary.total,
    up:           summary.up,
    down:         summary.down,
    failure_rate: summary.failure_rate,
    proxies: all.map((p) => ({
      id:                   p.id,
      url:                  p.url,
      status:               p.status,
      last_checked_at:      p.last_checked_at,
      consecutive_failures: p.consecutive_failures,
    })),
  });
});
 
// GET /proxies/:id — single proxy detail
router.get('/proxies/:id', (req, res) => {
  const proxy = store.getProxy(req.params.id);
  if (!proxy) {
    return res.status(404).json({ error: 'Proxy not found', id: req.params.id });
  }
 
  const uptime_percentage =
    proxy.total_checks === 0
      ? 0
      : parseFloat(((proxy.up_checks / proxy.total_checks) * 100).toFixed(2));
 
  res.json({
    id:                   proxy.id,
    url:                  proxy.url,
    status:               proxy.status,
    last_checked_at:      proxy.last_checked_at,
    consecutive_failures: proxy.consecutive_failures,
    total_checks:         proxy.total_checks,
    uptime_percentage,
    history:              proxy.history,
  });
});
 
// GET /proxies/:id/history — proxy check history (JSON array, oldest first)
router.get('/proxies/:id/history', (req, res) => {
  const proxy = store.getProxy(req.params.id);
  if (!proxy) {
    return res.status(404).json({ error: 'Proxy not found', id: req.params.id });
  }
  res.json(proxy.history);
});
 
// DELETE /proxies — clear pool; alerts and history survive
router.delete('/proxies', (req, res) => {
  if (monitor.getStatus()) monitor.stop();
  store.clearProxies();
  res.status(204).send();
});
 
module.exports = router;