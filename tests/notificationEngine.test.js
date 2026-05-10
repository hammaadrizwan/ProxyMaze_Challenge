const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { test, beforeEach } = require("node:test");
const notifications = require("../src/services/notificationEngine");
const store = require("../src/store/dataStore.js");

function resetDataStore() {
  const s = store.dataStore;
  s.proxies.clear();
  s.alerts.length = 0;
  s.webhooks.length = 0;
  s.integrations.length = 0;
  s.metrics.webhook_deliveries = 0;
  s.metrics.total_checks = 0;
  s._alertCounter = 0;
  s._integrationCounter = 0;
  s._webhookCounter = 0;
}

beforeEach(() => {
  notifications.reset();
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        url: (path) => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test("deliverUntilSuccess follows POST through 302 Location", async () => {
  let sinkReceived = null;
  const sink = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        sinkReceived = body ? JSON.parse(body) : null;
      } catch {
        sinkReceived = null;
      }
      res.writeHead(200);
      res.end();
    });
  });
  const sinkInfo = await listen(sink);
  const sinkUrl = sinkInfo.url("/target");

  const redirector = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/hook")) {
      res.writeHead(302, { Location: sinkUrl });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const redInfo = await listen(redirector);
  const startUrl = redInfo.url("/hook");

  try {
    await notifications.deliverUntilSuccess(
      startUrl,
      `${startUrl}|alert-001|alert.fired`,
      { event: "alert.fired", alert_id: "alert-001" },
      () => {},
    );
    assert.equal(sinkReceived?.event, "alert.fired");
    assert.equal(sinkReceived?.alert_id, "alert-001");
  } finally {
    await redInfo.close();
    await sinkInfo.close();
  }
});

test("deliverUntilSuccess retries 503 then succeeds on third POST", async () => {
  let count = 0;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      count += 1;
      if (count <= 2) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end();
    });
  });
  const info = await listen(srv);
  const u = info.url("/webhook");

  try {
    await notifications.deliverUntilSuccess(
      u,
      `${u}|alert-002|alert.fired`,
      { ok: true },
      () => {},
    );
    assert.equal(count, 3);
  } finally {
    await info.close();
  }
});

test("deliverUntilSuccess dedupes second call for same key", async () => {
  let posts = 0;
  const srv = createServer((req, res) => {
    posts += 1;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200);
      res.end();
    });
  });
  const info = await listen(srv);
  const u = info.url("/x");
  const key = `${u}|alert-003|alert.fired`;

  try {
    await Promise.all([
      notifications.deliverUntilSuccess(u, key, { a: 1 }, () => {}),
      notifications.deliverUntilSuccess(u, key, { a: 1 }, () => {}),
    ]);
    assert.equal(posts, 1);
  } finally {
    await info.close();
  }
});

test("dispatchFiredToNewIntegration POSTs Slack payload when breach already active", async () => {
  let received = null;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        received = body ? JSON.parse(body) : null;
      } catch {
        received = null;
      }
      res.writeHead(200);
      res.end();
    });
  });
  const info = await listen(srv);

  resetDataStore();
  notifications.reset();

  store.createAlert(0.3, 10, 3, ["px-001", "px-002", "px-003"]);
  const intg = store.addIntegration("slack", info.url("/slack"), "ProxyWatch", [
    "alert.fired",
    "alert.resolved",
  ]);

  try {
    notifications.dispatchFiredToNewIntegration(intg);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !received) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(received?.blocks, "Slack body should include Block Kit blocks");
    assert.ok(Array.isArray(received.attachments));
    assert.equal(received.attachments[0].fields[0].title, "Alert ID");
  } finally {
    await info.close();
  }
});
