// A1TV v2 - Advanced Streaming Intelligence
// Stream Reliability Prediction, Auto Stream Ranking, Trust Scores

const db = require('../config/database');
const cache = require('../services/cache');

class StreamingIntelligence {
    /**
     * Calculate Stream Reliability Score (SRS).
     * Uses historical data to predict future reliability.
     *
     * Formula:
     *   SRS = (uptime_trend * 0.3)
     *       + (failure_rate_inverse * 0.25)
     *       + (latency_stability * 0.2)
     *       + (viewer_retention * 0.15)
     *       + (provider_trust * 0.1)
     */
    async calculateStreamReliability(streamId) {
        const cacheKey = 'srs:' + streamId;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const stream = await db('streams').where('id', streamId).first();
        if (!stream) return null;

        // Get 24h health check history
        const history = await db('health_check_log')
            .where({ stream_id: streamId })
            .where('checked_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
            .orderBy('checked_at', 'asc');

        if (!history.length) {
            return { score: stream.score || 50, confidence: 'low', prediction: 'unknown' };
        }

        // Uptime trend (compare first half to second half)
        const midpoint = Math.floor(history.length / 2);
        const firstHalf = history.slice(0, midpoint);
        const secondHalf = history.slice(midpoint);
        const firstUptime = firstHalf.filter(h => h.status === 'online').length / Math.max(firstHalf.length, 1);
        const secondUptime = secondHalf.filter(h => h.status === 'online').length / Math.max(secondHalf.length, 1);
        const uptimeTrend = secondUptime - firstUptime; // Positive = improving

        // Failure rate inverse
        const failures = history.filter(h => h.status === 'offline' || h.status === 'invalid').length;
        const failureRateInv = 1 - (failures / history.length);

        // Latency stability (lower stddev = more stable)
        const latencies = history.filter(h => h.response_time > 0).map(h => h.response_time);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / Math.max(latencies.length, 1);
        const stddev = Math.sqrt(latencies.reduce((sum, l) => sum + Math.pow(l - avgLatency, 2), 0) / Math.max(latencies.length, 1));
        const latencyStability = Math.max(0, 1 - (stddev / 1000)); // Normalize

        // Viewer retention (from watch_history)
        const viewerStats = await db('watch_history')
            .where({ stream_id: streamId })
            .where('started_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000))
            .select(
                db.raw('COUNT(DISTINCT device_id) as unique_viewers'),
                db.raw('AVG(duration) as avg_watch_time'),
                db.raw('SUM(CASE WHEN duration > 300 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) as retention_rate')
            ).first();
        const viewerRetention = parseFloat(viewerStats?.retention_rate) || 0.5;

        // Provider trust (from stream_hosts)
        const host = await db('stream_hosts').where('id', stream.host_id).first();
        const providerTrust = host ? (1 - (host.failure_rate / 100)) : 0.5;

        // Calculate SRS
        const srs = Math.round((
            (secondUptime * 0.3 + uptimeTrend * 0.1) +
            (failureRateInv * 0.25) +
            (latencyStability * 0.2) +
            (viewerRetention * 0.15) +
            (providerTrust * 0.1)
        ) * 100);

        // Predict future health (15 min ahead)
        const prediction = uptimeTrend < -0.1 ? 'degrading' : uptimeTrend > 0.1 ? 'improving' : 'stable';
        const predictedScore = Math.max(0, Math.min(100, srs + (uptimeTrend * 50)));

        const result = {
            streamId,
            score: Math.max(0, Math.min(100, srs)),
            predictedScore: Math.round(predictedScore),
            prediction,
            confidence: history.length > 20 ? 'high' : history.length > 5 ? 'medium' : 'low',
            factors: {
                uptime: (secondUptime * 100).toFixed(1),
                uptimeTrend: (uptimeTrend * 100).toFixed(1),
                failureRate: ((1 - failureRateInv) * 100).toFixed(1),
                latencyStability: (latencyStability * 100).toFixed(1),
                viewerRetention: (viewerRetention * 100).toFixed(1),
                providerTrust: (providerTrust * 100).toFixed(1),
            },
            checkedAt: new Date().toISOString(),
        };

        await cache.set(cacheKey, result, 60); // 1 min TTL
        return result;
    }

    /**
     * Auto Stream Ranking: Rank all streams for a channel.
     * Returns sorted list with reliability predictions.
     */
    async rankStreams(channelId) {
        const streams = await db('streams')
            .where({ channel_id: channelId, is_active: true })
            .whereIn('status', ['online', 'unknown', 'slow']);

        const ranked = [];
        for (const stream of streams) {
            const reliability = await this.calculateStreamReliability(stream.id);
            ranked.push({
                ...stream,
                reliability,
                finalScore: reliability ? Math.round((stream.score || 0) * 0.6 + reliability.score * 0.4) : stream.score || 0,
            });
        }

        ranked.sort((a, b) => b.finalScore - a.finalScore);
        return ranked;
    }

    /**
     * Provider Trust Score: Aggregate trust for a stream host.
     */
    async calculateProviderTrust(hostId) {
        const host = await db('stream_hosts').where('id', hostId).first();
        if (!host) return null;

        const streams = await db('streams').where({ host_id: hostId, is_active: true });
        if (!streams.length) return { score: 50, confidence: 'low' };

        let totalScore = 0;
        for (const stream of streams) {
            const reliability = await this.calculateStreamReliability(stream.id);
            totalScore += reliability ? reliability.score : (stream.score || 50);
        }

        const avgScore = totalScore / streams.length;
        const streamCountFactor = Math.min(1, streams.length / 10); // More streams = more confidence

        return {
            hostId,
            host: host.host,
            score: Math.round(avgScore),
            streamCount: streams.length,
            confidence: streamCountFactor > 0.5 ? 'high' : streamCountFactor > 0.2 ? 'medium' : 'low',
        };
    }

    /**
     * Channel Trust Score: Aggregate trust for a channel across all its streams.
     */
    async calculateChannelTrust(channelId) {
        const ranked = await this.rankStreams(channelId);
        if (!ranked.length) return { score: 0, confidence: 'none' };

        const bestStream = ranked[0];
        const avgScore = ranked.reduce((sum, s) => sum + s.finalScore, 0) / ranked.length;
        const streamCountFactor = Math.min(1, ranked.length / 3);

        return {
            channelId,
            score: Math.round(avgScore),
            bestStreamScore: bestStream.finalScore,
            streamCount: ranked.length,
            confidence: streamCountFactor > 0.5 ? 'high' : 'medium',
        };
    }

    /**
     * Country Reliability Score: How reliable are streams for a given country.
     */
    async calculateCountryReliability(countryCode) {
        const cacheKey = 'country_rel:' + countryCode;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const channels = await db('channels')
            .where({ country_id: db('countries').where('code', countryCode).select('id'), is_active: true })
            .select('id');

        if (!channels.length) return { score: 50, channelCount: 0 };

        let totalScore = 0;
        for (const ch of channels) {
            const trust = await this.calculateChannelTrust(ch.id);
            totalScore += trust.score;
        }

        const result = {
            countryCode,
            score: Math.round(totalScore / channels.length),
            channelCount: channels.length,
            calculatedAt: new Date().toISOString(),
        };

        await cache.set(cacheKey, result, 300); // 5 min TTL
        return result;
    }

    /**
     * Detect degrading streams before they fail.
     * Returns streams predicted to degrade in next 15 minutes.
     */
    async detectDegradingStreams() {
        const activeStreams = await db('streams')
            .where({ is_active: true })
            .whereIn('status', ['online', 'slow'])
            .select('id', 'channel_id', 'score', 'response_time')
            .limit(100);

        const degrading = [];
        for (const stream of activeStreams) {
            const reliability = await this.calculateStreamReliability(stream.id);
            if (reliability && reliability.prediction === 'degrading' && reliability.predictedScore < 50) {
                const channel = await db('channels').where('id', stream.channel_id).first();
                degrading.push({
                    streamId: stream.id,
                    channelName: channel?.name || 'Unknown',
                    currentScore: stream.score,
                    predictedScore: reliability.predictedScore,
                    confidence: reliability.confidence,
                });
            }
        }

        return degrading;
    }

    /**
     * Run full intelligence cycle (called by cron every 5 minutes).
     */
    async runIntelligenceCycle() {
        console.log('[StreamIntel] Running intelligence cycle...');

        // Detect degrading streams
        const degrading = await this.detectDegradingStreams();
        if (degrading.length > 0) {
            console.log('[StreamIntel] ' + degrading.length + ' degrading streams detected');
            // Create alerts for critical degradations
            for (const d of degrading) {
                if (d.predictedScore < 30 && d.confidence === 'high') {
                    await db('alert_history').insert({
                        severity: 'critical',
                        title: 'Stream Predicted to Fail',
                        message: d.channelName + ' stream predicted to fail (score: ' + d.predictedScore + ')',
                        data: d,
                    }).onConflict().ignore();
                }
            }
        }

        // Update provider trust scores
        const hosts = await db('stream_hosts').where('status', 'healthy').select('id');
        for (const host of hosts.slice(0, 20)) {
            await this.calculateProviderTrust(host.id);
        }

        console.log('[StreamIntel] Cycle complete');
        return { degradingCount: degrading.length };
    }
}

module.exports = new StreamingIntelligence();
