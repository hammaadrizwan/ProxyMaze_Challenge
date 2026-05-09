/**
 * config.js — POST /config, GET /config
 */
const { Router } = require('express');
const store   = require('../store/dataStore');
const monitor = require('../services/monitoringEngine');
 
const router = Router();
 
// GET /config — return current config
router.get('/config', (req, res) => {
  res.json(store.getConfig());
});
 
// POST /config — update monitoring configuration; takes effect immediately
router.post('/config', async (req, res) => {
  const updated = store.setConfig(req.body);
 
  // Hot-reload: restart the monitor timer so the new interval applies immediately.
  // Don't run a probe immediately — just reschedule.
  if (monitor.getStatus()) {
    try {
      await monitor.restart({ runImmediately: false });
    } catch (err) {
      console.error('[Config] Error restarting monitor:', err);
    }
  }
 
  res.json(updated);
});
 
module.exports = router;