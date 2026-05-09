import assert from "node:assert/strict";
import { describe, test, beforeEach } from "node:test";
import {
    dataStore,
    getConfig,
    updateConfig,
    addProxy,
    getProxy,
    getAllProxies,
    updateProxy,
    recordProxyCheck,
    clearProxies,
    addAlert,
    getAlerts,
    getActiveAlert,
    incrementTotalChecks,
    incrementWebhookDeliveries,
    getMetrics
} from "../src/store/dataStore.js";

/*
|--------------------------------------------------------------------------
| Reset helper – restore the singleton to a clean slate between tests
|--------------------------------------------------------------------------
*/

function resetStore() {
    dataStore.config = {
        check_interval_seconds: 15,
        request_timeout_ms: 3000
    };
    dataStore.proxies.clear();
    dataStore.alerts.length = 0;
    dataStore.webhooks.length = 0;
    dataStore.integrations.length = 0;
    dataStore.metrics.total_checks = 0;
    dataStore.metrics.webhook_deliveries = 0;
}

/*
|--------------------------------------------------------------------------
| Config Tests
|--------------------------------------------------------------------------
*/

describe("dataStore – config", () => {
    beforeEach(() => resetStore());

    test("default config returns check_interval_seconds 15 and request_timeout_ms 3000", () => {
        const config = getConfig();

        assert.equal(config.check_interval_seconds, 15);
        assert.equal(config.request_timeout_ms, 3000);
    });

    test("updateConfig changes config and getConfig returns latest values", () => {
        updateConfig({ check_interval_seconds: 30 });

        const config = getConfig();
        assert.equal(config.check_interval_seconds, 30);
        // untouched field should survive the merge
        assert.equal(config.request_timeout_ms, 3000);
    });

    test("updateConfig returns the merged config", () => {
        const result = updateConfig({ request_timeout_ms: 5000 });

        assert.equal(result.request_timeout_ms, 5000);
        assert.equal(result.check_interval_seconds, 15);
    });
});

/*
|--------------------------------------------------------------------------
| Proxy CRUD Tests
|--------------------------------------------------------------------------
*/

describe("dataStore – proxies", () => {
    beforeEach(() => resetStore());

    test("addProxy stores a proxy and getProxy/getAllProxies can read it", () => {
        const proxy = {
            id: "proxy-1",
            url: "http://localhost:8080",
            status: "unknown",
            history: []
        };

        addProxy(proxy);

        assert.deepStrictEqual(getProxy("proxy-1"), proxy);
        assert.equal(getAllProxies().length, 1);
        assert.equal(getAllProxies()[0].id, "proxy-1");
    });

    test("updateProxy updates status fields", () => {
        addProxy({
            id: "proxy-2",
            url: "http://localhost:9090",
            status: "unknown",
            consecutive_failures: 0
        });

        const updated = updateProxy("proxy-2", {
            status: "up",
            consecutive_failures: 0,
            last_checked_at: "2026-05-09T12:00:00Z"
        });

        assert.equal(updated.status, "up");
        assert.equal(updated.last_checked_at, "2026-05-09T12:00:00Z");
        // original field preserved
        assert.equal(updated.url, "http://localhost:9090");
    });

    test("updateProxy returns null for unknown proxy id", () => {
        const result = updateProxy("nonexistent", { status: "up" });

        assert.equal(result, null);
    });

    test("recordProxyCheck appends history and updates counters/status", () => {
        addProxy({
            id: "proxy-3",
            url: "http://localhost:7070",
            status: "unknown",
            consecutive_failures: 0,
            total_checks: 0,
            up_checks: 0,
            history: []
        });

        const historyEntry = {
            status: "up",
            checked_at: "2026-05-09T12:00:00Z",
            response_time_ms: 42
        };

        recordProxyCheck("proxy-3", {
            status: "up",
            last_checked_at: "2026-05-09T12:00:00Z",
            consecutive_failures: 0,
            total_checks: 1,
            up_checks: 1,
            historyEntry
        });

        const proxy = getProxy("proxy-3");
        assert.equal(proxy.status, "up");
        assert.equal(proxy.total_checks, 1);
        assert.equal(proxy.up_checks, 1);
        assert.equal(proxy.history.length, 1);
        assert.deepStrictEqual(proxy.history[0], historyEntry);

        // second check – history should accumulate
        const historyEntry2 = {
            status: "down",
            checked_at: "2026-05-09T12:01:00Z",
            error: "timeout"
        };

        recordProxyCheck("proxy-3", {
            status: "down",
            last_checked_at: "2026-05-09T12:01:00Z",
            consecutive_failures: 1,
            total_checks: 2,
            up_checks: 1,
            historyEntry: historyEntry2
        });

        const updated = getProxy("proxy-3");
        assert.equal(updated.status, "down");
        assert.equal(updated.consecutive_failures, 1);
        assert.equal(updated.history.length, 2);
        assert.deepStrictEqual(updated.history[1], historyEntry2);
    });

    test("clearProxies clears only proxies, not alerts", () => {
        addProxy({ id: "proxy-a", url: "http://a" });
        addProxy({ id: "proxy-b", url: "http://b" });
        addAlert({ id: "alert-1", status: "active", message: "something broke" });

        assert.equal(getAllProxies().length, 2);
        assert.equal(getAlerts().length, 1);

        clearProxies();

        assert.equal(getAllProxies().length, 0);
        // alerts must survive
        assert.equal(getAlerts().length, 1);
    });
});

/*
|--------------------------------------------------------------------------
| Alert Tests
|--------------------------------------------------------------------------
*/

describe("dataStore – alerts", () => {
    beforeEach(() => resetStore());

    test("addAlert/getAlerts/getActiveAlert work", () => {
        addAlert({ id: "a1", status: "resolved", message: "old issue" });
        addAlert({ id: "a2", status: "active", message: "current issue" });
        addAlert({ id: "a3", status: "resolved", message: "another old one" });

        assert.equal(getAlerts().length, 3);

        const active = getActiveAlert();
        assert.equal(active.id, "a2");
        assert.equal(active.status, "active");
    });

    test("getActiveAlert returns undefined when no active alerts exist", () => {
        addAlert({ id: "a1", status: "resolved", message: "fixed" });

        assert.equal(getActiveAlert(), undefined);
    });
});

/*
|--------------------------------------------------------------------------
| Metrics Tests
|--------------------------------------------------------------------------
*/

describe("dataStore – metrics", () => {
    beforeEach(() => resetStore());

    test("getMetrics returns total_checks, current_pool_size, active_alerts, total_alerts, webhook_deliveries", () => {
        // Seed some state
        addProxy({ id: "p1", url: "http://p1" });
        addProxy({ id: "p2", url: "http://p2" });

        addAlert({ id: "a1", status: "active", message: "alert 1" });
        addAlert({ id: "a2", status: "resolved", message: "alert 2" });
        addAlert({ id: "a3", status: "active", message: "alert 3" });

        incrementTotalChecks();
        incrementTotalChecks();
        incrementTotalChecks();

        incrementWebhookDeliveries();

        const metrics = getMetrics();

        assert.equal(metrics.total_checks, 3);
        assert.equal(metrics.current_pool_size, 2);
        assert.equal(metrics.active_alerts, 2);
        assert.equal(metrics.total_alerts, 3);
        assert.equal(metrics.webhook_deliveries, 1);
    });

    test("getMetrics reflects pool size changes after clearProxies", () => {
        addProxy({ id: "p1", url: "http://p1" });
        assert.equal(getMetrics().current_pool_size, 1);

        clearProxies();
        assert.equal(getMetrics().current_pool_size, 0);
    });
});
