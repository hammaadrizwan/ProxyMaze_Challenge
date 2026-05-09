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

async function evaluate(snapshot) {
  // Use the snapshot passed by the monitoring engine
  // Fall back to store if no snapshot provided (backward compat)
  let failure_rate, total, down, failedIds;
  
  if (snapshot && snapshot.failure_rate !== undefined) {
    failure_rate = snapshot.failure_rate;
    total = snapshot.total_proxies;
    down = snapshot.failed_proxies;
    failedIds = snapshot.failed_proxy_ids;
  } else {
    const summary = store.getProxyPoolSummary();
    failure_rate = summary.failure_rate;
    total = summary.total;
    down = summary.down;
    failedIds = store.getFailedProxyIds();
  }

  const activeAlert = store.getActiveAlert();

  if (failure_rate >= THRESHOLD) {
    if (!activeAlert) {
      const alert = store.createAlert(failure_rate, total, down, failedIds);
      console.log(`[AlertManager] 🚨 FIRED ${alert.alert_id} | rate=${failure_rate.toFixed(2)}`);
      await notifications.dispatch('alert.fired', alert);
    }
  } else {
    if (activeAlert) {
      const resolved = store.resolveAlert(activeAlert.alert_id);
      console.log(`[AlertManager] ✅ RESOLVED ${resolved.alert_id} | rate=${failure_rate.toFixed(2)}`);
      await notifications.dispatch('alert.resolved', resolved);
    }
  }
}

module.exports = { evaluate, THRESHOLD };
