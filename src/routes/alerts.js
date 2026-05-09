const { Router } = require('express');
const store = require('../store/dataStore');

const router = Router();

// GET /alerts — return all alerts (active + resolved)
router.get('/alerts', (req, res) => {
  res.json(store.getAllAlerts());
});

module.exports = router;
