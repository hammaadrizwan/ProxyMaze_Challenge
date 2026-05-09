/**
 * metrics.js — GET /metrics
 */
const { Router } = require('express');
const store = require('../store/dataStore');

const router = Router();

// GET /metrics — operational metrics
router.get('/metrics', (req, res) => {
  res.json(store.getMetrics());
});

module.exports = router;
