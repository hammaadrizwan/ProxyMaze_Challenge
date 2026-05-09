# 📋 ProxyMaze Task Assignments

## Team Members

| Member | Role | Primary Responsibility |
|---|---|---|
| **Hassan** | API Layer | REST endpoints, server setup, routing, validation |
| **Mushaf** | Monitoring Engine | Proxy health checking, scheduling, state machine |
| **Hammad** | Alert System & Notifications | Alert lifecycle, webhooks, Slack, Discord |
| **Ridhushan** | Data Layer & Observability | Data store, metrics, history, testing, integration |

---

## Sprint Plan (Recommended: 3 Phases)

```
Phase 1: Foundation (Hours 0–4)     → Server, Config, Data Store, Proxy CRUD
Phase 2: Core Logic (Hours 4–8)     → Monitoring, Alerts, Webhooks
Phase 3: Polish (Hours 8–12)        → Slack/Discord, Metrics, Testing, Edge Cases
```

---

## 🟢 HASSAN — API Layer

### Phase 1: Foundation (Priority: 🔴 Critical)

| # | Task | Points | Est. |
|---|---|---|---|
| H1 | **Project scaffolding** — `npm init`, install Express + Axios, create folder structure (`src/routes`, `src/services`, `src/store`, `src/utils`) | — | 30m |
| H2 | **Server bootstrap** — `src/server.js` with Express, JSON middleware, error handler, PORT config | 10 | 30m |
| H3 | **GET /health** — Return `{ "status": "ok" }` | 10 | 10m |
| H4 | **POST /config & GET /config** — Accept config, store it, return it. Ignore unknown fields | — | 30m |
| H5 | **POST /proxies** — Parse URLs, extract IDs (last path segment), handle `replace` flag, return pool | 45 | 45m |
| H6 | **GET /proxies** — Return pool summary with `total`, `up`, `down`, `failure_rate`, proxy list | — | 30m |
| H7 | **GET /proxies/:id** — Return single proxy detail with history, 404 for unknowns | — | 30m |
| H8 | **GET /proxies/:id/history** — Return history array | — | 15m |
| H9 | **DELETE /proxies** — Clear pool, preserve alerts and history | — | 15m |

### Phase 2: Integration Support

| # | Task | Points | Est. |
|---|---|---|---|
| H10 | **GET /alerts** — Return all alerts from data store | — | 15m |
| H11 | **POST /webhooks** — Register webhook URL, store it | — | 20m |
| H12 | **POST /integrations** — Register Slack/Discord config | — | 20m |
| H13 | **GET /metrics** — Return metrics from data store | 25 | 15m |

### Phase 3: Polish

| # | Task | Points | Est. |
|---|---|---|---|
| H14 | **Input validation** — Validate all request bodies, return 400 on bad input | — | 30m |
| H15 | **Unknown field handling** — Ensure all POST endpoints ignore unknown JSON fields | — | 15m |
| H16 | **Code review** — Review all team PRs, ensure API contract consistency | — | 30m |

**Hassan's ownership:** `src/server.js`, `src/routes/*`, `src/utils/proxyIdParser.js`

---

## 🔵 MUSHAF — Monitoring Engine

### Phase 1: Foundation (Priority: 🔴 Critical)

| # | Task | Points | Est. |
|---|---|---|---|
| M1 | **Proxy Checker** — `src/services/proxyChecker.js` — HTTP GET/HEAD with configurable timeout, return `{ status, response_time_ms }` | 30 | 45m |
| M2 | **Status classification** — 2xx → `up`, timeout/5xx → `down`, first check clears `pending` | — | 20m |
| M3 | **Monitoring Engine** — `src/services/monitoringEngine.js` — Scheduler loop using `setInterval` with configurable interval | 45 | 60m |

### Phase 2: Core Logic (Priority: 🔴 Critical)

| # | Task | Points | Est. |
|---|---|---|---|
| M4 | **Concurrent probing** — Use `Promise.allSettled` to probe all proxies in parallel | — | 30m |
| M5 | **State updates** — After each cycle: update `status`, `last_checked_at`, `consecutive_failures`, `total_checks`, `up_checks` | — | 30m |
| M6 | **History recording** — Push `{ checked_at, status, response_time_ms }` to proxy history array | — | 20m |
| M7 | **Failure rate computation** — `down / total`, feed result to Alert Manager | — | 15m |
| M8 | **Auto-start on proxy load** — Start/restart monitoring when `POST /proxies` is called | — | 20m |
| M9 | **Config hot-reload** — When config changes, restart the interval with new timing | — | 20m |

### Phase 3: Polish

| # | Task | Points | Est. |
|---|---|---|---|
| M10 | **Stop on DELETE** — Stop monitoring when pool is cleared | — | 10m |
| M11 | **Edge cases** — Empty pool, single proxy, all down, all up | — | 20m |
| M12 | **Uptime percentage** — Compute `(up_checks / total_checks) * 100` for each proxy | — | 15m |

**Mushaf's ownership:** `src/services/monitoringEngine.js`, `src/services/proxyChecker.js`

---

## 🟡 HAMMAD — Alert System & Notifications

### Phase 2: Core Logic (Priority: 🔴 Critical)

| # | Task | Points | Est. |
|---|---|---|---|
| A1 | **Alert Manager** — `src/services/alertManager.js` — FSM with states: NORMAL → ACTIVE → RESOLVED | 90 | 60m |
| A2 | **Alert firing** — When `failure_rate >= 0.20` and no active alert → create new alert | — | 30m |
| A3 | **Alert resolution** — When `failure_rate < 0.20` and active alert → resolve it | 20 | 20m |
| A4 | **Re-breach handling** — After resolution, new breach creates **new alert_id** | 30 | 30m |
| A5 | **Duplicate prevention** — Continuous breaches must NOT create new alerts | — | 20m |
| A6 | **Alert ID generation** — Unique, sequential IDs (e.g., `alert-001`, `alert-002`) | — | 10m |

### Phase 2: Webhook Delivery

| # | Task | Points | Est. |
|---|---|---|---|
| A7 | **Notification Engine** — `src/services/notificationEngine.js` — Dispatch to all registered receivers | — | 45m |
| A8 | **Webhook delivery** — POST JSON to registered URLs, handle responses | — | 30m |
| A9 | **Retry logic** — Retry on 500/502/503/504, no retry on 2xx/4xx | — | 30m |
| A10 | **Dedup delivery** — Track successful deliveries, never re-send | — | 20m |
| A11 | **60s deadline** — Ensure delivery within 60 seconds | — | 10m |

### Phase 3: Bonus Integrations

| # | Task | Points | Est. |
|---|---|---|---|
| A12 | **Slack payload** — Format with `username`, `text`, `attachments` (color, fields, footer, ts) | +10 | 30m |
| A13 | **Discord payload** — Format with `embeds` (title, description, color, fields, footer.text) | +10 | 30m |
| A14 | **Resolved payloads** — Different formatting for alert.resolved vs alert.fired | — | 20m |

**Hammad's ownership:** `src/services/alertManager.js`, `src/services/notificationEngine.js`

---

## 🟣 RIDHUSHAN — Data Layer & Observability

### Phase 1: Foundation (Priority: 🔴 Critical)

| # | Task | Points | Est. |
|---|---|---|---|
| R1 | **Data Store** — `src/store/dataStore.js` — Central state with Maps for proxies, arrays for alerts/webhooks/integrations | — | 45m |
| R2 | **Proxy CRUD in store** — `addProxy`, `getProxy`, `getAllProxies`, `clearProxies`, `updateProxyStatus` | — | 30m |
| R3 | **Alert storage** — `addAlert`, `getAlerts`, `getActiveAlert`, `resolveAlert` | — | 30m |
| R4 | **Webhook/integration storage** — `addWebhook`, `getWebhooks`, `addIntegration`, `getIntegrations` | — | 20m |

### Phase 2: Observability

| # | Task | Points | Est. |
|---|---|---|---|
| R5 | **Metrics tracking** — Increment `total_checks`, `webhook_deliveries` on events | 25 | 30m |
| R6 | **History management** — Store per-proxy check history, support retrieval | — | 20m |
| R7 | **Failure rate helper** — Utility to compute `down / total` from current proxy states | — | 15m |
| R8 | **Timestamp helpers** — `src/utils/timestamps.js` — ISO 8601 UTC formatting | — | 15m |

### Phase 3: Testing & Quality

| # | Task | Points | Est. |
|---|---|---|---|
| R9 | **Health endpoint test** — Verify `/health` returns `{ status: "ok" }` | — | 15m |
| R10 | **Config tests** — POST config, GET config, unknown field handling | — | 20m |
| R11 | **Proxy tests** — Add, replace, get, delete, 404 handling | — | 30m |
| R12 | **Alert lifecycle test** — Fire → resolve → re-breach → new alert | — | 30m |
| R13 | **DELETE /proxies test** — Verify alerts survive, pool is cleared | — | 15m |
| R14 | **Edge case tests** — Empty pool, zero proxies, boundary conditions | — | 20m |
| R15 | **`.gitignore` setup** — node_modules, .env, etc. | — | 5m |

**Ridhushan's ownership:** `src/store/dataStore.js`, `src/utils/timestamps.js`, `tests/*`

---

## Dependency Graph

```
Hassan (API)                 Ridhushan (Data Store)
   │                              │
   │  uses store methods          │  provides store API
   ├──────────────────────────────┤
   │                              │
   │                    Mushaf (Monitoring)
   │                         │
   │  triggers on POST       │  calls store + alert manager
   ├─────────────────────────┤
   │                         │
   │               Hammad (Alerts + Notifications)
   │                         │
   │  exposes GET /alerts    │  fires webhooks/slack/discord
   └─────────────────────────┘
```

### Integration Order

1. **Ridhushan** delivers data store first (all others depend on it)
2. **Hassan** builds routes against the store API
3. **Mushaf** builds monitoring engine using store + config
4. **Hammad** builds alert manager + notifications, triggered by monitoring engine

---

## Communication Protocol

| When | Action |
|---|---|
| **Blocked** | Post in team chat immediately with what you need |
| **API contract change** | Notify Hassan — he owns the route layer |
| **Store method needed** | Request from Ridhushan with signature |
| **Integration ready** | Ping the dependent team member to pull |

---

## Scoring Impact by Member

| Member | Direct Points | Shared Points | Bonus |
|---|---|---|---|
| Hassan | 10 (health) + 25 (metrics) | 45 (proxies) | — |
| Mushaf | 30 (single failure) + 45 (monitoring) | — | — |
| Hammad | 90 (alerts) + 20 (resolution) + 30 (re-breach) | — | +20 (Slack/Discord) |
| Ridhushan | 25 (observability) | Enables all | — |

> **Note:** Points are collaborative — Hammad can't score alert points without Mushaf's monitoring or Ridhushan's store. Ship as a team.

---

## Definition of Done

- [ ] `GET /health` returns `200` with `{ "status": "ok" }`
- [ ] Config can be set and retrieved
- [ ] Proxies can be loaded, listed, and deleted
- [ ] Monitoring runs continuously with real HTTP probes
- [ ] Failure rate is computed correctly
- [ ] Alerts fire at threshold ≥ 0.20
- [ ] Alerts resolve when rate drops below 0.20
- [ ] Re-breach creates new alert ID
- [ ] Webhooks deliver reliably with retry
- [ ] Slack payloads are correctly formatted
- [ ] Discord payloads are correctly formatted
- [ ] Metrics endpoint returns accurate counts
- [ ] All timestamps are ISO 8601 UTC
- [ ] Unknown JSON fields are silently ignored
- [ ] 404 returned for unknown proxy IDs
