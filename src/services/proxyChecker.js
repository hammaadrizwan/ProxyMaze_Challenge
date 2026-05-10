/**
 * proxyChecker.js
 *
 * Performs real HTTP probes against proxy URLs and classifies their status.
 *
 * Classification rules (per spec):
 *   - 2xx response within request_timeout_ms  →  "up"
 *   - Timeout, connection failure/refusal      →  "down"
 *   - Any 5xx response                         →  "down"
 *   - Any other non-2xx (3xx, 4xx)             →  "down"  (safe default)
 *
 * Uses axios so that 5xx responses are received as responses (not throws),
 * and timeouts / connection errors are caught as errors.
 */
 
const axios = require('axios');
 
const DEFAULT_TIMEOUT_MS = 3000;
 
const PROXY_STATUS = Object.freeze({
  UP:   'up',
  DOWN: 'down',
});
 
function normalizeTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
 
function nowIso(now) {
  return now().toISOString();
}
 
/**
 * Classify an HTTP status code.
 * 2xx → up; everything else → down.
 */
function classifyStatus(statusCode) {
  return statusCode >= 200 && statusCode < 300 ? PROXY_STATUS.UP : PROXY_STATUS.DOWN;
}
 
/**
 * Map an axios error to a reason string.
 */
function errorReason(error) {
  if (!error) return 'connection_failure';
 
  // axios timeout
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return 'timeout';
  }
 
  // Connection refused, DNS failure, network error
  if (
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET' ||
    error.code === 'EHOSTUNREACH' ||
    error.code === 'ENETUNREACH'
  ) {
    return 'connection_failure';
  }
 
  return 'connection_failure';
}
 
/**
 * Probe a single proxy URL.
 *
 * @param {string} url - The proxy URL to probe.
 * @param {object} options
 * @param {number} [options.request_timeout_ms=3000]
 * @param {Function} [options.now=() => new Date()]
 *
 * @returns {Promise<{ status: 'up'|'down', checked_at: string, response_time_ms: number, http_status?: number, error?: string }>}
 */
async function checkProxy(
  url,
  {
    request_timeout_ms = DEFAULT_TIMEOUT_MS,
    now                = () => new Date(),
  } = {},
) {
  const timeoutMs  = normalizeTimeout(request_timeout_ms);
  const startedAt  = Date.now();
 
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      // Accept all status codes so we can classify them ourselves
      validateStatus: () => true,
      // Don't follow redirects — a redirect could mask a down proxy
      maxRedirects: 5,
    });
 
    const response_time_ms = Date.now() - startedAt;
    const status = classifyStatus(response.status);
 
    return {
      status,
      checked_at:        nowIso(now),
      response_time_ms,
      http_status:       response.status,
    };
  } catch (error) {
    return {
      status:            PROXY_STATUS.DOWN,
      checked_at:        nowIso(now),
      response_time_ms:  Date.now() - startedAt,
      error:             errorReason(error),
    };
  }
}
 
module.exports = { PROXY_STATUS, checkProxy };