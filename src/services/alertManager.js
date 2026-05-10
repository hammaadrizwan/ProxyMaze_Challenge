/**
 * alertManager.js
 *
 * Finite-state machine for the alert lifecycle:
 *   NORMAL ──(rate ≥ 0.20)──► ACTIVE ──(rate < 0.20)──► RESOLVED ──(rate ≥ 0.20)──► NEW ALERT
 *
 * Invariants enforced here:
 *   - At most ONE alert is active at any time.
 *   - A continuous breach keeps the same alert_id (no duplicates).
 *   - After resolution a fresh breach mints a brand-new alert_id.
 *   - Active alert's failed_proxy_ids is updated every cycle so GET /alerts
 *     always agrees with GET /proxies (consistency requirement).
 *   - dispatch() is awaited so webhook delivery completes within the cycle.
 */
 
const store = require('../store/dataStore');
const notifications = require('./notificationEngine');
 
const THRESHOLD = 0.20;
 
/**
 * Called by the monitoring engine after every probe cycle.
 *
 * @param {object} snapshot - Fresh snapshot from the engine:
 *   { failure_rate, total_proxies, failed_proxies, failed_proxy_ids }
 */
async function evaluate(snapshot) {
  let failure_rate, total_proxies, failed_proxies, failed_proxy_ids;
 
  if (snapshot && typeof snapshot.failure_rate === 'number') {
    ({ failure_rate, total_proxies, failed_proxies, failed_proxy_ids } = snapshot);
  } else {
    const summary = store.getProxyPoolSummary();
    failure_rate     = summary.failure_rate;
    total_proxies    = summary.total;
    failed_proxies   = summary.down;
    failed_proxy_ids = store.getFailedProxyIds();
  }
 
  const activeAlert = store.getActiveAlert();
 
  if (failure_rate >= THRESHOLD) {
    // ── Threshold breached ──────────────────────────────────────────────────
    if (!activeAlert) {
      // No active alert — fire a new one.
      const alert = store.createAlert(failure_rate, total_proxies, failed_proxies, failed_proxy_ids);
      console.log(`[AlertManager] 🚨 FIRED ${alert.alert_id} | rate=${failure_rate.toFixed(4)} | down=${failed_proxies}/${total_proxies}`);
      await notifications.dispatch('alert.fired', alert);
    } else {
      // Active alert persists — update its live fields so all readers stay consistent.
      store.updateActiveAlert(failure_rate, total_proxies, failed_proxies, failed_proxy_ids);
      console.log(`[AlertManager] ⚠  Breach continues (${activeAlert.alert_id}) | rate=${failure_rate.toFixed(4)}`);
    }
  } else {
    // ── Below threshold ─────────────────────────────────────────────────────
    if (activeAlert) {
      const resolved = store.resolveAlert(activeAlert.alert_id);
      console.log(`[AlertManager] ✅ RESOLVED ${resolved.alert_id} | rate=${failure_rate.toFixed(4)}`);
      await notifications.dispatch('alert.resolved', resolved);
    }
  }
}
 
module.exports = { evaluate, THRESHOLD };