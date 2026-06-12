// ============================================================
// A1TV v2 — Prometheus Metrics Endpoint
// Exposes system metrics for monitoring and alerting.
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const client = require('prom-client');

const router = Router();

// Create a Registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new client.Histogram({
    name: 'a1tv_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const activeStreams = new client.Gauge({
    name: 'a1tv_active_streams',
    help: 'Number of active streams by status',
    labelNames: ['status'],
});
register.registerMetric(activeStreams);

const totalChannels = new client.Gauge({
    name: 'a1tv_total_channels',
    help: 'Total number of channels',
    labelNames: ['status'],
});
register.registerMetric(totalChannels);

const connectedClients = new client.Gauge({
    name: 'a1tv_websocket_clients',
    help: 'Number of connected WebSocket clients',
});
register.registerMetric(connectedClients);

const cacheHitRatio = new client.Gauge({
    name: 'a1tv_cache_hit_ratio',
    help: 'Cache hit ratio percentage',
});
register.registerMetric(cacheHitRatio);

// GET /metrics — Prometheus scrape endpoint
router.get('/', async (req, res) => {
    try {
        // Update dynamic metrics
        const streamStats = await db('streams')
            .where('is_active', true)
            .select('status', db.raw('COUNT(*) as count'))
            .groupBy('status');
        streamStats.forEach(s => activeStreams.set({ status: s.status }, parseInt(s.count)));

        const channelStats = await db('channels')
            .select('is_active', db.raw('COUNT(*) as count'))
            .groupBy('is_active');
        channelStats.forEach(c => totalChannels.set({ status: c.is_active ? 'active' : 'inactive' }, parseInt(c.count)));

        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

module.exports = { router, register, httpRequestDuration, activeStreams, connectedClients };
