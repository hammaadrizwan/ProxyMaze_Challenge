import { checkProxy as defaultCheckProxy, PROXY_STATUS } from "./proxyChecker.js";

const DEFAULT_CONFIG = Object.freeze({
  check_interval_seconds: 15,
  request_timeout_ms: 3000,
});

function normalizeConfig(config = {}) {
  const checkInterval = Number(config.check_interval_seconds);
  const timeout = Number(config.request_timeout_ms);

  return {
    check_interval_seconds:
      Number.isFinite(checkInterval) && checkInterval > 0
        ? checkInterval
        : DEFAULT_CONFIG.check_interval_seconds,
    request_timeout_ms:
      Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_CONFIG.request_timeout_ms,
  };
}

async function maybeCall(target, names, ...args) {
  for (const name of names) {
    if (typeof target?.[name] === "function") {
      return target[name](...args);
    }
  }
  return undefined;
}

async function getConfig(store) {
  const config = await maybeCall(store, ["getConfig", "readConfig"]);
  return normalizeConfig(config);
}

async function getProxyList(store) {
  const proxies = await maybeCall(store, [
    "getAllProxies",
    "listProxies",
    "getProxies",
  ]);

  if (!proxies) {
    return [];
  }
  if (proxies instanceof Map) {
    return Array.from(proxies.values());
  }
  return Array.isArray(proxies) ? proxies : [];
}

function buildHistoryEntry(result) {
  const entry = {
    checked_at: result.checked_at,
    status: result.status,
  };

  if (Number.isFinite(result.response_time_ms)) {
    entry.response_time_ms = result.response_time_ms;
  }

  return entry;
}

function buildProxyUpdate(proxy, result) {
  const previousTotalChecks = Number(proxy.total_checks) || 0;
  const previousUpChecks = Number(proxy.up_checks) || 0;
  const wasUp = result.status === PROXY_STATUS.UP;

  return {
    status: result.status,
    last_checked_at: result.checked_at,
    consecutive_failures: wasUp
      ? 0
      : (Number(proxy.consecutive_failures) || 0) + 1,
    total_checks: previousTotalChecks + 1,
    up_checks: previousUpChecks + (wasUp ? 1 : 0),
    historyEntry: buildHistoryEntry(result),
  };
}

function mutateProxy(proxy, update) {
  proxy.status = update.status;
  proxy.last_checked_at = update.last_checked_at;
  proxy.consecutive_failures = update.consecutive_failures;
  proxy.total_checks = update.total_checks;
  proxy.up_checks = update.up_checks;

  if (!Array.isArray(proxy.history)) {
    proxy.history = [];
  }
  proxy.history.push(update.historyEntry);
}

async function recordProxyCheck(store, proxy, result) {
  const update = buildProxyUpdate(proxy, result);
  const recorder = store?.recordProxyCheck || store?.updateProxyAfterCheck;

  if (typeof recorder === "function") {
    await recorder.call(store, proxy.id, update);
  } else {
    mutateProxy(proxy, update);
  }

  await maybeCall(store, ["incrementTotalChecks", "incrementCheckCount"], 1);
  return update;
}

function buildFailureSnapshot(proxies) {
  const total_proxies = proxies.length;
  const failed_proxy_ids = proxies
    .filter((proxy) => proxy.status === PROXY_STATUS.DOWN)
    .map((proxy) => proxy.id);
  const failed_proxies = failed_proxy_ids.length;

  return {
    failure_rate: total_proxies === 0 ? 0 : failed_proxies / total_proxies,
    total_proxies,
    failed_proxies,
    failed_proxy_ids,
  };
}

async function sendAlertSnapshot(alertManager, snapshot) {
  await maybeCall(
    alertManager,
    [
      "handleMonitoringSnapshot",
      "evaluateMonitoringSnapshot",
      "evaluatePoolHealth",
      "evaluate",
    ],
    snapshot,
  );
}

function probeFailureResult(error, now) {
  return {
    status: PROXY_STATUS.DOWN,
    checked_at: now().toISOString(),
    response_time_ms: 0,
    error: error?.message || "probe_failure",
  };
}

export class MonitoringEngine {
  constructor({
    store,
    alertManager,
    checkProxy = defaultCheckProxy,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    now = () => new Date(),
  } = {}) {
    if (!store) {
      throw new TypeError("MonitoringEngine requires a store");
    }

    this.store = store;
    this.alertManager = alertManager;
    this.checkProxy = checkProxy;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.now = now;
    this.timer = null;
    this.cycleInProgress = false;
  }

  get isRunning() {
    return this.timer !== null;
  }

  async start({ runImmediately = true } = {}) {
    if (this.isRunning) {
      return;
    }

    const config = await getConfig(this.store);
    const intervalMs = config.check_interval_seconds * 1000;

    this.timer = this.setIntervalFn(() => {
      void this.runCycle();
    }, intervalMs);

    if (typeof this.timer?.unref === "function") {
      this.timer.unref();
    }

    if (runImmediately) {
      await this.runCycle();
    }
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  async restart({ runImmediately = false } = {}) {
    this.stop();
    await this.start({ runImmediately });
  }

  async onConfigUpdated() {
    if (this.isRunning) {
      await this.restart({ runImmediately: false });
    }
  }

  async onPoolChanged() {
    const proxies = await getProxyList(this.store);
    if (proxies.length === 0) {
      this.stop();
      return;
    }

    if (!this.isRunning) {
      await this.start({ runImmediately: true });
    }
  }

  async runCycle() {
    if (this.cycleInProgress) {
      return null;
    }

    this.cycleInProgress = true;

    try {
      const config = await getConfig(this.store);
      const proxies = await getProxyList(this.store);

      if (proxies.length === 0) {
        const snapshot = buildFailureSnapshot([]);
        await sendAlertSnapshot(this.alertManager, snapshot);
        return snapshot;
      }

      await Promise.allSettled(
        proxies.map(async (proxy) => {
          let result;
          try {
            result = await this.checkProxy(proxy.url, {
              request_timeout_ms: config.request_timeout_ms,
              now: this.now,
            });
          } catch (error) {
            result = probeFailureResult(error, this.now);
          }

          await recordProxyCheck(this.store, proxy, result);
        }),
      );

      const updatedProxies = await getProxyList(this.store);
      const snapshot = buildFailureSnapshot(updatedProxies);
      await sendAlertSnapshot(this.alertManager, snapshot);
      return snapshot;
    } finally {
      this.cycleInProgress = false;
    }
  }
}

export function createMonitoringEngine(options) {
  return new MonitoringEngine(options);
}

export default MonitoringEngine;
