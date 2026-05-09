/**
 * notificationEngine.js
 *
 * Retry policy (per spec §7.0.4):
 *   - Retry ONLY on HTTP 500, 502, 503, 504.
 *   - Network errors (ENOTFOUND, ECONNREFUSED, etc.) → fail fast, do NOT retry.
 *   - 2xx → success.  4xx → non-retryable.
 *
 * Exactly-once: key is marked delivered before async call to prevent concurrent duplicates.
 */
 
const axios = require('axios');
const store = require('../store/dataStore');
const { toUnixSeconds } = require('../utils/timestamps');
 
const delivered = new Set();
 
function deliveryKey(url, alertId, event) {
  return `${url}|${alertId}|${event}`;
}
 
async function postWithRetry(url, payload, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res;
    try {
      res = await axios.post(url, payload, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });
    } catch (err) {
      // Network-level failure (DNS, refused, etc.) — NOT a transient 5xx, do not retry.
      console.warn(`[Notify] Network error to ${url}: ${err.message} — not retrying`);
      return { success: false, status: 0, networkError: true };
    }
 
    if (res.status >= 200 && res.status < 300) {
      return { success: true, status: res.status };
    }
 
    if ([500, 502, 503, 504].includes(res.status)) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 16000);
      console.warn(`[Notify] ${url} returned ${res.status}, retry ${attempt + 1}/${maxAttempts} in ${delay}ms`);
      await sleep(delay);
      continue;
    }
 
    console.warn(`[Notify] ${url} returned non-retryable ${res.status}`);
    return { success: false, status: res.status };
  }
 
  console.error(`[Notify] ${url} exhausted ${maxAttempts} retries`);
  return { success: false, status: 0 };
}
 
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
 
function buildFiredPayload(alert) {
  return {
    event:            'alert.fired',
    alert_id:         alert.alert_id,
    fired_at:         alert.fired_at,
    failure_rate:     alert.failure_rate,
    total_proxies:    alert.total_proxies,
    failed_proxies:   alert.failed_proxies,
    failed_proxy_ids: alert.failed_proxy_ids,
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
 
async function dispatch(event, alert) {
  const promises = [];
 
  // Standard webhooks
  for (const wh of store.getWebhooks()) {
    const key = deliveryKey(wh.url, alert.alert_id, event);
    if (delivered.has(key)) { console.log(`[Notify] Skip dup: ${key}`); continue; }
    delivered.add(key);
 
    const payload = event === 'alert.fired' ? buildFiredPayload(alert) : buildResolvedPayload(alert);
 
    promises.push(
      postWithRetry(wh.url, payload).then((result) => {
        if (result.success) {
          store.incrementWebhookDeliveries();
          console.log(`[Notify] ✓ ${event} → ${wh.url}`);
        } else {
          delivered.delete(key);
          if (!result.networkError) console.error(`[Notify] ✗ ${event} → ${wh.url} (${result.status})`);
        }
      })
    );
  }
 
  // Slack / Discord integrations
  for (const intg of store.getIntegrations()) {
    if (!intg.events.includes(event)) continue;
 
    const key = deliveryKey(intg.webhook_url, alert.alert_id, event);
    if (delivered.has(key)) { console.log(`[Notify] Skip dup intg: ${key}`); continue; }
    delivered.add(key);
 
    const payload = intg.type === 'slack'
      ? buildSlackPayload(event, alert, intg)
      : intg.type === 'discord'
        ? buildDiscordPayload(event, alert, intg)
        : null;
 
    if (!payload) { delivered.delete(key); continue; }
 
    promises.push(
      postWithRetry(intg.webhook_url, payload).then((result) => {
        if (result.success) {
          store.incrementWebhookDeliveries();
          console.log(`[Notify] ✓ ${intg.type} ${event} → ${intg.webhook_url}`);
        } else {
          delivered.delete(key);
          if (!result.networkError) console.error(`[Notify] ✗ ${intg.type} ${event} → ${intg.webhook_url}`);
        }
      })
    );
  }
 
  await Promise.allSettled(promises);
}
 
// Slack payload — required titles: Alert ID, Failure Rate, Failed Proxies, Threshold, Failed IDs, Fired At
function buildSlackPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  return {
    username: intg.username || 'ProxyWatch',
    text: isFired
      ? `🚨 Proxy pool alert fired — failure rate ${alert.failure_rate} exceeds threshold ${alert.threshold}`
      : `✅ Proxy pool alert resolved — ${alert.alert_id}`,
    attachments: [{
      color:  isFired ? '#FF0000' : '#36a64f',
      fields: [
        { title: 'Alert ID',       value: String(alert.alert_id),                              short: true  },
        { title: 'Failure Rate',   value: String(alert.failure_rate),                          short: true  },
        { title: 'Failed Proxies', value: `${alert.failed_proxies} / ${alert.total_proxies}`,  short: true  },
        { title: 'Threshold',      value: String(alert.threshold),                             short: true  },
        { title: 'Fired At',       value: String(alert.fired_at ?? ''),                        short: true  },
        { title: 'Failed IDs',     value: (alert.failed_proxy_ids ?? []).join(', ') || 'None', short: false },
      ],
      footer: 'ProxyMaze Alert System',
      ts: toUnixSeconds(alert.fired_at),
    }],
  };
}
 
// Discord payload — required names: Alert ID, Failure Rate, Failed Proxies, Threshold, Failed IDs
function buildDiscordPayload(event, alert, intg) {
  const isFired = event === 'alert.fired';
  return {
    username: intg.username || 'ProxyWatch',
    embeds: [{
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
        { name: 'Failed IDs',     value: (alert.failed_proxy_ids ?? []).join(', ') || 'None', inline: false },
      ],
      footer: { text: 'ProxyMaze Alert System' },
    }],
  };
}
 
function reset() { delivered.clear(); }
 
module.exports = { dispatch, reset };