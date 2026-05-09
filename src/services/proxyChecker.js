const DEFAULT_TIMEOUT_MS = 3000;

export const PROXY_STATUS = Object.freeze({
  UP: "up",
  DOWN: "down",
});

function normalizeTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function nowIso(now) {
  return now().toISOString();
}

function createAbortController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

function responseStatus(statusCode) {
  return statusCode >= 200 && statusCode <= 299
    ? PROXY_STATUS.UP
    : PROXY_STATUS.DOWN;
}

function errorReason(error) {
  if (error?.name === "AbortError") {
    return "timeout";
  }
  return "connection_failure";
}

export async function checkProxy(
  url,
  {
    request_timeout_ms = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    method = "GET",
    now = () => new Date(),
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("checkProxy requires a fetch implementation");
  }

  const timeoutMs = normalizeTimeout(request_timeout_ms);
  const startedAt = Date.now();
  const { controller, timeout } = createAbortController(timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      signal: controller.signal,
    });
    const response_time_ms = Date.now() - startedAt;
    const status = responseStatus(response.status);

    return {
      status,
      checked_at: nowIso(now),
      response_time_ms,
      http_status: response.status,
    };
  } catch (error) {
    return {
      status: PROXY_STATUS.DOWN,
      checked_at: nowIso(now),
      response_time_ms: Date.now() - startedAt,
      error: errorReason(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default checkProxy;
