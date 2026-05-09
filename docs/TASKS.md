# ProxyMaze Task Assignments

This is the accepted task file for the repo. Keep it aligned with `docs/API.md`,
which is the canonical challenge contract.

## Team Ownership

| Member | Role | Primary responsibility |
|---|---|---|
| Hassan | API Layer | Express bootstrap, routing, request validation, response formatting |
| Mushaf | Monitoring Engine | Real proxy probing, scheduling, state updates, failure-rate snapshots |
| Hammad | Alert System and Notifications | Alert lifecycle, webhooks, Slack, Discord |
| Ridhushan | Data Layer and Observability | In-memory store, metrics, history, tests |

## Delivery Phases

| Phase | Focus | Target outcome |
|---|---|---|
| Phase 1 | Foundation | Server, config, data store, proxy ingestion, basic reads |
| Phase 2 | Core behavior | Background monitoring, alerts, webhooks, consistency |
| Phase 3 | Polish | Slack/Discord, metrics accuracy, edge cases, tests |

## Hassan - API Layer

Primary files:

- `src/server.js`
- `src/routes/*`
- `src/utils/proxyIdParser.js`

Tasks:

| ID | Task | Contract notes |
|---|---|---|
| H1 | Project scaffolding | Node.js 20+, Express, JSON middleware, route folders, service folders, store folder |
| H2 | Server bootstrap | Listen on `PORT` defaulting to `3000`; include centralized error handling |
| H3 | `GET /health` | Return `200 OK` with `{ "status": "ok" }` |
| H4 | `POST /config` and `GET /config` | Store and return `check_interval_seconds` and `request_timeout_ms`; ignore unknown fields |
| H5 | `POST /proxies` | Extract IDs from final URL path segment; support append and `replace: true`; return `201 Created` with `{ accepted, proxies }` |
| H6 | `GET /proxies` | Return pool summary and per-proxy state from background checks only |
| H7 | `GET /proxies/{id}` | Include history, `total_checks`, and `uptime_percentage`; return `404` for unknown IDs |
| H8 | `GET /proxies/{id}/history` | Return a JSON array; return `404` for unknown IDs |
| H9 | `DELETE /proxies` | Clear current pool and return `204 No Content`; do not delete alerts |
| H10 | `GET /alerts` | Return all active and resolved alerts from the store |
| H11 | `POST /webhooks` | Register a receiver URL; return `201 Created`; ignore unknown fields |
| H12 | `POST /integrations` | Register Slack or Discord config; return `200 OK` or `201 Created` |
| H13 | `GET /metrics` | Return non-empty JSON with required operational counters |
| H14 | Input validation | Reject malformed input; do not reject unknown JSON object fields |

Definition of done:

- All 12 endpoints exist with response codes matching `docs/API.md`.
- Read endpoints do not trigger monitoring probes.
- Route responses are shaped from store/service state rather than duplicated local state.

## Mushaf - Monitoring Engine

Primary files:

- `src/services/proxyChecker.js`
- `src/services/monitoringEngine.js`

Mushaf owns the behavior that turns submitted URLs into real, continuously updated
proxy state. This is central to the challenge score because alerts, metrics, history,
and API reads all depend on the monitoring snapshot.

### Proxy Checker

| ID | Task | Contract notes |
|---|---|---|
| M1 | Implement `proxyChecker` | Perform a real HTTP probe against the submitted proxy URL using the active `request_timeout_ms` |
| M2 | Classify 2xx responses | Any 2xx response received before timeout returns `up` |
| M3 | Classify failures | Timeout, connection failure, connection refusal, and any 5xx response return `down` |
| M4 | Return probe metadata | Return enough data for the engine to record `status`, `checked_at`, and optional `response_time_ms` |
| M5 | Avoid mocks | Do not hardcode, simulate, or cache proxy outcomes |

Recommended checker result shape:

```js
{
  status: "up", // or "down"
  checked_at: "2026-04-24T10:15:30Z",
  response_time_ms: 42
}
```

### Monitoring Engine

| ID | Task | Contract notes |
|---|---|---|
| M6 | Start background loop | Run continuously on `check_interval_seconds`; never depend on read endpoints |
| M7 | Probe concurrently | Use `Promise.allSettled` or equivalent so the whole pool is checked in parallel |
| M8 | Update proxy state | Set `status`, `last_checked_at`, `consecutive_failures`, `total_checks`, and `up_checks` after each probe |
| M9 | Record history | Append `{ checked_at, status }` and optional `response_time_ms` to each proxy history |
| M10 | Clear `pending` | Newly accepted proxies remain `pending` only until their first completed probe |
| M11 | Compute failure rate | Use `down / total`; use `0` when the pool is empty |
| M12 | Send alert snapshot | After each cycle, call the alert layer with `failure_rate`, `total_proxies`, `failed_proxies`, and `failed_proxy_ids` |
| M13 | Hot-reload config | Apply changed interval and timeout immediately to subsequent checks |
| M14 | React to pool changes | Start or restart when proxies are loaded; stop or idle when the pool is cleared |
| M15 | Preserve non-pool history | Do not delete alerts when proxies are replaced or cleared |

Required snapshot sent to the alert layer:

```js
{
  failure_rate: 0.3,
  total_proxies: 10,
  failed_proxies: 3,
  failed_proxy_ids: ["px-103", "px-104", "px-105"]
}
```

Mushaf's definition of done:

- Config changes affect the next monitoring cadence without restarting the service.
- 2xx, 5xx, timeout, and connection-refused outcomes classify correctly.
- `GET /proxies`, `GET /proxies/{id}`, and history reflect the latest background check.
- No read endpoint causes a probe.
- Failure snapshots match the store's current set of `down` proxies exactly.

## Hammad - Alert System and Notifications

Primary files:

- `src/services/alertManager.js`
- `src/services/notificationEngine.js`

Tasks:

| ID | Task | Contract notes |
|---|---|---|
| A1 | Alert manager | Implement lifecycle: normal -> active -> resolved -> fresh active alert |
| A2 | Fire alerts | Fire when `failure_rate >= 0.20` and no alert is active |
| A3 | Resolve alerts | Resolve the active alert when `failure_rate < 0.20` |
| A4 | Prevent duplicates | Continuous breaches must keep one active alert and one `alert_id` |
| A5 | Re-breach handling | A breach after resolution must create a new `alert_id` |
| A6 | Alert payload shape | Store every required alert field from `docs/API.md` |
| A7 | Webhook registration support | Deliver events to every registered webhook URL |
| A8 | Webhook payloads | Send exact `alert.fired` and `alert.resolved` JSON payloads |
| A9 | Retry transient failures | Retry `500`, `502`, `503`, and `504` until success |
| A10 | Prevent delivery duplicates | Each transition must produce exactly one successful delivery per receiver |
| A11 | 60-second delivery window | Deliver state-transition events within 60 seconds |
| A12 | Slack bonus payload | Include all required Slack fields and field titles |
| A13 | Discord bonus payload | Include all required Discord embed fields and field names |

Definition of done:

- `GET /alerts` shows active and resolved alerts.
- Active alert data agrees with the latest monitoring snapshot.
- Webhook events arrive in lifecycle order: fired, resolved, fired for re-breach.
- Slack and Discord payloads are valid JSON and meet the bonus field requirements.

## Ridhushan - Data Layer and Observability

Primary files:

- `src/store/dataStore.js`
- `src/utils/timestamps.js`
- `tests/*`

Tasks:

| ID | Task | Contract notes |
|---|---|---|
| R1 | Central data store | Store config, proxies, alerts, webhooks, integrations, metrics |
| R2 | Proxy store API | Add, replace, get, list, clear, and update proxy state by ID |
| R3 | History storage | Preserve per-proxy check history while the proxy exists |
| R4 | Alert storage | Store active and resolved alerts; preserve alert history across pool clears |
| R5 | Webhook/integration storage | Store receivers and integration configs |
| R6 | Metrics tracking | Track `total_checks`, `current_pool_size`, `active_alerts`, `total_alerts`, and `webhook_deliveries` |
| R7 | Timestamp helpers | Produce ISO 8601 UTC strings ending in `Z` |
| R8 | Failure-rate helper | Compute `down / total`, returning `0` for empty pools |
| R9 | Test harness | Add API and lifecycle tests that exercise the black-box contract |

Definition of done:

- Store methods are stable enough for API, monitoring, alerts, and tests to share.
- Metrics are derived from actual state and counters.
- Alert history survives `DELETE /proxies`.

## Integration Order

1. Ridhushan creates the store and timestamp helpers.
2. Hassan wires the server and routes against the store API.
3. Mushaf builds `proxyChecker` and `monitoringEngine` against the store/config API.
4. Hammad connects alert lifecycle and notification delivery to Mushaf's snapshots.
5. Ridhushan and the team add black-box integration tests.

## Required Test Scenarios

- `GET /health` returns `200 OK` with `{ "status": "ok" }`.
- `POST /config` updates config and `GET /config` returns the latest values.
- Unknown fields in object request bodies are ignored.
- `POST /proxies` returns `201 Created`, deterministic IDs, accepted count, and `pending` status.
- New proxies become `up` or `down` from background probes without a read request.
- 2xx, 5xx, timeout, and connection-refused probes classify correctly.
- `GET /proxies`, `GET /proxies/{id}`, and history reflect the latest background check.
- `DELETE /proxies` returns `204 No Content`, clears the pool, and preserves alerts.
- Failure rate reaches `0.20`, one alert fires, recovery resolves it, and re-breach creates a new alert ID.
- Webhook payloads and `GET /alerts` agree on failed proxy IDs, counts, threshold, and total proxies.
- Transient webhook failures are retried without duplicate successful deliveries.
- Slack and Discord payloads include all required bonus fields.

## Definition of Done

- All 12 challenge endpoints are documented and implemented exactly as in `docs/API.md`.
- Monitoring runs continuously in the background from real HTTP probes.
- Alerts fire, resolve, and re-fire according to the lifecycle rules.
- Webhooks, Slack, and Discord receive the required payloads.
- API responses, alert records, and webhook payloads agree on the same monitoring state.
- Metrics return valid, non-empty JSON.
- The team can run the documented tests and verify the black-box contract end to end.
