/**
 * proxyIdParser.js
 * Extracts a deterministic proxy ID from the final URL path segment.
 * e.g. "https://proxy-provider.example/proxy/px-101" → "px-101"
 */

function extractProxyId(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || url;
  } catch {
    // Fallback: grab everything after the last '/'
    const parts = url.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  }
}

module.exports = { extractProxyId };
