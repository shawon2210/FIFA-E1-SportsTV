// ============================================================
// A1TV v2 — Circuit Breaker Service (Stream Host Monitoring)
// Tracks per-domain health and opens circuits for failing hosts.
// Prevents wasting resources checking hundreds of dead streams
// from the same provider.
// ============================================================

const db = require('../config/database');

class CircuitBreakerService {
    constructor() {
        this.thresholds = {
            degradedFailureRate: 50,    // % failures to mark degraded
            downFailureRate: 80,        // % failures to mark down
            minStreamsForCheck: 3,      // Minimum streams before circuit opens
            degradedLatency: 5000,      // ms average latency for degraded
            downLatency: 10000,         // ms average latency for down
        };
    }

    /**
     * Extract host from a stream URL and ensure it exists in DB.
     */
    async getOrCreateHost(url) {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname;
            const domain = host.replace(/^www\./, '');

            const existing = await db('stream_hosts').where('host', host).first();
            if (existing) return existing;

            const [created] = await db('stream_hosts')
                .insert({ host, domain, status: 'healthy' })
                .returning('*');
            return created;
        } catch {
            return null;
        }
    }

    /**
     * Update host statistics after a health check.
     * Called from the HealthChecker after each stream check.
     */
    async updateHostStats(hostId) {
        if (!hostId) return;

        const stats = await db('streams')
            .where({ host_id: hostId, is_active: true })
            .select(
                db.raw('COUNT(*) as total'),
                db.raw("COUNT(*) FILTER (WHERE status IN ('online','slow')) as online"),
                db.raw("COUNT(*) FILTER (WHERE status IN ('offline','geo_blocked','invalid')) as offline"),
                db.raw('AVG(response_time) FILTER (WHERE status IN (\'online\',\'slow\')) as avg_latency'),
            )
            .first();

        if (!stats || parseInt(stats.total) < this.thresholds.minStreamsForCheck) return;

        const total = parseInt(stats.total);
        const offline = parseInt(stats.offline);
        const failureRate = total > 0 ? (offline / total) * 100 : 0;
        const avgLatency = Math.round(parseFloat(stats.avg_latency) || 0);

        // Determine new status
        let newStatus = 'healthy';
        if (failureRate >= this.thresholds.downFailureRate || avgLatency > this.thresholds.downLatency) {
            newStatus = 'down';
        } else if (failureRate >= this.thresholds.degradedFailureRate || avgLatency > this.thresholds.degradedLatency) {
            newStatus = 'degraded';
        }

        const update = {
            total_streams: total,
            online_streams: parseInt(stats.online),
            failure_rate: failureRate,
            avg_latency: avgLatency,
            last_checked: new Date(),
            status: newStatus,
            updated_at: new Date(),
        };

        if (newStatus !== 'healthy') {
            const host = await db('stream_hosts').where('id', hostId).first();
            if (host?.status === 'healthy') {
                update.first_failure = new Date(); // Mark degradation start
            }
        }

        await db('stream_hosts').where('id', hostId).update(update);

        // Stream hosts marked "down" — pause health checks on their streams
        if (newStatus === 'down') {
            await db('streams')
                .where({ host_id: hostId, is_active: true })
                .update({ check_interval: 3600 }); // Reduce to 1 hour
        }
    }

    /**
     * Get hosts that are currently degraded or down.
     * Used for admin dashboard and alerting.
     */
    async getFailingHosts() {
        return db('stream_hosts')
            .whereIn('status', ['degraded', 'down'])
            .orderBy('failure_rate', 'desc')
            .select('*');
    }

    /**
     * Check if a host's circuit is open (blocking checks).
     */
    isCircuitOpen(hostStatus) {
        return hostStatus === 'down';
    }

    /**
     * Ban a host entirely (admin action).
     */
    async banHost(hostId, reason) {
        await db('stream_hosts').where('id', hostId).update({
            status: 'banned',
            metadata: db.raw(`metadata || '{"ban_reason": "${reason}"}'::jsonb`),
            updated_at: new Date(),
        });

        // Deactivate all streams on this host
        await db('streams')
            .where({ host_id: hostId, is_active: true })
            .update({ is_active: false, updated_at: new Date() });
    }

    /**
     * Get circuit breaker statistics.
     */
    async getStats() {
        return db('stream_hosts')
            .select(
                db.raw('COUNT(*) as total_hosts'),
                db.raw("COUNT(*) FILTER (WHERE status = 'healthy') as healthy"),
                db.raw("COUNT(*) FILTER (WHERE status = 'degraded') as degraded"),
                db.raw("COUNT(*) FILTER (WHERE status = 'down') as down"),
                db.raw("COUNT(*) FILTER (WHERE status = 'banned') as banned"),
                db.raw('AVG(failure_rate)::numeric(5,2) as avg_failure_rate'),
                db.raw('SUM(total_streams) as total_streams_affected'),
                db.raw('SUM(online_streams) as online_streams'),
            )
            .first();
    }
}

module.exports = new CircuitBreakerService();
