/**
 * proxyChecker.js
 *
 * Performs real HTTP probes against proxy URLs and classifies their status.
 *
 * Classification rules (per spec):
 *   - 2xx response within request_timeout_ms  →  "up"
 *   - Timeout, connection failure/refusal      →  "down"
 *   - Any 5xx response                         →  "down"
 *   - HTTP 408 Request Timeout                 →  "down" (timeout as status, not axios abort)
 *   - Other 3xx/4xx                            →  "up" (terminal response after optional redirects)
 *
 * Redirects: follow up to MAX_REDIRECT_HOPS manually (maxRedirects: 0 per hop) so a chain
 * like 302 → 503 is classified as down. Stopping at the first 302 would wrongly mark those mocks "up"
 * and break failure-rate / alert phases.
 */

const axios = require('axios');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

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
 * Classify an HTTP status code per docs/API.md:
 *   - 2xx → up
 *   - 5xx → down
 *   - 408 Request Timeout → down (evaluator “timeout” path may return 408 instead of aborting)
 */
function classifyHttpStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return PROXY_STATUS.UP;
  if (statusCode === 408) return PROXY_STATUS.DOWN;
  if (statusCode >= 500 && statusCode < 600) return PROXY_STATUS.DOWN;
  return PROXY_STATUS.UP;
}

/**
 * Map an axios error to a reason string.
 */
function errorReason(error) {
  if (!error) return 'connection_failure';

  if (
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.message?.includes('timeout')
  ) {
    return 'timeout';
  }

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
  const timeoutMs = normalizeTimeout(request_timeout_ms);
  const startedAt = Date.now();
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    try {
      const response = await axios.get(currentUrl, {
        timeout: timeoutMs,
        validateStatus: () => true,
        maxRedirects: 0,
      });

      const location = response.headers?.location;
      if (
        location &&
        REDIRECT_STATUSES.has(response.status)
      ) {
        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch {
          return {
            status:           PROXY_STATUS.DOWN,
            checked_at:       nowIso(now),
            response_time_ms: Date.now() - startedAt,
            error:            'connection_failure',
          };
        }
        continue;
      }

      const response_time_ms = Date.now() - startedAt;
      const status = classifyHttpStatus(response.status);

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

  return {
    status:            PROXY_STATUS.DOWN,
    checked_at:        nowIso(now),
    response_time_ms:  Date.now() - startedAt,
    error:             'connection_failure',
  };
}

module.exports = { PROXY_STATUS, checkProxy };
