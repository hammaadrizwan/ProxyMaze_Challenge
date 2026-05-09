const assert = require("node:assert/strict");
const { describe, test, before, after, beforeEach } = require("node:test");
const http = require("node:http");
const { createServer } = require("node:http");

// ── Start the app ──────────────────────────────────────────
const PORT = 3099;
process.env.PORT = PORT;
require("../src/server.js");

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "127.0.0.1",
      port: PORT,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: raw ? JSON.parse(raw) : null,
        });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Helper: small HTTP server that acts as a webhook receiver ──
function createReceiver() {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests ──────────────────────────────────────────────────

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request("GET", "/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

describe("POST /config + GET /config", () => {
  test("stores and returns config", async () => {
    await request("POST", "/config", {
      check_interval_seconds: 10,
      request_timeout_ms: 2000,
    });
    const res = await request("GET", "/config");
    assert.equal(res.status, 200);
    assert.equal(res.body.check_interval_seconds, 10);
    assert.equal(res.body.request_timeout_ms, 2000);
  });

  test("ignores unknown fields", async () => {
    const res = await request("POST", "/config", {
      check_interval_seconds: 5,
      unknown_field: "should be ignored",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.unknown_field, undefined);
  });
});

describe("POST /proxies", () => {
  test("returns 201 with accepted count and pending status", async () => {
    const res = await request("POST", "/proxies", {
      proxies: [
        "https://example.com/proxy/px-001",
        "https://example.com/proxy/px-002",
      ],
      replace: true,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.accepted, 2);
    assert.equal(res.body.proxies[0].id, "px-001");
    assert.equal(res.body.proxies[0].status, "pending");
    assert.equal(res.body.proxies[1].id, "px-002");
  });

  test("extracts deterministic ID from URL", async () => {
    const res = await request("POST", "/proxies", {
      proxies: ["https://provider.example/proxy/my-proxy-99"],
      replace: true,
    });
    assert.equal(res.body.proxies[0].id, "my-proxy-99");
  });
});

describe("DELETE /proxies", () => {
  test("returns 204 with no body", async () => {
    await request("POST", "/proxies", {
      proxies: ["https://example.com/proxy/px-del"],
      replace: true,
    });
    const res = await request("DELETE", "/proxies");
    assert.equal(res.status, 204);
    assert.equal(res.body, null);
  });

  test("alerts survive after DELETE /proxies", async () => {
    const alertsBefore = await request("GET", "/alerts");
    const res = await request("DELETE", "/proxies");
    assert.equal(res.status, 204);
    const alertsAfter = await request("GET", "/alerts");
    assert.equal(alertsAfter.body.length, alertsBefore.body.length);
  });
});

describe("GET /proxies/:id", () => {
  test("returns 404 for unknown proxy", async () => {
    const res = await request("GET", "/proxies/does-not-exist");
    assert.equal(res.status, 404);
  });
});

describe("POST /webhooks", () => {
  test("returns 201 with webhook_id and url", async () => {
    const res = await request("POST", "/webhooks", {
      url: "https://receiver.example/hook",
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id || res.body.webhook_id);
    assert.equal(res.body.url, "https://receiver.example/hook");
  });

  test("ignores unknown fields", async () => {
    const res = await request("POST", "/webhooks", {
      url: "https://receiver.example/hook2",
      extra: "ignored",
    });
    assert.equal(res.status, 201);
  });
});

describe("GET /metrics", () => {
  test("returns required fields", async () => {
    const res = await request("GET", "/metrics");
    assert.equal(res.status, 200);
    assert.ok("total_checks" in res.body);
    assert.ok("current_pool_size" in res.body);
    assert.ok("active_alerts" in res.body);
    assert.ok("total_alerts" in res.body);
    assert.ok("webhook_deliveries" in res.body);
  });
});

describe("Webhook delivery", () => {
  test("receives alert.fired payload when failure rate breaches threshold", async () => {
    const receiver = await createReceiver();

    // Register webhook first
    await request("POST", "/webhooks", { url: receiver.url });
    
    // Set a very short interval so monitoring runs quickly
    await request("POST", "/config", {
      check_interval_seconds: 1,
      request_timeout_ms: 500,
    });

    // Load proxies pointing at nothing — they will all go down
    await request("POST", "/proxies", {
      proxies: [
        "http://127.0.0.1:19991/px-a",
        "http://127.0.0.1:19992/px-b",
      ],
      replace: true,
    });

    // Wait long enough for at least 2 monitoring cycles + webhook delivery
    await wait(8000);

    const fired = receiver.received.find((p) => p.event === "alert.fired");
    assert.ok(fired, "should have received alert.fired");
    assert.ok(fired.alert_id, "alert_id should be present");
    assert.ok(fired.failure_rate >= 0.2, "failure_rate should be >= 0.2");
    assert.ok(Array.isArray(fired.failed_proxy_ids));

    await receiver.close();
    await request("DELETE", "/proxies");
  });
});