/**
 * monitoringEngine.js
 *
 * Continuously probes proxy URLs on the configured cadence and:
 *   1. Updates each proxy's state in the store.
 *   2. Builds a failure snapshot.
 *   3. Passes the snapshot to the alert manager.
 *
 * The engine is hot-reload safe: changing check_interval_seconds via POST /config
 * restarts the timer immediately without restarting the process.
 */
 
const { checkProxy: defaultCheckProxy, PROXY_STATUS } = require('./proxyChecker.js');
const store        = require('../store/dataStore.js');
const alertManager = require('./alertManager.js');
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
 
const DEFAULT_CONFIG = Object.freeze({
  check_interval_seconds: 15,
  request_timeout_ms:     3000,
});
 
function normalizeConfig(config = {}) {
  const interval = Number(config.check_interval_seconds);
  const timeout  = Number(config.request_timeout_ms);
  return {
    check_interval_seconds: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_CONFIG.check_interval_seconds,
    request_timeout_ms:     Number.isFinite(timeout)  && timeout  > 0 ? timeout  : DEFAULT_CONFIG.request_timeout_ms,
  };
}
 
async function getConfig(storeRef) {
  const config = typeof storeRef.getConfig === 'function' ? storeRef.getConfig() : {};
  return normalizeConfig(config);
}
 
async function getProxyList(storeRef) {
  const fn      = storeRef.getAllProxies || storeRef.listProxies || storeRef.getProxies;
  const proxies = typeof fn === 'function' ? fn.call(storeRef) : [];
  if (proxies instanceof Map) return Array.from(proxies.values());
  return Array.isArray(proxies) ? proxies : [];
}
 
function buildHistoryEntry(result) {
  const entry = { checked_at: result.checked_at, status: result.status };
  if (Number.isFinite(result.response_time_ms)) entry.response_time_ms = result.response_time_ms;
  return entry;
}
 
function buildProxyUpdate(proxy, result) {
  const wasUp           = result.status === "up";
  const prevTotal       = Number(proxy.total_checks)         || 0;
  const prevUp          = Number(proxy.up_checks)            || 0;
  const prevConsec      = Number(proxy.consecutive_failures) || 0;
 
  return {
    status:               result.status,
    last_checked_at:      result.checked_at,
    consecutive_failures: wasUp ? 0 : prevConsec + 1,
    total_checks:         prevTotal + 1,
    up_checks:            prevUp + (wasUp ? 1 : 0),
    historyEntry:         buildHistoryEntry(result),
  };
}
 
async function recordCheck(storeRef, proxy, result) {
  const update = buildProxyUpdate(proxy, result);
 
  if (typeof storeRef.recordProxyCheck === 'function') {
    storeRef.recordProxyCheck(proxy.id, update);
  } else {
    // Fallback: mutate in place (for test stores that don't have recordProxyCheck)
    proxy.status               = update.status;
    proxy.last_checked_at      = update.last_checked_at;
    proxy.consecutive_failures = update.consecutive_failures;
    proxy.total_checks         = update.total_checks;
    proxy.up_checks            = update.up_checks;
    if (!Array.isArray(proxy.history)) proxy.history = [];
    proxy.history.push(update.historyEntry);
 
    // Try to increment global counter
    if (typeof storeRef.incrementTotalChecks === 'function') {
      storeRef.incrementTotalChecks(1);
    }
  }
}
 
function buildSnapshot(proxies) {
  const total_proxies    = proxies.length;
  const failed_proxy_ids = proxies.filter((p) => p.status === PROXY_STATUS.DOWN).map((p) => p.id);
  const failed_proxies   = failed_proxy_ids.length;
  const failure_rate     = total_proxies === 0 ? 0 : failed_proxies / total_proxies;
 
  return { failure_rate, total_proxies, failed_proxies, failed_proxy_ids };
}
 
async function sendSnapshot(alertMgr, snapshot) {
  const fn =
    alertMgr?.handleMonitoringSnapshot ||
    alertMgr?.evaluateMonitoringSnapshot ||
    alertMgr?.evaluatePoolHealth ||
    alertMgr?.evaluate;
 
  if (typeof fn === 'function') {
    await fn.call(alertMgr, snapshot);
  }
}
 
// ─── MonitoringEngine class ───────────────────────────────────────────────────
 
class MonitoringEngine {
  constructor({
    store:          storeRef,
    alertManager:   alertMgr,
    checkProxy:     checkProxyFn = defaultCheckProxy,
    setIntervalFn:  setInt       = setInterval,
    clearIntervalFn: clearInt    = clearInterval,
    now:            nowFn        = () => new Date(),
  } = {}) {
    if (!storeRef) throw new TypeError('MonitoringEngine requires a store');
 
    this.store          = storeRef;
    this.alertManager   = alertMgr;
    this.checkProxy     = checkProxyFn;
    this.setIntervalFn  = setInt;
    this.clearIntervalFn = clearInt;
    this.now            = nowFn;
    this.timer          = null;
    this.cycleInProgress = false;
  }
 
  get isRunning() { return this.timer !== null; }
 
  async start({ runImmediately = true } = {}) {
    if (this.isRunning) return;
 
    const config     = await getConfig(this.store);
    const intervalMs = config.check_interval_seconds * 1000;
 
    this.timer = this.setIntervalFn(() => { void this.runCycle(); }, intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
 
    if (runImmediately) await this.runCycle();
  }
 
  stop() {
    if (!this.isRunning) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }
 
  async restart({ runImmediately = false } = {}) {
    this.stop();
    await this.start({ runImmediately });
  }
 
  async onConfigUpdated() {
    if (this.isRunning) await this.restart({ runImmediately: false });
  }
 
  async onPoolChanged() {
    const proxies = await getProxyList(this.store);
    if (proxies.length === 0) { this.stop(); return; }
    if (!this.isRunning) await this.start({ runImmediately: true });
  }
 
  async runCycle() {
    if (this.cycleInProgress) return null;
    this.cycleInProgress = true;
 
    try {
      const config  = await getConfig(this.store);
      const proxies = await getProxyList(this.store);
 
      if (proxies.length === 0) {
        const snapshot = buildSnapshot([]);
        await sendSnapshot(this.alertManager, snapshot);
        return snapshot;
      }
 
      // Probe all proxies concurrently
      await Promise.allSettled(
        proxies.map(async (proxy) => {
          let result;
          try {
            result = await this.checkProxy(proxy.url, {
              request_timeout_ms: config.request_timeout_ms,
              now: this.now,
            });
          } catch (err) {
            result = {
              status:           "down",
              checked_at:       this.now().toISOString(),
              response_time_ms: config.request_timeout_ms,
              error:            err?.message || 'probe_failure',
            };
          }
          await recordCheck(this.store, proxy, result);
        }),
      );
 
      // Re-read proxies from store so snapshot reflects all updates
      const updatedProxies = await getProxyList(this.store);
      const snapshot       = buildSnapshot(updatedProxies);
 
      // Pass snapshot to alert manager — this is the authoritative failure rate
      await sendSnapshot(this.alertManager, snapshot);
 
      return snapshot;
    } finally {
      this.cycleInProgress = false;
    }
  }
}
 
// ─── Default singleton (used by routes) ──────────────────────────────────────
 
const defaultMonitor = new MonitoringEngine({ store, alertManager });
 
module.exports = {
  start:    (opts) => defaultMonitor.start(opts),
  stop:     ()     => defaultMonitor.stop(),
  restart:  (opts) => defaultMonitor.restart(opts),
  getStatus: ()    => defaultMonitor.isRunning,
  runCycle: ()     => defaultMonitor.runCycle(),
 
  // Exported for test injection
  MonitoringEngine,
  createMonitoringEngine: (opts) => new MonitoringEngine(opts),
};