# ProxyMaze Architecture

ProxyMaze is a single-process Node.js service with an Express REST API, an
in-memory state store, a continuous monitoring engine, an alert lifecycle manager,
and outbound notification delivery.

The evaluator only sees the HTTP API, so every internal component must keep the
API, alerts, webhooks, and integrations telling the same story about the same
monitoring state.

## System Shape

```text
HTTP evaluator / users
        |
        v
Express REST API
  |       |        |          |
  |       |        |          +--> Integration registration
  |       |        +-------------> Webhook registration
  |       +----------------------> Config and proxy ingestion
  +------------------------------> Read endpoints
        |
        v
In-memory data store
  |       |        |
  |       |        +--> Metrics, history, alerts, delivery records
  |       +-----------> Alert manager
  +-------------------> Mushaf's monitoring engine
                        |
                        v
                  Real HTTP probes
                        |
                        v
                  Alert snapshot
                        |
                        v
             Notification engine
          webhooks / Slack / Discord
```

## Core Subsystems

### REST API Layer

Owned by Hassan.

Responsibilities:

- Expose the 12 challenge endpoints defined in `docs/API.md`.
- Accept valid JSON request bodies and ignore unknown object fields.
- Return exact challenge response codes, especially:
  `201 Created` for `POST /proxies`, `204 No Content` for `DELETE /proxies`,
  and `200 OK` or `201 Created` for `POST /integrations`.
- Never trigger proxy probes from read endpoints.
- Format API responses from the current store state.

### In-Memory Data Store

Owned by Ridhushan.

Stores:

- Runtime config: `check_interval_seconds`, `request_timeout_ms`.
- Proxies keyed by deterministic proxy ID.
- Per-proxy counters and history.
- Alerts, both active and resolved.
- Webhook receivers and Slack/Discord integrations.
- Metrics such as `total_checks`, `current_pool_size`, `active_alerts`,
  `total_alerts`, and `webhook_deliveries`.

Suggested proxy object:

```js
{
  id: "px-101",
  url: "https://proxy-provider.example/proxy/px-101",
  status: "pending", // pending | up | down
  last_checked_at: null,
  consecutive_failures: 0,
  total_checks: 0,
  up_checks: 0,
  history: []
}
```

Suggested alert object:

```js
{
  alert_id: "alert-a1b2c3",
  status: "active",
  failure_rate: 0.3,
  total_proxies: 10,
  failed_proxies: 3,
  failed_proxy_ids: ["px-103", "px-104", "px-105"],
  threshold: 0.2,
  fired_at: "2026-04-24T10:20:00Z",
  resolved_at: null,
  message: "Proxy pool failure rate exceeded threshold"
}
```

### Monitoring Engine

Owned by Mushaf.

The monitoring engine is the heartbeat of ProxyMaze. It must run continuously in
the background on the active `check_interval_seconds` cadence.

Cycle flow:

1. Read the current config and current proxy pool from the store.
2. Probe all current proxy URLs concurrently using the current `request_timeout_ms`.
3. Classify each result strictly from the real HTTP outcome:
   2xx -> `up`; timeout, connection failure/refusal, or 5xx -> `down`.
4. Update each proxy's `status`, `last_checked_at`, `consecutive_failures`,
   `total_checks`, `up_checks`, and history.
5. Compute `failure_rate = down / total` from current stored proxy state.
6. Pass an exact snapshot to the alert manager:
   `failure_rate`, `total_proxies`, `failed_proxies`, and `failed_proxy_ids`.

Runtime behavior:

- New proxies remain `pending` until their first completed background probe.
- `POST /proxies` starts monitoring if the pool is non-empty.
- `POST /config` hot-reloads the cadence and timeout immediately for subsequent checks.
- `DELETE /proxies` clears the pool and stops or idles monitoring without deleting alerts.
- Empty pools should not divide by zero; use failure rate `0`.

### Alert Manager

Owned by Hammad.

The alert manager owns the alert lifecycle and threshold rule.

Rules:

- Threshold is fixed at `0.20`.
- Fire when `failure_rate >= 0.20`.
- Resolve when `failure_rate < 0.20`.
- At most one alert can be active at a time.
- A continuous breach keeps the same active alert and `alert_id`.
- After resolution, a fresh breach creates a new `alert_id`.
- Resolved alerts remain in the archive unchanged.

### Notification Engine

Owned by Hammad.

The notification engine receives alert transition events from the alert manager and
delivers them to registered receivers.

Delivery requirements:

- Send `alert.fired` and `alert.resolved` webhook events with
  `Content-Type: application/json`.
- Deliver each event to every registered receiver within 60 seconds of the transition.
- Retry transient receiver failures: `500`, `502`, `503`, and `504`.
- Record successful delivery so each transition reaches each receiver exactly once.
- Send Slack and Discord formatted payloads for registered integrations.

## Data Consistency Invariants

- `GET /proxies` reports the latest completed background monitoring state.
- `GET /alerts` and active breach webhooks must agree with `GET /proxies` on the
  failed proxy set, failed count, total proxy count, and threshold.
- `failed_proxy_ids` always equals the current set of proxies classified as `down`.
- Alert history survives proxy replacement and `DELETE /proxies`.
- Unknown request fields never change behavior unless they are part of the documented contract.

## Implementation Stack

- Runtime: Node.js 20+.
- Framework: Express.
- HTTP probing and delivery: Axios or native `fetch` with timeout support.
- Scheduler: `setInterval` or equivalent interval management.
- Storage: in-memory Maps and arrays.
- Testing: Jest/Supertest or equivalent HTTP integration tests.
