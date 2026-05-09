/**
 * config.js — POST /config, GET /config
 */
const { Router } = require('express');
const store = require('../store/dataStore');
const monitor = require('../services/monitoringEngine');

const router = Router();

// GET /config — return current config
router.get('/config', (req, res) => {
  res.json(store.getConfig());
});

// POST /config — update monitoring configuration
router.post('/config', (req, res) => {
  const updated = store.setConfig(req.body);

  // If monitoring is active, restart with new interval
  if (monitor.getStatus()) {
    monitor.restart();
  }

  res.json(updated);
});

module.exports = router;
