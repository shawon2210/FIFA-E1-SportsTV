// ============================================================
// A1TV v2 — Stream Scoring Engine
// Composite score: uptime 40%, latency 20%, success 30%, resolution 10%
// ============================================================

const db = require('../config/database');
const config = require('../config');

class StreamScoringService {
    constructor() {
        this.weights = config.scoring.weights;
        this.resScores = config.scoring.resolutionScores;
        this.maxFailures = config.healthCheck.maxFailures;
    }

    async recalculateAll() {
        console.log('[Scoring] Recalculating all stream scores...');
        const start = Date.now();

        const streams = await db.raw(`
            SELECT s.*,
                (SELECT COUNT(*) FROM health_check_log h
                 WHERE h.stream_id = s.id AND h.checked_at > NOW() - INTERVAL '24 hours') as total_24h,
                (SELECT COUNT(*) FROM health_check_log h
                 WHERE h.stream_id = s.id AND h.status IN ('online','slow') AND h.checked_at > NOW() - INTERVAL '24 hours') as success_24h,
                (SELECT AVG(response_time) FROM health_check_log h
                 WHERE h.stream_id = s.id AND h.status IN ('online','slow') AND h.checked_at > NOW() - INTERVAL '24 hours') as avg_latency_24h,
                (SELECT STDDEV(response_time) FROM health_check_log h
                 WHERE h.stream_id = s.id AND h.status IN ('online','slow') AND h.checked_at > NOW() - INTERVAL '24 hours') as latency_stddev_24h
            FROM streams s WHERE s.is_active = true
        `);

        let updated = 0;
        for (const stream of streams.rows || []) {
            const score = this.calculate(stream);
            const total = parseInt(stream.total_24h) || 0;
            const success = parseInt(stream.success_24h) || 0;
            const uptimePct = total > 0 ? (success / total) * 100 : 0;
            const avgLatency = Math.round(parseFloat(stream.avg_latency_24h) || 0);

            // Stability: lower stddev = more stable (max 60 points)
            const stddev = parseFloat(stream.latency_stddev_24h) || 0;
            const stabilityScore = stddev === 0 ? 60 : Math.max(0, Math.round(60 - (stddev / 50)));

            await db('streams').where('id', stream.id).update({
                score, uptime_pct: uptimePct, avg_latency: avgLatency,
                success_rate: uptimePct, stability_score: stabilityScore,
                resolution_score: this.resScores[stream.quality] || 50,
                last_scored_at: new Date(),
            });
            updated++;
        }

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[Scoring] Updated ${updated} streams (${elapsed}s)`);
        return updated;
    }

    calculate(stream) {
        const total = parseInt(stream.total_24h) || 0;
        const success = parseInt(stream.success_24h) || 0;
        const avgLatency = Math.round(parseFloat(stream.avg_latency_24h) || 0);

        // Uptime score (0-100)
        const uptimeScore = total > 0 ? (success / total) * 100 : 0;

        // Latency score (0-100, inverted)
        let latencyScore = 50;
        if (avgLatency > 0) {
            if (avgLatency < 50) latencyScore = 100;
            else if (avgLatency < 200) latencyScore = 85;
            else if (avgLatency < 500) latencyScore = 60;
            else if (avgLatency < 1000) latencyScore = 30;
            else latencyScore = 10;
        }

        // Success rate (same as uptime but can be weighted differently)
        const successScore = uptimeScore;

        // Resolution score
        const resScore = this.resScores[stream.quality] || 50;

        const composite = Math.round(
            uptimeScore * this.weights.uptime +
            latencyScore * this.weights.latency +
            successScore * this.weights.successRate +
            resScore * this.weights.resolution
        );

        return Math.max(0, Math.min(100, composite));
    }

    async getBestStream(channelId) {
        return db('streams')
            .where({ channel_id: channelId, is_active: true })
            .whereIn('status', ['online', 'unknown'])
            .orderBy('score', 'desc')
            .orderBy('is_primary', 'desc')
            .first();
    }

    async getFailoverChain(channelId) {
        return db('streams')
            .where({ channel_id: channelId, is_active: true })
            .whereIn('status', ['online', 'unknown', 'slow'])
            .orderBy('score', 'desc')
            .select('id', 'url', 'quality', 'score', 'status');
    }

    async getStats() {
        return db('streams')
            .select(
                db.raw('COUNT(*) as total'),
                db.raw('AVG(score)::int as avg_score'),
                db.raw('AVG(uptime_pct)::numeric(5,1) as avg_uptime'),
                db.raw(`COUNT(*) FILTER (WHERE score >= 80) as excellent`),
                db.raw(`COUNT(*) FILTER (WHERE score >= 50 AND score < 80) as good`),
                db.raw(`COUNT(*) FILTER (WHERE score >= 20 AND score < 50) as poor`),
                db.raw(`COUNT(*) FILTER (WHERE score < 20) as bad`),
            )
            .where('is_active', true)
            .first();
    }
}

module.exports = new StreamScoringService();
