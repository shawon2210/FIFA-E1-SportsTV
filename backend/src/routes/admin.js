// ============================================================
// A1TV v2 — Admin API Routes
// Dashboard: stream health, top channels, search analytics, alerts
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin, validate, query } = require('../middleware/auth');
const healthChecker = require('../services/healthChecker');
const streamScorer = require('../services/streamScorer');
const circuitBreaker = require('../services/circuitBreaker');

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(requireAdmin);

// ── GET /api/v1/admin/dashboard — Overview stats ─────────
router.get('/dashboard', async (req, res) => {
    try {
        const [streams, channels, hosts, recentAlerts] = await Promise.all([
            healthChecker.getStats(),
            db('channels').select(
                db.raw('COUNT(*) as total'),
                db.raw('COUNT(*) FILTER (WHERE is_active = true) as active'),
                db.raw('COUNT(*) FILTER (WHERE is_featured = true) as featured'),
                db.raw('COUNT(*) FILTER (WHERE is_verified = true) as verified'),
            ).first(),
            circuitBreaker.getStats(),
            db('alert_history').where('resolved', false).orderBy('created_at', 'desc').limit(10),
        ]);

        res.json({ success: true, data: { streams, channels, hosts, recentAlerts } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/admin/channels/top ──────────────────────
router.get('/channels/top', [
    query('period').optional().isIn(['24h', '7d', '30d']),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { period = '24h', limit = 20 } = req.query;
        const interval = period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';

        const channels = await db.raw(`
            SELECT c.id, c.name, c.slug, c.logo_url, c.is_featured, c.is_verified,
                cat.name as category_name, co.name as country_name, co.flag as country_flag,
                COUNT(cv.id) as views,
                COUNT(DISTINCT cv.device_id) as unique_viewers,
                c.view_count as total_views
            FROM channels c
            LEFT JOIN channel_views cv ON c.id = cv.channel_id AND cv.viewed_at > NOW() - INTERVAL '${interval}'
            LEFT JOIN categories cat ON c.category_id = cat.id
            LEFT JOIN countries co ON c.country_id = co.id
            WHERE c.is_active = true
            GROUP BY c.id, cat.name, co.name, co.flag
            ORDER BY unique_viewers DESC, views DESC
            LIMIT ?
        `, [limit]);

        // Fastest growing (compare current period to previous)
        const growing = await db.raw(`
            SELECT c.id, c.name,
                COUNT(cv1.id) as current_views,
                COUNT(cv2.id) as previous_views,
                CASE WHEN COUNT(cv2.id) > 0
                    THEN ROUND(((COUNT(cv1.id) - COUNT(cv2.id))::numeric / COUNT(cv2.id)) * 100, 1)
                    ELSE 0
                END as growth_pct
            FROM channels c
            LEFT JOIN channel_views cv1 ON c.id = cv1.channel_id AND cv1.viewed_at > NOW() - INTERVAL '${interval}'
            LEFT JOIN channel_views cv2 ON c.id = cv2.channel_id AND cv2.viewed_at BETWEEN NOW() - INTERVAL '${interval}' * 2 AND NOW() - INTERVAL '${interval}'
            WHERE c.is_active = true
            GROUP BY c.id
            HAVING COUNT(cv1.id) > 10
            ORDER BY growth_pct DESC
            LIMIT 10
        `);

        res.json({ success: true, data: { top: channels.rows, growing: growing.rows } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/admin/streams/health ────────────────────
router.get('/health', async (req, res) => {
    try {
        const stats = await healthChecker.getStats();
        const failingHosts = await circuitBreaker.getFailingHosts();
        const slowStreams = await db('streams')
            .where({ status: 'slow', is_active: true })
            .orderBy('response_time', 'desc')
            .limit(20)
            .select('id', 'url', 'response_time', 'quality');

        res.json({ success: true, data: { stats, failingHosts, slowStreams } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/admin/analytics/search ──────────────────
router.get('/analytics/search', [
    query('period').optional().isIn(['24h', '7d', '30d']),
    validate,
], async (req, res) => {
    try {
        const interval = req.query.period === '7d' ? '7 days' : req.query.period === '30d' ? '30 days' : '24 hours';

        const [topQueries, noResultQueries] = await Promise.all([
            db('search_queries')
                .where('created_at', '>', new Date(Date.now() - parseInt(interval) * 24 * 60 * 60 * 1000))
                .select('query', db.raw('COUNT(*) as count'), db.raw('AVG(results_count)::int as avg_results'))
                .groupBy('query')
                .orderByRaw('COUNT(*) DESC')
                .limit(20),
            db('search_queries')
                .where('created_at', '>', new Date(Date.now() - parseInt(interval) * 24 * 60 * 60 * 1000))
                .where('results_count', 0)
                .select('query', db.raw('COUNT(*) as count'))
                .groupBy('query')
                .orderByRaw('COUNT(*) DESC')
                .limit(10),
        ]);

        res.json({ success: true, data: { topQueries, noResultQueries } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/admin/alertss ──────────────────────────────
router.get('/alerts', async (req, res) => {
    try {
        const alerts = await db('alert_history')
            .leftJoin('alert_rules', 'alert_history.rule_id', 'alert_rules.id')
            .select('alert_history.*', 'alert_rules.name as rule_name', 'alert_rules.category')
            .orderBy('alert_history.created_at', 'desc')
            .limit(50);

        res.json({ success: true, data: alerts });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/admin/alerts/:id/acknowledge ───────────
router.post('/alerts/:id/acknowledge', async (req, res) => {
    try {
        await db('alert_history').where('id', req.params.id).update({
            acknowledged: true,
            acknowledged_by: req.userId,
            acknowledged_at: new Date(),
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/admin/streams/:id/ban ──────────────────
router.post('/streams/:id/ban', async (req, res) => {
    try {
        const stream = await db('streams').where('id', req.params.id).first();
        if (!stream) return res.status(404).json({ success: false, error: 'Stream not found' });

        if (stream.host_id) {
            await circuitBreaker.banHost(stream.host_id, req.body.reason || 'admin_ban');
        }

        await db('streams').where('id', req.params.id).update({ is_active: false });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
