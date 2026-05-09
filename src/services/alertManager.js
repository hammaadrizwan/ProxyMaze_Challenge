/**
 * alertManager.js
 * Finite state machine for alert lifecycle:
 *   NORMAL → rate ≥ 0.20 → ACTIVE → rate < 0.20 → RESOLVED → re-breach → NEW ALERT
 *
 * Invariants:
 *   - Max 1 active alert at any time
 *   - Continuous breaches do NOT create duplicates
 *   - Recovery then re-breach creates a NEW alert_id
 */

const store = require('../store/dataStore');
const notifications = require('./notificationEngine');

const THRESHOLD = 0.20;

/**
 * Called after every monitoring cycle with the fresh failure rate.
 * Decides whether to fire, update, or resolve alerts.
 */
async function evaluate() {
  const { total, down, failure_rate } = store.getProxyPoolSummary();
  const failedIds = store.getFailedProxyIds();
  const activeAlert = store.getActiveAlert();

  if (failure_rate >= THRESHOLD) {
    // ── Breach ──
    if (!activeAlert) {
      // No active alert → fire one
      const alert = store.createAlert(failure_rate, total, down, failedIds);
      console.log(`[AlertManager] 🚨 FIRED ${alert.alert_id} | rate=${failure_rate.toFixed(2)}`);
      await notifications.dispatch('alert.fired', alert);
    }
    // Active alert already exists → do nothing (no duplicates)
  } else {
    // ── Below threshold ──
    if (activeAlert) {
      const resolved = store.resolveAlert(activeAlert.alert_id);
      console.log(`[AlertManager] ✅ RESOLVED ${resolved.alert_id} | rate=${failure_rate.toFixed(2)}`);
      await notifications.dispatch('alert.resolved', resolved);
    }
  }
}

module.exports = { evaluate, THRESHOLD };
