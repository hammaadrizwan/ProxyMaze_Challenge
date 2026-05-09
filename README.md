# 🔥 ProxyMaze'26

### Real-Time Proxy Intelligence Monitoring System

> *"Build the watchtower we should have had a year ago."*

**Torch Labs Sri Lanka 2026 Engineering Challenge**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [API Endpoints](#api-endpoints)
- [Alert Lifecycle](#alert-lifecycle)
- [Project Structure](#project-structure)
- [Team](#team)
- [Documentation](#documentation)
- [Scoring](#scoring)

---

## 🎯 Overview

ProxyMaze is a **real-time proxy health monitoring and alerting system** built for Torch Labs' proxy infrastructure. It continuously monitors proxy endpoints, tracks their health status, computes failure rates, fires alerts when thresholds are breached, and delivers notifications via webhooks, Slack, and Discord.

### Key Capabilities

| Capability | Description |
|---|---|
| **Continuous Monitoring** | Polls proxy URLs at configurable intervals with real HTTP probes |
| **State Tracking** | Tracks each proxy as `pending`, `up`, or `down` |
| **Failure Rate Computation** | `failure_rate = down / total` with threshold at `0.20` (20%) |
| **Smart Alerting** | Fires alerts on threshold breach, resolves on recovery, prevents duplicates |
| **Webhook Delivery** | Reliable delivery with retry logic for 5xx errors |
| **Slack & Discord** | Native integration with formatted rich messages |
| **Full Observability** | Per-proxy history, operational metrics, pool-level summaries |

---

## 🔍 Problem Statement

Torch Labs operates thousands of proxy endpoints serving clients worldwide. A catastrophic silent failure — where 43% of proxies went down undetected — exposed a critical gap: **no automated monitoring or alerting existed.**

ProxyMaze fills that gap by providing:

1. **Continuous health checks** — Never miss a failure
2. **Instant alerting** — Know before clients do
3. **Full audit trail** — Every check is recorded
4. **Multi-channel notifications** — Webhooks, Slack, Discord

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ProxyMaze Service                       │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  REST API │  │  Monitoring  │  │  Notification Engine   │ │
│  │  Layer    │──│  Engine      │──│  ┌─────────┐           │ │
│  │          │  │  (Scheduler) │  │  │Webhooks │           │ │
│  └──────────┘  └──────────────┘  │  │Slack    │           │ │
│       │              │           │  │Discord  │           │ │
│       ▼              ▼           │  └─────────┘           │ │
│  ┌──────────┐  ┌──────────────┐  └────────────────────────┘ │
│  │  Config  │  │  Alert       │                              │
│  │  Store   │  │  Manager     │                              │
│  └──────────┘  └──────────────┘                              │
│       │              │                                       │
│       ▼              ▼                                       │
│  ┌─────────────────────────────┐                             │
│  │     In-Memory Data Store    │                             │
│  │  (Proxies, Alerts, History) │                             │
│  └─────────────────────────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

> See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture breakdown.

---

## 🛠️ Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js 20+ | Fast async I/O, ideal for concurrent HTTP probes |
| **Framework** | Express.js | Lightweight, battle-tested HTTP framework |
| **Language** | JavaScript (ES Modules) | Team familiarity, rapid development |
| **HTTP Client** | Axios (with timeout) | Reliable HTTP probing with configurable timeouts |
| **Scheduler** | node-cron / setInterval | Lightweight periodic task scheduling |
| **Data Store** | In-Memory (Maps/Objects) | Zero-dependency, sufficient for challenge scope |
| **Notifications** | Axios (outbound) | Webhook, Slack, Discord delivery |
| **Testing** | Jest / Supertest | API integration testing |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 20.x
- **npm** >= 10.x

### Installation

```bash
# Clone the repository
git clone https://github.com/your-team/ProxyMaze_Challenge.git
cd ProxyMaze_Challenge

# Install dependencies
npm install

# Start the server (development)
npm run dev

# Start the server (production)
npm start
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment mode |

### Verify Installation

```bash
curl http://localhost:3000/health
# → {"status": "ok"}
```

---

## 📡 API Endpoints

| Method | Endpoint | Description | Points |
|---|---|---|---|
| `GET` | `/health` | Service health check | 10 |
| `POST` | `/config` | Set monitoring configuration | — |
| `GET` | `/config` | Get current configuration | — |
| `POST` | `/proxies` | Load proxies into pool | 45 |
| `GET` | `/proxies` | Get pool summary | — |
| `GET` | `/proxies/:id` | Get proxy details | — |
| `GET` | `/proxies/:id/history` | Get proxy check history | — |
| `DELETE` | `/proxies` | Clear proxy pool | — |
| `GET` | `/alerts` | List all alerts | 90 |
| `POST` | `/webhooks` | Register webhook receiver | — |
| `POST` | `/integrations` | Register Slack/Discord | +20 |
| `GET` | `/metrics` | Operational metrics | 25 |

> See [docs/API.md](docs/API.md) for the complete API reference with request/response examples.

---

## 🔄 Alert Lifecycle

```
     ┌─────────┐
     │ Normal  │
     └────┬────┘
          │ failure_rate ≥ 0.20
          ▼
   ┌──────────────┐
   │ Active Alert │ ──→ Webhooks / Slack / Discord
   └──────┬───────┘
          │ failure_rate < 0.20
          ▼
    ┌───────────┐
    │ Resolved  │ ──→ Webhooks / Slack / Discord
    └─────┬─────┘
          │ failure_rate ≥ 0.20
          ▼
   ┌──────────────┐
   │  New Alert   │ (new alert_id)
   └──────────────┘
```

### Rules

- **Only one active alert** at any time
- Continuous breaches do **not** create duplicate alerts
- Recovery **resolves** the active alert
- Re-breach creates a **new alert** with a new ID
- All systems (API, webhooks, integrations) must agree on failed proxy IDs

---

## 📁 Project Structure

```
ProxyMaze_Challenge/
├── src/
│   ├── server.js              # Express app bootstrap
│   ├── routes/
│   │   ├── health.js          # GET /health
│   │   ├── config.js          # POST/GET /config
│   │   ├── proxies.js         # CRUD /proxies
│   │   ├── alerts.js          # GET /alerts
│   │   ├── webhooks.js        # POST /webhooks
│   │   ├── integrations.js    # POST /integrations
│   │   └── metrics.js         # GET /metrics
│   ├── services/
│   │   ├── monitoringEngine.js    # Core monitoring loop
│   │   ├── alertManager.js        # Alert lifecycle logic
│   │   ├── notificationEngine.js  # Webhook + integration delivery
│   │   └── proxyChecker.js        # HTTP probe logic
│   ├── store/
│   │   └── dataStore.js       # In-memory state management
│   └── utils/
│       ├── proxyIdParser.js   # URL → proxy ID extraction
│       └── timestamps.js      # ISO 8601 UTC helpers
├── tests/
│   ├── health.test.js
│   ├── config.test.js
│   ├── proxies.test.js
│   ├── alerts.test.js
│   └── webhooks.test.js
├── docs/
│   ├── API.md                 # Full API reference
│   ├── ARCHITECTURE.md        # System architecture
│   └── TASKS.md               # Team task assignments
├── package.json
├── .gitignore
└── README.md
```

---

## 👥 Team

| Member | Role | Focus Area |
|---|---|---|
| **Hassan** | API Layer | REST endpoints, routing, request validation |
| **Mushaf** | Monitoring Engine | Proxy health checking, scheduling, state tracking |
| **Hammad** | Alert System & Notifications | Alert lifecycle, webhooks, Slack/Discord |
| **Ridhushan** | Data Layer & Observability | Data store, metrics, history, testing |

> See [docs/TASKS.md](docs/TASKS.md) for the detailed task breakdown.

---

## 📚 Documentation

| Document | Description |
|---|---|
| [API Reference](docs/API.md) | Complete endpoint documentation with examples |
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, component details |
| [Task Assignments](docs/TASKS.md) | Per-member task breakdown with priorities |

---

## 📊 Scoring

| Category | Points |
|---|---|
| Service bootstrap & configuration | 10 |
| Proxy pool ingestion & monitoring | 45 |
| Single failure behavior | 30 |
| Threshold breach alerts & delivery | 90 |
| Alert resolution | 20 |
| Re-breach lifecycle integrity | 30 |
| Pool operations & observability | 25 |
| **Core Total** | **250** |
| Slack Integration Bonus | +10 |
| Discord Integration Bonus | +10 |
| **Maximum Score** | **270** |
| **Passing Score** | **186** |

---

## 📜 License

This project is built for the Torch Labs Sri Lanka 2026 Engineering Challenge.

---

<p align="center">
  <b>Torch Labs • Colombo, Sri Lanka • From Sri Lanka, to the world. 🇱🇰</b>
</p>