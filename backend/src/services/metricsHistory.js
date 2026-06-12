// ============================================================
// A1TV v2 — Historical Stream Metrics Service
// Aggregates health check data into hourly buckets for
// trend analysis, degradation detection, and better scoring.
// ============================================================

const db = require('../config/database');

class MetricsHistoryService {
    /**
     * Aggregate the last hour's health check data into
     * stream_metrics_hourly. Run every hour via cron.
     */
    async aggregateHourly() {
        const hour = new Date();
        hour.setMinutes(0, 0, 0);

        console.log(`[Metrics] Aggregating hourly metrics for ${hour.toISOString()}...`);

        const results = await db.raw(`
            INSERT INTO stream_metrics_hourly (
                id, stream_id, channel_id, host_id, hour,
                checks_total, checks_online, checks_offline,
                uptime_pct, avg_latency, min_latency, max_latency,
                latency_stddev, score_avg, score_min, score_max,
                error_count, geo_block_count
            )
            SELECT
                uuid_generate_v4(),
                h.stream_id,
                s.channel_id,
                s.host_id,
                date_trunc('hour', NOW()),
                COUNT(*),
                COUNT(*) FILTER (WHERE h.status IN ('online', 'slow')),
                COUNT(*) FILTER (WHERE h.status IN ('offline', 'invalid')),
                ROUND((COUNT(*) FILTER (WHERE h.status IN ('online', 'slow'))::numeric / NULLIF(COUNT(*), 0) * 100), 2),
                AVG(h.response_time)::int,
                MIN(h.response_time),
                MAX(h.response_time),
                STDDEV(h.response_time)::int,
                AVG(s.score)::int,
                MIN(s.score),
                MAX(s.score),
                COUNT(*) FILTER (WHERE h.error_message IS NOT NULL),
                COUNT(*) FILTER (WHERE h.status = 'geo_blocked')
            FROM health_check_log h
            JOIN streams s ON h.stream_id = s.id
            WHERE h.checked_at >= date_trunc('hour', NOW() - INTERVAL '1 hour')
            AND h.checked_at < date_trunc('hour', NOW())
            GROUP BY h.stream_id, s.channel_id, s.host_id
            ON CONFLICT DO NOTHING
        `);

        console.log('[Metrics] Hourly aggregation complete');
        return results;
    }

    /**
     * Get trend data for a stream (last 24 hours).
     */
    async getStreamTrend(streamId, hours = 24) {
        return db('stream_metrics_hourly')
            .where({ stream_id: streamId })
            .where('hour', '>', new Date(Date.now() - hours * 60 * 60 * 1000))
            .orderBy('hour', 'asc')
            .select('hour', 'uptime_pct', 'avg_latency', 'score_avg', 'checks_total', 'error_count');
    }

    /**
     * Detect degrading streams (declining score over 6 hours).
     */
    async detectDegradingStreams() {
        return db.raw(`
            WITH recent AS (
                SELECT stream_id,
                    AVG(score_avg) FILTER (WHERE hour > NOW() - INTERVAL '3 hours') as recent_avg,
                    AVG(score_avg) FILTER (WHERE hour <= NOW() - INTERVAL '3 hours'
                        AND hour > NOW() - INTERVAL '6 hours') as earlier_avg
                FROM stream_metrics_hourly
                WHERE hour > NOW() - INTERVAL '6 hours'
                GROUP BY stream_id
                HAVING COUNT(DISTINCT hour) >= 2
            )
            SELECT r.stream_id, s.url, c.name as channel_name,
                r.earlier_avg, r.recent_avg,
                (r.earlier_avg - r.recent_avg) as score_drop
            FROM recent r
            JOIN streams s ON r.stream_id = s.id
            JOIN channels c ON s.channel_id = c.id
            WHERE r.recent_avg < r.earlier_avg - 15
            ORDER BY score_drop DESC
            LIMIT 50
        `);
    }

    /**
     * Get platform-wide metrics summary.
     */
    async getPlatformMetrics() {
        const [today, lastHour, topStreams] = await Promise.all([
            // Today's aggregates
            db('stream_metrics_hourly')
                .where('hour', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
                .select(
                    db.raw('SUM(checks_total) as total_checks'),
                    db.raw('AVG(uptime_pct)::numeric(5,1) as avg_uptime'),
                    db.raw('AVG(avg_latency)::int as avg_latency'),
                    db.raw('AVG(score_avg)::int as avg_score'),
                ).first(),

            // Last hour
            db('stream_metrics_hourly')
                .where('hour', '>', new Date(Date.now() - 60 * 60 * 1000))
                .select(
                    db.raw('SUM(checks_total) as checks'),
                    db.raw('AVG(uptime_pct)::numeric(5,1) as uptime'),
                ).first(),

            // Top streams by score
            db('streams')
                .where('is_active', true)
                .whereIn('status', ['online', 'slow'])
                .orderBy('score', 'desc')
                .limit(10)
                .select('id', 'quality', 'score', 'uptime_pct', 'avg_latency'),
        ]);

        return { today, lastHour, topStreams };
    }

    /**
     * Cleanup old metrics (keep 90 days).
     */
    async cleanup() {
        const deleted = await db('stream_metrics_hourly')
            .where('hour', '<', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
            .delete();
        console.log(`[Metrics] Cleaned up ${deleted} old metric records`);
        return deleted;
    }
}

module.exports = new MetricsHistoryService();
