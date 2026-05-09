# 🏗️ ProxyMaze Architecture

## System Overview

ProxyMaze is a **single-process Node.js service** with five core subsystems communicating through an in-memory data store. It exposes a REST API and runs background monitoring loops.

---

## High-Level Architecture

```
                          ┌───────────────────────┐
                          │      HTTP Clients      │
                          │   (Evaluator / Users)  │
                          └───────────┬───────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │         Express REST API         │
                    │  /health /config /proxies /alerts │
                    │  /webhooks /integrations /metrics  │
                    └────────────────┬────────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                │                    │                    │
                ▼                    ▼                    ▼
    ┌───────────────┐   ┌───────────────────┐   ┌──────────────────┐
    │  Config Store  │   │ Monitoring Engine │   │ Alert Manager    │
    │               │   │ (Scheduler Loop)  │   │ (Lifecycle FSM)  │
    └───────────────┘   └────────┬──────────┘   └────────┬─────────┘
                                 │                       │
                                 ▼                       ▼
                     ┌──────────────────┐    ┌─────────────────────┐
                     │  Proxy Checker   │    │ Notification Engine │
                     │  (HTTP Probes)   │    │ Webhooks/Slack/     │
                     └──────────────────┘    │ Discord             │
                                             └─────────────────────┘
                                 │                       │
                                 ▼                       ▼
                    ┌──────────────────────────────────────────┐
                    │         In-Memory Data Store              │
                    │  Proxies │ Alerts │ History │ Metrics     │
                    └──────────────────────────────────────────┘
```

---

## Core Components

### 1. REST API Layer (`src/routes/`)

| Responsibility | Details |
|---|---|
| Request routing | Maps HTTP methods + paths to handlers |
| Input validation | Validates required fields, ignores unknown fields |
| Response formatting | Consistent JSON responses |
| Error handling | Proper HTTP status codes (200, 400, 404, 500) |

### 2. Monitoring Engine (`src/services/monitoringEngine.js`)

The heartbeat of the system. Runs a continuous loop that:

```
┌─── Start Cycle ──────────────────────────────────────────┐
│                                                          │
│  1. Read config (interval, timeout)                      │
│  2. Get all proxies from store                           │
│  3. For each proxy → HTTP HEAD/GET with timeout          │
│  4. Update proxy status (pending → up/down)              │
│  5. Record check in history                              │
│  6. Compute failure_rate = down / total                  │
│  7. If rate ≥ 0.20 → trigger Alert Manager               │
│  8. If rate < 0.20 & active alert → resolve alert        │
│  9. Wait check_interval_seconds                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- Probes run **concurrently** (Promise.all) for speed
- Timeout is enforced per-probe via AbortController/Axios timeout
- Only real HTTP probes — no simulated checks

### 3. Alert Manager (`src/services/alertManager.js`)

Implements a **finite state machine** for alert lifecycle:

```
                    ┌────────────┐
        ┌──────────▶│   NORMAL   │◀──────────┐
        │           └─────┬──────┘           │
        │                 │ rate ≥ 0.20      │
        │                 ▼                  │
        │         ┌──────────────┐           │
        │         │    ACTIVE    │           │
        │         │  (1 alert)   │           │
        │         └──────┬───────┘           │
        │                │ rate < 0.20       │
        │                ▼                   │
        │         ┌──────────────┐           │
        └─────────│   RESOLVED   │───────────┘
          new      └──────────────┘  rate ≥ 0.20
          breach                     (new alert_id)
```

**Invariants:**
- Max 1 active alert at any time
- Continuous breaches → same alert (no duplicates)
- Recovery → resolve → re-breach → **new** alert ID
- `failed_proxy_ids` must match across all systems

### 4. Notification Engine (`src/services/notificationEngine.js`)

Handles outbound delivery to webhooks, Slack, and Discord.

```
Event (alert.fired / alert.resolved)
    │
    ├──▶ Webhooks    → POST JSON payload → retry on 5xx
    ├──▶ Slack       → POST Slack-formatted payload
    └──▶ Discord     → POST Discord embed payload
```

**Retry strategy:**
- Retry on: `500`, `502`, `503`, `504`
- No retry on: `2xx`, `4xx`
- No duplicate successful deliveries
- Must complete within **60 seconds**

### 5. In-Memory Data Store (`src/store/dataStore.js`)

```
dataStore = {
    config: { check_interval_seconds, request_timeout_ms },
    proxies: Map<id, ProxyObject>,
    alerts: [],
    webhooks: [],
    integrations: [],
    metrics: { total_checks, webhook_deliveries }
}
```

**Why in-memory?**
- Challenge is evaluated as a black box — persistence across restarts is not required
- Zero external dependencies → simpler deployment
- Sufficient for the scale of the challenge

---

## Data Models

### Proxy Object
```javascript
{
    id: "px-101",               // from URL path
    url: "https://...",         // original URL
    status: "up",              // pending | up | down
    last_checked_at: "...",    // ISO 8601 UTC
    consecutive_failures: 0,
    total_checks: 48,
    up_checks: 46,
    history: [ { checked_at, status, response_time_ms } ]
}
```

### Alert Object
```javascript
{
    alert_id: "alert-001",
    status: "active",          // active | resolved
    failure_rate: 0.30,
    total_proxies: 10,
    failed_proxies: 3,
    failed_proxy_ids: ["px-103", "px-107"],
    threshold: 0.20,
    fired_at: "...",
    resolved_at: null,
    message: "..."
}
```

---

## Request Flow Example

### Alert Firing Flow

```
1. Monitoring cycle runs
2. Probes 10 proxies → 3 fail → failure_rate = 0.30
3. Alert Manager: no active alert → create alert-001 (status: active)
4. Notification Engine:
   a. POST to all registered webhooks
   b. POST to Slack integrations (formatted)
   c. POST to Discord integrations (formatted)
5. GET /alerts returns alert-001 with status "active"
```

### Alert Resolution Flow

```
1. Monitoring cycle runs
2. Probes 10 proxies → 1 fails → failure_rate = 0.10
3. Alert Manager: active alert exists → resolve alert-001
4. Notification Engine: sends "alert.resolved" to all channels
5. GET /alerts returns alert-001 with status "resolved"
```

---

## Deployment

```
┌──────────────────────────┐
│     Node.js Process       │
│                          │
│   Express (port 3000)    │
│   + Monitoring Loop      │
│   + Notification Queue   │
│                          │
│   Single process,        │
│   no external deps       │
└──────────────────────────┘
```

- **Port:** 3000 (configurable via `PORT` env var)
- **No database** required
- **No message queue** required
- **No container** required (but Docker-friendly)
