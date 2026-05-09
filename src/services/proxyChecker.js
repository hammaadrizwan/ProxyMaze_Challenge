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
 */
 
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
 * Map an AbortError or network error to a reason string.
 */
function errorReason(error) {
  if (!error) return 'unknown';
  const name = error.name || '';
  const code = error.code || '';
  const msg  = (error.message || '').toLowerCase();
 
  if (name === 'AbortError' || msg.includes('abort')) return 'timeout';
  if (code === 'ECONNREFUSED' || msg.includes('connect')) return 'connection_failure';
  if (code === 'ENOTFOUND' || msg.includes('network') || msg.includes('fetch')) return 'connection_failure';
  return 'connection_failure';
}
 
/**
 * Probe a single proxy URL.
 *
 * @param {string} url - The proxy URL to probe.
 * @param {object} options
 * @param {number} [options.request_timeout_ms=3000]
 * @param {Function} [options.fetchImpl=globalThis.fetch]
 * @param {string}   [options.method='GET']
 * @param {Function} [options.now=() => new Date()]
 *
 * @returns {Promise<{ status: 'up'|'down', checked_at: string, response_time_ms: number, http_status?: number, error?: string }>}
 */
async function checkProxy(
  url,
  {
    request_timeout_ms = DEFAULT_TIMEOUT_MS,
    fetchImpl          = globalThis.fetch,
    method             = 'GET',
    now                = () => new Date(),
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('checkProxy requires a fetch implementation');
  }
 
  const timeoutMs   = normalizeTimeout(request_timeout_ms);
  const startedAt   = Date.now();
  const controller  = new AbortController();
  const timer       = setTimeout(() => controller.abort(), timeoutMs);
 
  try {
    const response       = await fetchImpl(url, { method, signal: controller.signal });
    const response_time_ms = Date.now() - startedAt;
    const status         = classifyStatus(response.status);
 
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
  } finally {
    clearTimeout(timer);
  }
}
 
module.exports = { PROXY_STATUS, checkProxy };