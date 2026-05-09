# 📡 ProxyMaze API Reference

> **Base URL:** `http://localhost:3000` | **Content-Type:** `application/json` | **Timestamps:** ISO 8601 UTC

---

## 1. GET /health

**Response `200`:**
```json
{ "status": "ok" }
```

---

## 2. POST /config

**Request:**
```json
{ "check_interval_seconds": 15, "request_timeout_ms": 3000 }
```
**Response `200`:** Returns the updated config. Unknown fields are silently ignored.

---

## 3. GET /config

**Response `200`:** Returns currently active configuration object.

---

## 4. POST /proxies

**Request:**
```json
{
  "proxies": [
    "https://proxy-provider.example/proxy/px-101",
    "https://proxy-provider.example/proxy/px-102"
  ],
  "replace": true
}
```

| Field | Type | Description |
|---|---|---|
| `proxies` | `string[]` | Proxy URLs to monitor |
| `replace` | `boolean` | `true` = clear and replace, `false` = append |

- Proxy ID = final URL path segment (e.g. `px-101`)
- New proxies start as `pending`
- Monitoring begins automatically

**Response `200`:** Returns `{ total, proxies: [{ id, url, status }] }`

---

## 5. GET /proxies

**Response `200`:**
```json
{
  "total": 10, "up": 7, "down": 3, "failure_rate": 0.3,
  "proxies": [
    { "id": "px-101", "url": "...", "status": "up", "last_checked_at": "...", "consecutive_failures": 0 }
  ]
}
```

`failure_rate = down / total` (0 if total is 0)

---

## 6. GET /proxies/:id

Returns detailed proxy info including `total_checks`, `uptime_percentage`, and `history` array.

**404** for unknown IDs: `{ "error": "Proxy not found", "id": "..." }`

---

## 7. GET /proxies/:id/history

Returns monitoring history array: `[{ checked_at, status, response_time_ms }]`

---

## 8. DELETE /proxies

Clears the proxy pool. Alerts and history **survive** the purge.

**Response `200`:** `{ "message": "Proxy pool cleared", "cleared": 10 }`

---

## 9. GET /alerts

Returns all alerts (active + resolved).

**Alert fields:** `alert_id`, `status` (active/resolved), `failure_rate`, `total_proxies`, `failed_proxies`, `failed_proxy_ids`, `threshold` (0.20), `fired_at`, `resolved_at` (null if active), `message`

### Lifecycle Rules
- Only **one active alert** at a time
- Continuous breaches → no duplicates
- Recovery → resolves active alert
- Re-breach → **new alert_id**

---

## 10. POST /webhooks

**Request:** `{ "url": "https://receiver.example/proxywatch-webhook" }`

**Delivery rules:**
- JSON POST payload with alert data
- Retry on `500`, `502`, `503`, `504`
- No duplicate successful deliveries
- Deliver within **60 seconds**

---

## 11. POST /integrations

### Slack
```json
{ "type": "slack", "webhook_url": "...", "username": "ProxyWatch", "events": ["alert.fired", "alert.resolved"] }
```
**Payload:** `username`, `text`, `attachments` (with `color`, `fields`, `footer`, `ts`)

### Discord
```json
{ "type": "discord", "webhook_url": "...", "username": "ProxyWatch", "events": ["alert.fired", "alert.resolved"] }
```
**Payload:** `username`, `embeds` (with `title`, `description`, `color`, `fields`, `footer.text`)

---

## 12. GET /metrics

```json
{ "total_checks": 120, "current_pool_size": 10, "active_alerts": 1, "total_alerts": 3, "webhook_deliveries": 4 }
```

---

## General Rules

1. All timestamps → ISO 8601 UTC
2. Unknown JSON fields → silently ignored
3. Proxy IDs → deterministic from URL final path segment
4. Failure threshold → fixed at `0.20`
5. HTTP 2xx → `up` | Timeouts & 5xx → `down`
