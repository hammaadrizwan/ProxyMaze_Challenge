import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { checkProxy } from "../src/services/proxyChecker.js";

function createTestServer(handler) {
  const server = createServer(handler);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("classifies 2xx responses as up", async () => {
  const server = await createTestServer((request, response) => {
    response.writeHead(204);
    response.end();
  });

  try {
    const result = await checkProxy(`${server.url}/healthy`, {
      request_timeout_ms: 500,
    });

    assert.equal(result.status, "up");
    assert.equal(result.http_status, 204);
    assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof result.response_time_ms, "number");
  } finally {
    await server.close();
  }
});

test("classifies 5xx responses as down", async () => {
  const server = await createTestServer((request, response) => {
    response.writeHead(503);
    response.end();
  });

  try {
    const result = await checkProxy(`${server.url}/failing`, {
      request_timeout_ms: 500,
    });

    assert.equal(result.status, "down");
    assert.equal(result.http_status, 503);
  } finally {
    await server.close();
  }
});

test("classifies timeouts as down", async () => {
  const server = await createTestServer(() => {
    // Hold the request open until the client's timeout aborts it.
  });

  try {
    const result = await checkProxy(`${server.url}/slow`, {
      request_timeout_ms: 25,
    });

    assert.equal(result.status, "down");
    assert.equal(result.error, "timeout");
  } finally {
    await server.close();
  }
});

test("classifies connection failures as down", async () => {
  const server = await createTestServer((request, response) => {
    response.writeHead(200);
    response.end();
  });
  const closedUrl = server.url;
  await server.close();

  const result = await checkProxy(`${closedUrl}/closed`, {
    request_timeout_ms: 200,
  });

  assert.equal(result.status, "down");
  assert.equal(result.error, "connection_failure");
});
