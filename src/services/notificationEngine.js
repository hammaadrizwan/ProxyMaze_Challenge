/**
 * notificationEngine.js
 *
 * Per docs/API.md and docs/ARCHITECTURE.md:
 *   - Deliver each alert event to every registered receiver within 60s of the transition.
 *   - Retry transient 5xx (500, 502, 503, 504) until success or deadline.
 *   - Exactly one successful delivery per (receiver, alert_id, event).
 *
 * Parallel dispatch() calls for the same dedupe key share one in-flight attempt so the
 * capture server never sees duplicate POSTs for the same transition.
 */

const axios = require('axios');
const store = require('../store/dataStore');
const { toUnixSeconds } = require('../utils/timestamps');

/** Wall-clock budget per receiver (ms), under the 60s requirement */
const WEBHOOK_DELIVERY_DEADLINE_MS = 58_000;

// Tracks confirmed successful deliveries: "url|alertId|event"
const delivered = new Set();
/** Coalesce concurrent deliverUntilSuccess for the same key */
const inflightDeliveries = new Map();

function deliveryKey(url, alertId, event) {
  return `${url}|${alertId}|${event}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postOnce(url, payload) {
  try {
    const res = await axios.post(url, payload, {
      timeout: 12_000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      validateStatus: () => true,
      maxRedirects: 5,
    });
    return { networkError: false, res };
  } catch (err) {
    return { networkError: true, err };
  }
}

/**
 * POST until 2xx, or retries exhausted by deadline.
 * Adds `dedupeKey` to `delivered` only after a confirmed 2xx.
 */
async function deliverUntilSuccess(url, dedupeKey, payload, onDelivered) {
  if (delivered.has(dedupeKey)) return;

  const existing = inflightDeliveries.get(dedupeKey);
  if (existing) return existing;

  const promise = (async () => {
    const deadline = Date.now() + WEBHOOK_DELIVERY_DEADLINE_MS;
    let attempt = 0;
    let networkFailures = 0;

    while (Date.now() < deadline && !delivered.has(dedupeKey)) {
      const { networkError, res } = await postOnce(url, payload);

      if (networkError) {
        networkFailures++;
        // Keep retrying within deadline; transient DNS/connect issues to the capture server are common in CI
        if (networkFailures > 200) {
          console.warn(`[Notify] giving up on network errors for ${url}`);
          return;
        }
        await sleep(Math.min(100 + attempt * 50, 2000));
        attempt++;
        continue;
      }

      if (res.status >= 200 && res.status < 300) {
        delivered.add(dedupeKey);
        onDelivered();
        console.log(`[Notify] ✓ → ${url}`);
        return;
      }

      if ([500, 502, 503, 504].includes(res.status)) {
        const delay = Math.min(100 * Math.pow(2, Math.min(attempt, 12)), 8000);
        console.warn(`[Notify] ${url} returned ${res.status}, retry (${delay}ms)`);
        await sleep(delay);
        attempt++;
        continue;
      }

      console.warn(`[Notify] ${url} returned non-retryable ${res.status}`);
      return;
    }

    if (!delivered.has(dedupeKey)) {
      console.error(`[Notify] ✗ delivery deadline exceeded for ${url}`);
    }
  })();

  inflightDeliveries.set(dedupeKey, promise);
  promise.finally(() => inflightDeliveries.delete(dedupeKey));
  return promise;
}

function buildFiredPayload(alert) {
  return {
    event:            'alert.fired',
    alert_id:         alert.alert_id,
    fired_at:         alert.fired_at,
    failure_rate:     alert.failure_rate,
    total_proxies:    alert.total_proxies,
    failed_proxies:   alert.failed_proxies,
    failed_proxy_ids: [...(alert.failed_proxy_ids ?? [])],
    threshold:        alert.threshold,
    message:          alert.message,
  };
}

function buildResolvedPayload(alert) {
  return {
    event:       'alert.resolved',
    alert_id:    alert.alert_id,
    resolved_at: alert.resolved_at,
  };
}

async function deliverToReceiver(url, alertId, event, payload) {
  const key = deliveryKey(url, alertId, event);

  await deliverUntilSuccess(url, key, payload, () => {
    store.incrementWebhookDeliveries();
  });
}

function dispatch(event, alert) {
  for (const wh of store.getWebhooks()) {
    const payload = event === 'alert.fired'
      ? buildFiredPayload(alert)
      : buildResolvedPayload(alert);

    void deliverToReceiver(wh.url, alert.alert_id, event, payload).catch((e) =>
      console.error('[Notify] webhook receiver:', e));
  }

  for (const intg of store.getIntegrations()) {
    if (!intg.events.includes(event)) continue;

    const payload = intg.type === 'slack'
      ? buildSlackPayload(event, alert, intg)
      : intg.type === 'discord'
        ? buildDiscordPayload(event, alert, intg)
        : null;

    if (!payload) continue;

    const key = deliveryKey('intg:' + intg.webhook_url, alert.alert_id, event);

    void deliverUntilSuccess(intg.webhook_url, key, payload, () => {
      store.incrementWebhookDeliveries();
      console.log(`[Notify] ✓ ${intg.type} ${event} → ${intg.webhook_url}`);
    }).catch((e) => console.error('[Notify] integration:', e));
  }
}

/** Slack: legacy attachments + Block Kit `blocks` (bonus B1 / strict validators) */
function buildSlackPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  const failedIds = (alert.failed_proxy_ids ?? []).join(', ') || 'None';

  const attachments = [{
    color:  isFired ? '#FF0000' : '#36a64f',
    fields: [
      { title: 'Alert ID',       value: String(alert.alert_id),                              short: true  },
      { title: 'Failure Rate',   value: String(alert.failure_rate),                          short: true  },
      { title: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`,  short: true  },
      { title: 'Threshold',      value: String(alert.threshold),                             short: true  },
      { title: 'Fired At',       value: String(alert.fired_at ?? ''),                        short: true  },
      { title: 'Failed IDs',     value: failedIds,                                           short: false },
    ],
    footer: 'ProxyMaze Alert System',
    ts: toUnixSeconds(alert.fired_at),
  }];

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: isFired
          ? '🚨 *Proxy pool alert fired* — failure rate exceeded threshold.'
          : `✅ *Proxy pool alert resolved* — \`${alert.alert_id}\``,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Alert ID*\n${alert.alert_id}` },
        { type: 'mrkdwn', text: `*Failure Rate*\n${alert.failure_rate}` },
        { type: 'mrkdwn', text: `*Failed Proxies*\n${alert.failed_proxies} / ${alert.total_proxies}` },
        { type: 'mrkdwn', text: `*Threshold*\n${alert.threshold}` },
        { type: 'mrkdwn', text: `*Failed IDs*\n${failedIds}` },
        { type: 'mrkdwn', text: `*Fired At*\n${alert.fired_at ?? '—'}` },
      ],
    },
  ];

  return {
    username: intg.username || 'ProxyWatch',
    text: isFired
      ? `Proxy pool alert fired — failure rate ${alert.failure_rate} exceeds threshold ${alert.threshold}`
      : `Proxy pool alert resolved — ${alert.alert_id}`,
    attachments,
    blocks,
  };
}

/** Discord embed payload (bonus B2) */
function buildDiscordPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  const failedIds = (alert.failed_proxy_ids ?? []).join(', ') || 'None';

  return {
    username: intg.username || 'ProxyWatch',
    embeds: [{
      type:       'rich',
      title:       isFired ? '🚨 Proxy Alert Fired' : '✅ Proxy Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate ${alert.failure_rate} has exceeded the threshold of ${alert.threshold}.`
        : `Alert ${alert.alert_id} has been resolved. Failure rate recovered below ${alert.threshold}.`,
      color:  isFired ? 16711680 : 3066993,
      fields: [
        { name: 'Alert ID',       value: String(alert.alert_id),                              inline: true  },
        { name: 'Failure Rate',   value: String(alert.failure_rate),                          inline: true  },
        { name: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`,  inline: true  },
        { name: 'Threshold',      value: String(alert.threshold),                             inline: true  },
        { name: 'Failed IDs',     value: failedIds,                                           inline: false },
      ],
      footer: { text: 'ProxyMaze Alert System' },
    }],
  };
}

function reset() {
  delivered.clear();
  inflightDeliveries.clear();
}

module.exports = { dispatch, reset };
