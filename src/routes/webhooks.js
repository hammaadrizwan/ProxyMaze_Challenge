/**
 * webhooks.js — POST /webhooks
 */
const { Router } = require('express');
const store = require('../store/dataStore');

const router = Router();

// POST /webhooks — register a webhook receiver
router.post('/webhooks', (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required and must be a string' });
  }

  const webhook = store.addWebhook(url);
  res.status(201).json(webhook);
});

module.exports = router;
