# ProxyMaze API Reference

This document is the canonical black-box evaluator contract for ProxyMaze'26.
All request and response bodies are JSON unless stated otherwise. All timestamps
must be ISO 8601 UTC strings such as `2026-04-24T10:15:30Z`.

## Global Rules

- The fixed pool failure threshold is `0.20`.
- Proxy IDs are deterministic: use the final path segment of the submitted URL.
  Example: `https://proxy-provider.example/proxy/px-101` -> `px-101`.
- Unknown fields in JSON object request bodies must be ignored cleanly.
- Reject genuinely malformed input, but do not fail only because extra fields are present.
- Read endpoints must report the latest background monitoring state. They must not trigger fresh probes.
- Proxy status must be derived from real HTTP probes only.
- A 2xx response within `request_timeout_ms` means `up`.
- Timeout, connection failure, connection refusal, or any 5xx response means `down`.

## 1. GET /health

Proof that the service is running.

Response `200 OK`:

```json
{
  "status": "ok"
}
```

## 2. POST /config

Sets the runtime monitoring configuration. Values apply immediately to all subsequent health checks.

Request:

```json
{
  "check_interval_seconds": 15,
  "request_timeout_ms": 3000
}
```

Response `200 OK`:

```json
{
  "check_interval_seconds": 15,
  "request_timeout_ms": 3000
}
```

## 3. GET /config

Returns the currently active runtime configuration.

Response `200 OK`:

```json
{
  "check_interval_seconds": 15,
  "request_timeout_ms": 3000
}
```

## 4. POST /proxies

Loads proxy URLs into the monitoring pool.

Request:

```json
{
  "proxies": [
    "https://proxy-provider.example/proxy/px-101",
    "https://proxy-provider.example/proxy/px-102"
  ],
  "replace": true
}
```

Rules:

- `replace` omitted or `false`: append the provided proxies to the current pool.
- `replace: true`: clear the current pool first, then load the provided proxies.
- Newly accepted proxies start as `pending` until their first background check completes.
- Replacing or clearing the pool must not delete previous alerts.
- Extra request fields must be ignored.

Response `201 Created`:

```json
{
  "accepted": 2,
  "proxies": [
    {
      "id": "px-101",
      "url": "https://proxy-provider.example/proxy/px-101",
      "status": "pending"
    },
    {
      "id": "px-102",
      "url": "https://proxy-provider.example/proxy/px-102",
      "status": "pending"
    }
  ]
}
```

## 5. GET /proxies

Returns the live pool summary and per-proxy state from the latest background checks.

Response `200 OK`:

```json
{
  "total": 10,
  "up": 7,
  "down": 3,
  "failure_rate": 0.3,
  "proxies": [
    {
      "id": "px-101",
      "url": "https://proxy-provider.example/proxy/px-101",
      "status": "up",
      "last_checked_at": "2026-04-24T10:15:30Z",
      "consecutive_failures": 0
    }
  ]
}
```

Each proxy entry must include at least `id`, `url`, `status`, `last_checked_at`,
and `consecutive_failures`.

## 6. GET /proxies/{id}

Returns details for a single proxy. Return `404 Not Found` for unknown IDs.

Response `200 OK`:

```json
{
  "id": "px-101",
  "url": "https://proxy-provider.example/proxy/px-101",
  "status": "up",
  "last_checked_at": "2026-04-24T10:15:30Z",
  "consecutive_failures": 0,
  "total_checks": 12,
  "uptime_percentage": 91.7,
  "history": [
    {
      "checked_at": "2026-04-24T10:15:30Z",
      "status": "up"
    }
  ]
}
```

Required fields are the five fields from `GET /proxies`, plus `total_checks`,
`uptime_percentage`, and `history`.

## 7. GET /proxies/{id}/history

Returns the check history for a single proxy. Return `404 Not Found` for unknown IDs.

Response `200 OK`:

```json
[
  {
    "checked_at": "2026-04-24T10:15:30Z",
    "status": "up"
  },
  {
    "checked_at": "2026-04-24T10:16:00Z",
    "status": "down"
  }
]
```

The response body must be a JSON array.

## 8. DELETE /proxies

Clears the current proxy pool.

Response `204 No Content`

Rules:

- The proxy pool becomes empty.
- Existing alerts remain accessible through `GET /alerts`.
- Alert history must not be deleted.

## 9. GET /alerts

Returns all alerts, both active and resolved.

Response `200 OK`:

```json
[
  {
    "alert_id": "alert-a1b2c3",
    "status": "active",
    "failure_rate": 0.3,
    "total_proxies": 10,
    "failed_proxies": 3,
    "failed_proxy_ids": ["px-103", "px-104", "px-105"],
    "threshold": 0.2,
    "fired_at": "2026-04-24T10:20:00Z",
    "resolved_at": null,
    "message": "Proxy pool failure rate exceeded threshold"
  }
]
```

Required alert fields:

- `alert_id`: non-empty and stable for the lifetime of the alert.
- `status`: `active` while the breach holds, `resolved` after recovery.
- `failure_rate`: the rate that justified the alert, at least `0.20`.
- `total_proxies`: the pool size at fire time.
- `failed_proxies`: count of proxies currently classified as `down`.
- `failed_proxy_ids`: IDs of proxies currently classified as `down`.
- `threshold`: `0.2`.
- `fired_at`: ISO 8601 UTC timestamp for the breach start.
- `resolved_at`: ISO 8601 UTC timestamp after recovery, otherwise `null`.
- `message`: short, non-empty human-readable summary.

Alert lifecycle rules:

- At most one alert is active at any time.
- A continuous breach keeps the same active alert and `alert_id`.
- After resolution, a fresh breach must mint a brand-new `alert_id`.
- Previously resolved alerts remain in the archive unchanged.

## 10. POST /webhooks

Registers a URL to receive alert webhook notifications.

Request:

```json
{
  "url": "https://receiver.example/proxywatch-webhook"
}
```

Response `201 Created`:

```json
{
  "webhook_id": "wh-123",
  "url": "https://receiver.example/proxywatch-webhook"
}
```

Extra request fields must be accepted and ignored.

### alert.fired Payload

```json
{
  "event": "alert.fired",
  "alert_id": "alert-a1b2c3",
  "fired_at": "2026-04-24T10:20:00Z",
  "failure_rate": 0.3,
  "total_proxies": 10,
  "failed_proxies": 3,
  "failed_proxy_ids": ["px-103", "px-104", "px-105"],
  "threshold": 0.2,
  "message": "Proxy pool failure rate exceeded threshold"
}
```

### alert.resolved Payload

```json
{
  "event": "alert.resolved",
  "alert_id": "alert-a1b2c3",
  "resolved_at": "2026-04-24T10:30:00Z"
}
```

Delivery requirements:

- Send each event with `Content-Type: application/json`.
- Deliver each event to every registered receiver within 60 seconds of the state transition.
- Retry transient receiver failures: `500`, `502`, `503`, or `504`.
- For each state transition, exactly one successful delivery must reach each receiver.
- Do not send duplicates while a breach persists.

## 11. POST /integrations

Registers a Slack or Discord formatted alert integration.

Response: `200 OK` or `201 Created`.

Slack request:

```json
{
  "type": "slack",
  "webhook_url": "https://receiver.example/slack",
  "username": "ProxyWatch",
  "events": ["alert.fired", "alert.resolved"]
}
```

Discord request:

```json
{
  "type": "discord",
  "webhook_url": "https://receiver.example/discord",
  "username": "ProxyWatch",
  "events": ["alert.fired", "alert.resolved"]
}
```

### Slack Bonus Payload

On every `alert.fired` and `alert.resolved` event, POST a Slack-style JSON payload
to the registered `webhook_url` within 60 seconds.

Required fields:

- `username`: non-empty string.
- `text`: non-empty event summary.
- `attachments[0].color`: hex string in `#RRGGBB` form.
- `attachments[0].fields`: array of `{ "title", "value" }` entries.
- Field titles must collectively include `Alert ID`, `Failure Rate`, `Failed Proxies`,
  `Threshold`, `Failed IDs`, and `Fired At` by case-insensitive substring match.
- `attachments[0].footer`: non-empty string.
- `attachments[0].ts`: Unix epoch timestamp as an integer number of seconds.

### Discord Bonus Payload

On every alert event, POST a Discord-style JSON payload to the registered
`webhook_url` within 60 seconds.

Required fields:

- `embeds[0].title`: non-empty string.
- `embeds[0].description`: non-empty event summary.
- `embeds[0].color`: integer from `0` to `16777215`.
- `embeds[0].fields`: array of `{ "name", "value" }` entries.
- Field names must collectively include `Alert ID`, `Failure Rate`, `Failed Proxies`,
  `Threshold`, and `Failed IDs` by case-insensitive substring match.
- `embeds[0].footer.text`: non-empty string.

## 12. GET /metrics

Returns operational monitoring data. The response body must be valid, non-empty JSON.

Response `200 OK`:

```json
{
  "total_checks": 120,
  "current_pool_size": 10,
  "active_alerts": 1,
  "total_alerts": 3,
  "webhook_deliveries": 4
}
```

## Cross-Endpoint Consistency

- `failed_proxy_ids` must always equal the set of proxies currently classified as `down`.
- `GET /proxies`, `GET /alerts`, and webhook payloads for an active breach must agree
  on failed proxy IDs, `total_proxies`, `failed_proxies`, and `threshold`.
- Webhook events must be observable in lifecycle order:
  `alert.fired`, then `alert.resolved`, then a new `alert.fired` for any later breach.
