/**
 * notificationEngine.js
 * Delivers alert events to webhooks, Slack, and Discord integrations.
 * Handles retries for 5xx responses and prevents duplicate deliveries.
 */

const axios = require('axios');
const store = require('../store/dataStore');
const { toUnixSeconds } = require('../utils/timestamps');

/** Track successfully delivered (webhookUrl, alertId, event) combos */
const delivered = new Set();

function deliveryKey(url, alertId, event) {
  return `${url}|${alertId}|${event}`;
}

/**
 * POST with retry on 5xx. Max 3 retries, 2s apart.
 */
async function postWithRetry(url, payload, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status };
      }
      // Retry only on 500, 502, 503, 504
      if ([500, 502, 503, 504].includes(res.status) && attempt < retries) {
        await sleep(2000);
        continue;
      }
      return { success: false, status: res.status };
    } catch (err) {
      if (attempt < retries) {
        await sleep(2000);
        continue;
      }
      return { success: false, status: 0 };
    }
  }
  return { success: false, status: 0 };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Dispatch an alert event to all registered receivers.
 * @param {string} event - "alert.fired" or "alert.resolved"
 * @param {object} alert - The alert object
 */
async function dispatch(event, alert) {
  const promises = [];

  // ─── Webhooks ───
  const webhooks = store.getWebhooks();
  for (const wh of webhooks) {
    const key = deliveryKey(wh.url, alert.alert_id, event);
    if (delivered.has(key)) continue;

    const payload = {
      event,
      alert_id: alert.alert_id,
      status: alert.status,
      failure_rate: alert.failure_rate,
      total_proxies: alert.total_proxies,
      failed_proxies: alert.failed_proxies,
      failed_proxy_ids: alert.failed_proxy_ids,
      threshold: alert.threshold,
      fired_at: alert.fired_at,
      resolved_at: alert.resolved_at || null,
      message: alert.message,
    };

    promises.push(
      postWithRetry(wh.url, payload).then((result) => {
        if (result.success) {
          delivered.add(key);
          store.incrementWebhookDeliveries();
        }
      })
    );
  }

  // ─── Integrations (Slack / Discord) ───
  const integrations = store.getIntegrations();
  for (const intg of integrations) {
    if (!intg.events.includes(event)) continue;

    const key = deliveryKey(intg.webhook_url, alert.alert_id, event);
    if (delivered.has(key)) continue;

    let payload;
    if (intg.type === 'slack') {
      payload = buildSlackPayload(event, alert, intg);
    } else if (intg.type === 'discord') {
      payload = buildDiscordPayload(event, alert, intg);
    } else {
      continue;
    }

    promises.push(
      postWithRetry(intg.webhook_url, payload).then((result) => {
        if (result.success) {
          delivered.add(key);
          store.incrementWebhookDeliveries();
        }
      })
    );
  }

  // Fire-and-forget but within the 60s window
  await Promise.allSettled(promises);
}

// ─── Slack Payload ───────────────────────────────────────

function buildSlackPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  const color = isFired ? '#FF0000' : '#36a64f';
  return {
    username: intg.username || 'ProxyWatch',
    text: alert.message,
    attachments: [
      {
        color,
        fields: [
          { title: 'Status', value: alert.status, short: true },
          { title: 'Failure Rate', value: String(alert.failure_rate), short: true },
          { title: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`, short: true },
          { title: 'Failed IDs', value: alert.failed_proxy_ids.join(', '), short: false },
        ],
        footer: 'ProxyMaze Alert System',
        ts: toUnixSeconds(alert.fired_at),
      },
    ],
  };
}

// ─── Discord Payload ─────────────────────────────────────

function buildDiscordPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  const color = isFired ? 16711680 : 3066993; // red : green
  const title = isFired ? '🚨 Proxy Alert Fired' : '✅ Proxy Alert Resolved';

  return {
    username: intg.username || 'ProxyWatch',
    embeds: [
      {
        title,
        description: alert.message,
        color,
        fields: [
          { name: 'Status', value: alert.status, inline: true },
          { name: 'Failure Rate', value: String(alert.failure_rate), inline: true },
          { name: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`, inline: true },
          { name: 'Failed IDs', value: alert.failed_proxy_ids.join(', ') || 'None', inline: false },
        ],
        footer: {
          text: 'ProxyMaze Alert System',
        },
      },
    ],
  };
}

module.exports = { dispatch };
