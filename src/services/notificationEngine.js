/**
 * notificationEngine.js
 *
 * Per docs/API.md and docs/ARCHITECTURE.md:
 *   - Deliver each alert event to every registered receiver within 60s of the transition.
 *   - Retry transient 5xx (500, 502, 503, 504) until success or deadline.
 *   - Follow 301/302/307/308 manually with POST preserved (avoid POST→GET on redirect).
 *   - Exactly one successful delivery per (receiver, alert_id, event).
 *
 * Parallel dispatch() calls for the same dedupe key share one in-flight attempt so the
 * capture server never sees duplicate POSTs for the same transition.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const store = require('../store/dataStore');
const { toUnixSeconds } = require('../utils/timestamps');

/** Wall-clock budget per receiver (ms), under the 60s requirement */
const WEBHOOK_DELIVERY_DEADLINE_MS = 58_000;

/** Per-hop socket timeout for outbound POST (ms) */
const OUTBOUND_POST_TIMEOUT_MS = 5000;

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
const RETRY_5XX = new Set([500, 502, 503, 504]);
const MAX_REDIRECT_HOPS = 20;

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

/**
 * Single POST; no automatic redirect follow (caller handles 301/302/307/308).
 */
async function postOnce(targetUrl, payload) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const data = JSON.stringify(payload);
      const port =
        parsedUrl.port ||
        (parsedUrl.protocol === 'https:' ? 443 : 80);

      const options = {
        method: 'POST',
        hostname: parsedUrl.hostname,
        port,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Accept: 'application/json',
        },
        timeout: OUTBOUND_POST_TIMEOUT_MS,
      };

      const lib = parsedUrl.protocol === 'https:' ? https : http;

      const req = lib.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => (body += chunk));

        res.on('end', () => {
          resolve({
            networkError: false,
            res: {
              status: res.statusCode,
              body,
              headers: res.headers,
            },
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ networkError: true, err: new Error('TIMEOUT') });
      });

      req.on('error', (err) => {
        resolve({ networkError: true, err });
      });

      req.write(data);
      req.end();
    } catch (err) {
      resolve({ networkError: true, err });
    }
  });
}

/**
 * POST until 2xx, or retries exhausted by deadline.
 * Follows redirects with POST body preserved; retries 5xx with 1s delay.
 * Adds `dedupeKey` to `delivered` only after a confirmed 2xx.
 */
async function deliverUntilSuccess(initialUrl, dedupeKey, payload, onDelivered) {
  if (delivered.has(dedupeKey)) return;

  const existing = inflightDeliveries.get(dedupeKey);
  if (existing) return existing;

  const promise = (async () => {
    const deadline = Date.now() + WEBHOOK_DELIVERY_DEADLINE_MS;
    let currentUrl = initialUrl;
    let redirectHops = 0;

    while (Date.now() < deadline && !delivered.has(dedupeKey)) {
      const { networkError, res } = await postOnce(currentUrl, payload);

      if (networkError) {
        await sleep(1000);
        continue;
      }

      if (res.status >= 200 && res.status < 300) {
        delivered.add(dedupeKey);
        onDelivered();
        console.log(`[Notify] ✓ → ${currentUrl}`);
        return;
      }

      const location = res.headers && res.headers.location;
      if (location && REDIRECT_STATUSES.has(res.status)) {
        redirectHops += 1;
        if (redirectHops > MAX_REDIRECT_HOPS) {
          console.warn(`[Notify] redirect limit exceeded for ${initialUrl}`);
          return;
        }
        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch (e) {
          console.warn(`[Notify] bad Location header: ${location}`);
          return;
        }
        continue;
      }

      if (RETRY_5XX.has(res.status)) {
        console.warn(`[Notify] ${currentUrl} returned ${res.status}, retry (1s)`);
        await sleep(1000);
        continue;
      }

      console.warn(`[Notify] ${currentUrl} returned non-retryable ${res.status}`);
      return;
    }

    if (!delivered.has(dedupeKey)) {
      console.error(`[Notify] ✗ delivery deadline exceeded for ${initialUrl}`);
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

/**
 * When POST /integrations runs while an alert is already active, deliver alert.fired once
 * to the new receiver (same dedupe rules as dispatch).
 */
function dispatchFiredToNewIntegration(intg) {
  const active = store.getActiveAlert();
  if (!active) return;

  const events = intg.events || ['alert.fired', 'alert.resolved'];
  if (!events.includes('alert.fired')) return;

  if (intg.type === 'slack') {
    const payload = buildSlackPayload('alert.fired', active, intg);
    const key = deliveryKey('intg:' + intg.webhook_url, active.alert_id, 'alert.fired');
    void deliverUntilSuccess(intg.webhook_url, key, payload, () => {
      store.incrementWebhookDeliveries();
    }).catch((e) => console.error('[Notify] integration:', e));
  } else if (intg.type === 'discord') {
    const payload = buildDiscordPayload('alert.fired', active, intg);
    const key = deliveryKey('intg:' + intg.webhook_url, active.alert_id, 'alert.fired');
    void deliverUntilSuccess(intg.webhook_url, key, payload, () => {
      store.incrementWebhookDeliveries();
    }).catch((e) => console.error('[Notify] integration:', e));
  }
}

/** Slack: legacy attachments + Block Kit `blocks` (bonus B1) */
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
      type: 'header',
      text: {
        type: 'plain_text',
        text: isFired ? 'Proxy pool alert fired' : 'Proxy pool alert resolved',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: isFired
          ? '*Failure rate exceeded threshold.*'
          : `*Alert resolved:* \`${alert.alert_id}\``,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Alert ID*\n${alert.alert_id}` },
        { type: 'mrkdwn', text: `*Failure rate*\n${alert.failure_rate}` },
        { type: 'mrkdwn', text: `*Failed proxies*\n${alert.failed_proxies} / ${alert.total_proxies}` },
        { type: 'mrkdwn', text: `*Threshold*\n${alert.threshold}` },
        { type: 'mrkdwn', text: `*Failed IDs*\n${failedIds}` },
        { type: 'mrkdwn', text: `*Fired at*\n${alert.fired_at ?? '—'}` },
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
      type:        'rich',
      title:       isFired ? 'Proxy Alert Fired' : 'Proxy Alert Resolved',
      description: isFired
        ? `Proxy pool failure rate ${alert.failure_rate} has exceeded the threshold of ${alert.threshold}.`
        : `Alert ${alert.alert_id} has been resolved. Failure rate recovered below ${alert.threshold}.`,
      color:  isFired ? 16711680 : 3066993,
      fields: [
        { name: 'Alert ID',       value: String(alert.alert_id),                              inline: true  },
        { name: 'Failure Rate',   value: String(alert.failure_rate),                          inline: true  },
        { name: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`,  inline: true  },
        { name: 'Threshold',      value: String(alert.threshold),                             inline: true  },
        { name: 'Failed IDs',     value: failedIds.length > 1024 ? failedIds.slice(0, 1021) + '…' : failedIds, inline: false },
      ],
      footer: { text: 'ProxyMaze Alert System' },
    }],
  };
}

function reset() {
  delivered.clear();
  inflightDeliveries.clear();
}

module.exports = {
  dispatch,
  dispatchFiredToNewIntegration,
  reset,
  /** Exposed for tests — POST with redirect/5xx retry semantics */
  deliverUntilSuccess,
};
