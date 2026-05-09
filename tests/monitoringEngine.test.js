import assert from "node:assert/strict";
import { test } from "node:test";
import { createMonitoringEngine } from "../src/services/monitoringEngine.js";

function createStore({ config, proxies }) {
  return {
    config,
    proxies,
    totalChecks: 0,
    getConfig() {
      return this.config;
    },
    getAllProxies() {
      return this.proxies;
    },
    recordProxyCheck(id, update) {
      const proxy = this.proxies.find((item) => item.id === id);
      Object.assign(proxy, {
        status: update.status,
        last_checked_at: update.last_checked_at,
        consecutive_failures: update.consecutive_failures,
        total_checks: update.total_checks,
        up_checks: update.up_checks,
      });
      proxy.history.push(update.historyEntry);
    },
    incrementTotalChecks(amount) {
      this.totalChecks += amount;
    },
  };
}

function createAlertManager() {
  return {
    snapshots: [],
    handleMonitoringSnapshot(snapshot) {
      this.snapshots.push(snapshot);
    },
  };
}

test("updates proxy state, history, and alert snapshot after a cycle", async () => {
  const store = createStore({
    config: { check_interval_seconds: 15, request_timeout_ms: 3000 },
    proxies: [
      { id: "px-101", url: "https://example.test/up", status: "pending", history: [] },
      { id: "px-102", url: "https://example.test/down", status: "pending", history: [] },
      { id: "px-103", url: "https://example.test/up-again", status: "pending", history: [] },
    ],
  });
  const alertManager = createAlertManager();
  const engine = createMonitoringEngine({
    store,
    alertManager,
    now: () => new Date("2026-04-24T10:15:30Z"),
    checkProxy: async (url, options) => ({
      status: url.includes("/down") ? "down" : "up",
      checked_at: "2026-04-24T10:15:30Z",
      response_time_ms: options.request_timeout_ms,
    }),
  });

  const snapshot = await engine.runCycle();

  assert.equal(store.proxies[0].status, "up");
  assert.equal(store.proxies[1].status, "down");
  assert.equal(store.proxies[1].consecutive_failures, 1);
  assert.equal(store.proxies[1].total_checks, 1);
  assert.deepEqual(store.proxies[1].history[0], {
    checked_at: "2026-04-24T10:15:30Z",
    status: "down",
    response_time_ms: 3000,
  });
  assert.equal(store.proxies[1].history.length, 1);
  assert.equal(store.totalChecks, 3);
  assert.deepEqual(snapshot, {
    failure_rate: 1 / 3,
    total_proxies: 3,
    failed_proxies: 1,
    failed_proxy_ids: ["px-102"],
  });
  assert.deepEqual(alertManager.snapshots, [snapshot]);
});

test("uses failure rate 0 for empty pools", async () => {
  const store = createStore({
    config: { check_interval_seconds: 15, request_timeout_ms: 3000 },
    proxies: [],
  });
  const alertManager = createAlertManager();
  const engine = createMonitoringEngine({ store, alertManager });

  const snapshot = await engine.runCycle();

  assert.deepEqual(snapshot, {
    failure_rate: 0,
    total_proxies: 0,
    failed_proxies: 0,
    failed_proxy_ids: [],
  });
  assert.deepEqual(alertManager.snapshots, [snapshot]);
});

test("hot-reloads interval timing when config changes", async () => {
  const scheduledIntervals = [];
  const clearedTimers = [];
  const store = createStore({
    config: { check_interval_seconds: 1, request_timeout_ms: 3000 },
    proxies: [],
  });
  const engine = createMonitoringEngine({
    store,
    setIntervalFn(callback, intervalMs) {
      const timer = { callback, intervalMs };
      scheduledIntervals.push(intervalMs);
      return timer;
    },
    clearIntervalFn(timer) {
      clearedTimers.push(timer.intervalMs);
    },
  });

  await engine.start({ runImmediately: false });
  store.config = { check_interval_seconds: 2, request_timeout_ms: 1500 };
  await engine.onConfigUpdated();

  assert.deepEqual(scheduledIntervals, [1000, 2000]);
  assert.deepEqual(clearedTimers, [1000]);
});

test("pool changes start and stop monitoring cleanly", async () => {
  const scheduledIntervals = [];
  const clearedTimers = [];
  const store = createStore({
    config: { check_interval_seconds: 1, request_timeout_ms: 3000 },
    proxies: [
      { id: "px-101", url: "https://example.test/up", status: "pending", history: [] },
    ],
  });
  const engine = createMonitoringEngine({
    store,
    checkProxy: async () => ({
      status: "up",
      checked_at: "2026-04-24T10:15:30Z",
      response_time_ms: 10,
    }),
    setIntervalFn(callback, intervalMs) {
      const timer = { callback, intervalMs };
      scheduledIntervals.push(intervalMs);
      return timer;
    },
    clearIntervalFn(timer) {
      clearedTimers.push(timer.intervalMs);
    },
  });

  await engine.onPoolChanged();
  assert.equal(engine.isRunning, true);
  assert.deepEqual(scheduledIntervals, [1000]);

  store.proxies = [];
  await engine.onPoolChanged();

  assert.equal(engine.isRunning, false);
  assert.deepEqual(clearedTimers, [1000]);
});
