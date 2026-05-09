/**
 * timestamps.js
 * ISO 8601 UTC timestamp helpers.
 */

function nowISO() {
  return new Date().toISOString();
}

function toUnixSeconds(isoString) {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

module.exports = { nowISO, toUnixSeconds };
