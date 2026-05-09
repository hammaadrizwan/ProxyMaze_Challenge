export const dataStore = {
    config: {
        check_interval_seconds: 15,
        request_timeout_ms: 3000
    },

    proxies: new Map(),

    alerts: [],

    webhooks: [],

    integrations: [],

    metrics: {
        total_checks: 0,
        webhook_deliveries: 0
    }
};

/*
|--------------------------------------------------------------------------
| Proxy Methods
|--------------------------------------------------------------------------
*/

export function addProxy(proxy) {
    dataStore.proxies.set(proxy.id, proxy);
}

export function getProxy(id) {
    return dataStore.proxies.get(id);
}

export function getAllProxies() {
    return Array.from(dataStore.proxies.values());
}

export function clearProxies() {
    dataStore.proxies.clear();
}

export function updateProxy(id, updates) {
    const proxy = dataStore.proxies.get(id);

    if (!proxy) {
        return null;
    }

    const updatedProxy = {
        ...proxy,
        ...updates
    };

    dataStore.proxies.set(id, updatedProxy);

    return updatedProxy;
}

/*
|--------------------------------------------------------------------------
| Alert Methods
|--------------------------------------------------------------------------
*/

export function addAlert(alert) {
    dataStore.alerts.push(alert);
}

export function getAlerts() {
    return dataStore.alerts;
}

export function getActiveAlert() {
    return dataStore.alerts.find(
        (alert) => alert.status === "active"
    );
}

/*
|--------------------------------------------------------------------------
| Webhook Methods
|--------------------------------------------------------------------------
*/

export function addWebhook(webhook) {
    dataStore.webhooks.push(webhook);
}

export function getWebhooks() {
    return dataStore.webhooks;
}

/*
|--------------------------------------------------------------------------
| Integration Methods
|--------------------------------------------------------------------------
*/

export function addIntegration(integration) {
    dataStore.integrations.push(integration);
}

export function getIntegrations() {
    return dataStore.integrations;
}

/*
|--------------------------------------------------------------------------
| Metrics Methods
|--------------------------------------------------------------------------
*/

export function incrementTotalChecks() {
    dataStore.metrics.total_checks += 1;
}

export function incrementWebhookDeliveries() {
    dataStore.metrics.webhook_deliveries += 1;
}

export function getMetrics() {
    return {
        total_checks: dataStore.metrics.total_checks,
        current_pool_size: dataStore.proxies.size,
        active_alerts: dataStore.alerts.filter(
            (alert) => alert.status === "active"
        ).length,
        total_alerts: dataStore.alerts.length,
        webhook_deliveries: dataStore.metrics.webhook_deliveries
    };
}