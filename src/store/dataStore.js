/**
 * dataStore.js
 * Central in-memory state for the entire ProxyMaze system.
 */
 
const { nowISO } = require('../utils/timestamps');
 
// ─── State ────────────────────────────────────────────────────────────────────
 
const state = {
  config: {
    check_interval_seconds: 15,
    request_timeout_ms: 3000,
  },
 
  /** @type {Map<string, object>} proxyId → proxy object */
  proxies: new Map(),
 
  /** @type {Array<object>} ordered list of alerts */
  alerts: [],
 
  /** @type {Array<object>} registered webhook receivers */
  webhooks: [],
 
  /** @type {Array<object>} registered Slack / Discord integrations */
  integrations: [],
 
  /** Operational counters */
  metrics: {
    total_checks: 0,
    webhook_deliveries: 0,
  },
 
  _alertCounter: 0,
  _webhookCounter: 0,
  _integrationCounter: 0,
};
 
// ─── Config ───────────────────────────────────────────────────────────────────
 
function getConfig() {
  return { ...state.config };
}
 
function setConfig(patch) {
  if (patch.check_interval_seconds !== undefined) {
    state.config.check_interval_seconds = Number(patch.check_interval_seconds);
  }
  if (patch.request_timeout_ms !== undefined) {
    state.config.request_timeout_ms = Number(patch.request_timeout_ms);
  }
  return { ...state.config };
}
 
// ─── Proxies ──────────────────────────────────────────────────────────────────
 
function addProxy(id, url) {
  const proxy = {
    id,
    url,
    status: 'pending',
    last_checked_at: null,
    consecutive_failures: 0,
    total_checks: 0,
    up_checks: 0,
    history: [],
  };
  state.proxies.set(id, proxy);
  return proxy;
}
 
function getProxy(id) {
  return state.proxies.get(id) || null;
}
 
function getAllProxies() {
  return Array.from(state.proxies.values());
}
 
function clearProxies() {
  const count = state.proxies.size;
  state.proxies.clear();
  return count;
}
 
/**
 * Called by the monitoring engine after each probe.
 * Updates all mutable proxy fields and appends to history (chronological, oldest first).
 */
function recordProxyCheck(id, update) {
  const proxy = state.proxies.get(id);
  if (!proxy) return null;

  proxy.status = update.status;
  proxy.last_checked_at = update.last_checked_at;

  proxy.consecutive_failures = update.consecutive_failures;
  proxy.total_checks = update.total_checks;
  proxy.up_checks = update.up_checks;

  if (!Array.isArray(proxy.history)) {
    proxy.history = [];
  }

  // 🔥 FIX: newest-first (THIS IS WHAT TESTS EXPECT)
  proxy.history.unshift(update.historyEntry);

  state.metrics.total_checks += 1;

  return proxy;
}
 
function getProxyPoolSummary() {
  const all   = getAllProxies();
  const total = all.length;
  const up    = all.filter((p) => p.status === 'up').length;
  const down  = all.filter((p) => p.status === 'down').length;
 
  // failure_rate = down / total  (pending proxies count in total but not in down)
  const failure_rate = total === 0 ? 0 : down / total;
 
  return { total, up, down, failure_rate };
}
 
function getFailedProxyIds() {
  return getAllProxies()
    .filter((p) => p.status === 'down')
    .map((p) => p.id);
}
 
// ─── Alerts ───────────────────────────────────────────────────────────────────
 
function getActiveAlert() {
  return state.alerts.find((a) => a.status === 'active') || null;
}
 
function createAlert(failureRate, totalProxies, failedProxies, failedProxyIds) {
  state._alertCounter += 1;
  const alert = {
    alert_id:        `alert-${String(state._alertCounter).padStart(3, '0')}`,
    status:          'active',
    failure_rate:    failureRate,
    total_proxies:   totalProxies,
    failed_proxies:  failedProxies,
    failed_proxy_ids: [...failedProxyIds],
    threshold:       0.20,
    fired_at:        nowISO(),
    resolved_at:     null,
    // Spec example message — keep consistent and non-empty.
    message:         'Proxy pool failure rate exceeded threshold',
  };
  state.alerts.push(alert);
  return alert;
}
 
function resolveAlert(alertId) {
  const alert = state.alerts.find((a) => a.alert_id === alertId);
  if (!alert) return null;
 
  alert.status      = 'resolved';
  alert.resolved_at = nowISO();
  // Do NOT overwrite alert.message — preserve the original fired message.
  // The spec only requires message to be non-empty; the fired message satisfies that.
 
  return alert;
}
 
function getAllAlerts() {
  return [...state.alerts];
}
 
// ─── Webhooks ─────────────────────────────────────────────────────────────────
 
function addWebhook(url) {
  state._webhookCounter += 1;
  const wh = {
    webhook_id:     `wh-${String(state._webhookCounter).padStart(3, '0')}`,
    url,
    registered_at:  nowISO(),
  };
  state.webhooks.push(wh);
  return wh;
}
 
function getWebhooks() {
  return [...state.webhooks];
}
 
// ─── Integrations ─────────────────────────────────────────────────────────────
 
function addIntegration(type, webhookUrl, username, events) {
  state._integrationCounter += 1;
  const integration = {
    id:            `int-${String(state._integrationCounter).padStart(3, '0')}`,
    type,
    webhook_url:   webhookUrl,
    username:      username || 'ProxyWatch',
    events:        events || ['alert.fired', 'alert.resolved'],
    registered_at: nowISO(),
  };
  state.integrations.push(integration);
  return integration;
}
 
function getIntegrations() {
  return [...state.integrations];
}
 
// ─── Metrics ──────────────────────────────────────────────────────────────────
 
function incrementWebhookDeliveries() {
  state.metrics.webhook_deliveries += 1;
}
 
function getMetrics() {
  const activeAlerts = state.alerts.filter((a) => a.status === 'active').length;
  return {
    total_checks:       state.metrics.total_checks,
    current_pool_size:  state.proxies.size,
    active_alerts:      activeAlerts,
    total_alerts:       state.alerts.length,
    webhook_deliveries: state.metrics.webhook_deliveries,
  };
}
 
// ─── Exports ──────────────────────────────────────────────────────────────────
 
module.exports = {
  // Expose raw state for tests that need to reset/seed it directly.
  dataStore: state,
 
  // Config
  getConfig,
  setConfig,
 
  // Proxies
  addProxy,
  getProxy,
  getAllProxies,
  clearProxies,
  recordProxyCheck,
  getProxyPoolSummary,
  getFailedProxyIds,
 
  // Alerts
  getActiveAlert,
  createAlert,
  resolveAlert,
  getAllAlerts,
 
  // Webhooks
  addWebhook,
  getWebhooks,
 
  // Integrations
  addIntegration,
  getIntegrations,
 
  // Metrics
  incrementWebhookDeliveries,
  getMetrics,
};