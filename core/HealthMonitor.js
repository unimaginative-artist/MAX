// MAX HealthMonitor — self‑monitoring with auto‑repair

class HealthMonitor {
    constructor(maxInstance) {
        this.maxInstance = maxInstance;
        this.components = new Map(); // componentName → { status, failures, lastCheck, metrics, repairFn }
        this.metricsHistory = []; // rolling window of health snapshots
        this.MAX_FAILURES = 3; // circuit‑breaker threshold
        this.BACKOFF_BASE_MS = 2000; // exponential backoff base
    }

    // Register a component to monitor
    registerComponent(name, checkFn, repairFn = null) {
        this.components.set(name, {
            status: 'unknown', // 'healthy', 'degraded', 'failed'
            failures: 0,
            lastCheck: 0,
            metrics: {},
            checkFn,
            repairFn,
            lastFailure: null,
            backoffUntil: 0
        });
        console.log(`[HealthMonitor] Registered component: ${name}`);
    }

    // Run a single component check
    async checkComponent(name) {
        const comp = this.components.get(name);
        if (!comp) return;

        // If in backoff period, skip
        if (Date.now() < comp.backoffUntil) {
            console.log(`[HealthMonitor] ${name} in backoff, skipping`);
            return;
        }

        try {
            const result = await comp.checkFn();
            comp.lastCheck = Date.now();
            comp.metrics = result.metrics || {};

            if (result.healthy) {
                comp.status = 'healthy';
                comp.failures = 0; // reset on success
                comp.lastFailure = null;
            } else {
                comp.status = 'degraded';
                comp.failures++;
                comp.lastFailure = Date.now();
                console.warn(`[HealthMonitor] ${name} degraded: ${result.reason || 'unknown'}`);
            }
        } catch (err) {
            comp.status = 'failed';
            comp.failures++;
            comp.lastFailure = Date.now();
            comp.metrics.error = err.message;
            console.error(`[HealthMonitor] ${name} check threw:`, err.message);
        }

        // Circuit‑breaker: if failures >= threshold, trigger repair
        if (comp.failures >= this.MAX_FAILURES && comp.repairFn) {
            this.triggerRepair(name, comp);
        }
    }

    // Trigger repair with exponential backoff
    async triggerRepair(name, comp) {
        const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, comp.failures - this.MAX_FAILURES);
        comp.backoffUntil = Date.now() + backoffMs;
        console.log(`[HealthMonitor] ${name} failures=${comp.failures}, triggering repair, backoff ${backoffMs}ms`);
        try {
            await comp.repairFn();
            comp.failures = 0; // reset after repair attempt
            comp.status = 'healthy';
            comp.backoffUntil = 0;
            console.log(`[HealthMonitor] ${name} repair succeeded`);
        } catch (err) {
            console.error(`[HealthMonitor] ${name} repair failed:`, err.message);
            // Backoff already set, will retry later
        }
    }

    // Run all component checks (call from heartbeat)
    async runChecks() {
        const start = Date.now();
        const promises = [];
        for (const name of this.components.keys()) {
            promises.push(this.checkComponent(name));
        }
        await Promise.allSettled(promises);
        // Store snapshot
        this.metricsHistory.push({
            timestamp: start,
            components: Array.from(this.components.entries()).map(([name, comp]) => ({
                name,
                status: comp.status,
                failures: comp.failures,
                metrics: comp.metrics
            }))
        });
        // Keep last 100 snapshots
        if (this.metricsHistory.length > 100) this.metricsHistory.shift();
    }

    // Get overall health score (0‑100)
    getHealthScore() {
        let healthy = 0, total = 0;
        for (const comp of this.components.values()) {
            total++;
            if (comp.status === 'healthy') healthy++;
        }
        return total === 0 ? 100 : Math.round((healthy / total) * 100);
    }

    // Get dashboard data
    getDashboard() {
        return {
            timestamp: Date.now(),
            healthScore: this.getHealthScore(),
            components: Array.from(this.components.entries()).map(([name, comp]) => ({
                name,
                status: comp.status,
                failures: comp.failures,
                lastCheck: comp.lastCheck,
                lastFailure: comp.lastFailure,
                backoffUntil: comp.backoffUntil,
                metrics: comp.metrics
            })),
            historySize: this.metricsHistory.length
        };
    }
}

module.exports = HealthMonitor;