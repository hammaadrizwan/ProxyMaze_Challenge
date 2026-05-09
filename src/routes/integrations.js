/**
 * integrations.js — POST /integrations
 */
const { Router } = require('express');
const store = require('../store/dataStore');

const router = Router();

// POST /integrations — register Slack or Discord integration
router.post('/integrations', (req, res) => {
  const { type, webhook_url, username, events } = req.body;

  if (!type || !webhook_url) {
    return res.status(400).json({ error: 'type and webhook_url are required' });
  }

  if (!['slack', 'discord'].includes(type)) {
    return res.status(400).json({ error: 'type must be "slack" or "discord"' });
  }

  const integration = store.addIntegration(type, webhook_url, username, events);
  res.json(integration);
});

module.exports = router;
