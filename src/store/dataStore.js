/**
 * dataStore.js
 * Central in-memory state for the entire ProxyMaze system.
 * All reads/writes go through exported helper functions to keep
 * mutation logic contained in one place.
 */

const { nowISO } = require('../utils/timestamps');


// State

const state = {
  config: {
    check_interval_seconds: 30,
    request_timeout_ms: 5000,
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

  /** Alert counter for sequential IDs */
  _alertCounter: 0,

  /** Webhook counter */
  _webhookCounter: 0,

  /** Integration counter */
  _integrationCounter: 0,
};

// Config

function getConfig() {
  return { ...state.config };
}

function setConfig(patch) {
  if (patch.check_interval_seconds !== undefined) {
    state.config.check_interval_seconds = patch.check_interval_seconds;
  }
  if (patch.request_timeout_ms !== undefined) {
    state.config.request_timeout_ms = patch.request_timeout_ms;
  }
  return { ...state.config };
}

// Proxies

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

function updateProxyAfterCheck(id, isUp, responseTimeMs) {
  const proxy = state.proxies.get(id);
  if (!proxy) return null;

  const checkedAt = nowISO();
  const status = isUp ? 'up' : 'down';

  proxy.status = status;
  proxy.last_checked_at = checkedAt;
  proxy.total_checks += 1;
  if (isUp) {
    proxy.up_checks += 1;
    proxy.consecutive_failures = 0;
  } else {
    proxy.consecutive_failures += 1;
  }

  proxy.history.unshift({
    checked_at: checkedAt,
    status,
    response_time_ms: responseTimeMs,
  });

  state.metrics.total_checks += 1;
  return proxy;
}

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
  // add to beginning of array for latest first like before
  proxy.history.unshift(update.historyEntry);

  state.metrics.total_checks += 1;
  return proxy;
}

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
  // add to beginning of array for latest first like before
  proxy.history.unshift(update.historyEntry);

  state.metrics.total_checks += 1;
  return proxy;
}

function getProxyPoolSummary() {
  const all = getAllProxies();
  const total = all.length;
  const up = all.filter((p) => p.status === 'up').length;
  const down = all.filter((p) => p.status === 'down').length;
  const failure_rate = total === 0 ? 0 : parseFloat((down / total).toFixed(10));

  return { total, up, down, failure_rate };
}

function getFailedProxyIds() {
  return getAllProxies()
    .filter((p) => p.status === 'down')
    .map((p) => p.id);
}

// Alerts

function getActiveAlert() {
  return state.alerts.find((a) => a.status === 'active') || null;
}

function createAlert(failureRate, totalProxies, failedProxies, failedProxyIds) {
  state._alertCounter += 1;
  const alert = {
    alert_id: `alert-${String(state._alertCounter).padStart(3, '0')}`,
    status: 'active',
    failure_rate: failureRate,
    total_proxies: totalProxies,
    failed_proxies: failedProxies,
    failed_proxy_ids: [...failedProxyIds],
    threshold: 0.20,
    fired_at: nowISO(),
    resolved_at: null,
    message: `ALERT: Proxy failure rate ${failureRate.toFixed(2)} exceeds threshold 0.20`,
  };
  state.alerts.push(alert);
  return alert;
}

function resolveAlert(alertId) {
  const alert = state.alerts.find((a) => a.alert_id === alertId);
  if (!alert) return null;
  alert.status = 'resolved';
  alert.resolved_at = nowISO();
  alert.message = 'Alert resolved: failure rate recovered to below threshold';
  return alert;
}

function getAllAlerts() {
  return [...state.alerts];
}

// Webhooks

function addWebhook(url) {
  state._webhookCounter += 1;
  const wh = {
    id: `wh-${String(state._webhookCounter).padStart(3, '0')}`,
    url,
    registered_at: nowISO(),
  };
  state.webhooks.push(wh);
  return wh;
}

function getWebhooks() {
  return [...state.webhooks];
}

// Integrations

function addIntegration(type, webhookUrl, username, events) {
  state._integrationCounter += 1;
  const integration = {
    id: `int-${String(state._integrationCounter).padStart(3, '0')}`,
    type,
    webhook_url: webhookUrl,
    username: username || 'ProxyWatch',
    events: events || ['alert.fired', 'alert.resolved'],
    registered_at: nowISO(),
  };
  state.integrations.push(integration);
  return integration;
}

function getIntegrations() {
  return [...state.integrations];
}

// Metrics

function incrementWebhookDeliveries() {
  state.metrics.webhook_deliveries += 1;
}

function getMetrics() {
  const activeAlerts = state.alerts.filter((a) => a.status === 'active').length;
  return {
    total_checks: state.metrics.total_checks,
    current_pool_size: state.proxies.size,
    active_alerts: activeAlerts,
    total_alerts: state.alerts.length,
    webhook_deliveries: state.metrics.webhook_deliveries,
  };
}

// Exports

module.exports = {
  // Expose state for tests
  dataStore: state,
  // Config
  getConfig,
  setConfig,
  // Proxies
  addProxy,
  getProxy,
  getAllProxies,
  clearProxies,
  updateProxyAfterCheck,
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
