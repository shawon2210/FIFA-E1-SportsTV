// ============================================================
// A1TV v2 — Recommendation API Routes
// Personalized, trending, similar channels
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const cache = require('../config').cache;
const { authenticate, optionalAuth, validate, query } = require('../middleware/auth');
const recEngine = require('../services/recommendations');

const router = Router();

// ── GET /api/v1/recommendations/personalized ─────────────
router.get('/personalized', optionalAuth, async (req, res) => {
    try {
        let recommendations = [];

        if (req.userId) {
            // Based on watch history and favorites
            const cacheKey = `rec:personal:${req.userId}`;
            recommendations = await req.cache.getOrSet(cacheKey, 300, async () => {
                return db.raw(`
                    WITH user_channels AS (
                        SELECT DISTINCT channel_id FROM watch_history
                        WHERE user_id = ? AND started_at > NOW() - INTERVAL '30 days'
                        UNION
                        SELECT channel_id FROM favorites WHERE user_id = ?
                    ),
                    similar AS (
                        SELECT cr.recommended_channel_id, cr.score, cr.reason
                        FROM channel_recommendations cr
                        JOIN user_channels uc ON cr.source_channel_id = uc.channel_id
                        WHERE cr.score > 40
                    )
                    SELECT c.id, c.name, c.slug, c.logo_url, cat.name as category_name,
                        co.name as country_name, SUM(s.score) as total_score,
                        string_agg(DISTINCT s.reason, ', ') as reasons
                    FROM similar s
                    JOIN channels c ON s.recommended_channel_id = c.id
                    LEFT JOIN categories cat ON c.category_id = cat.id
                    LEFT JOIN countries co ON c.country_id = co.id
                    WHERE c.is_active = true
                    AND c.id NOT IN (SELECT channel_id FROM user_channels)
                    GROUP BY c.id, cat.name, co.name
                    ORDER BY total_score DESC
                    LIMIT 20
                `, [req.userId, req.userId]);
            });
            recommendations = recommendations.rows || [];
        }

        // Fallback: popular channels if no personalized recs
        if (!recommendations.length) {
            recommendations = await req.cache.getOrSet('rec:popular', 600, async () => {
                return db('v_channels_enriched')
                    .where('is_active', true)
                    .orderBy('view_count', 'desc')
                    .limit(20)
                    .select('id', 'name', 'slug', 'logo_url', 'category_name', 'country_name');
            });
        }

        res.json({ success: true, data: recommendations });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/recommendations/trending ─────────────────
router.get('/trending', [
    query('period').optional().isIn(['24h', '7d', '30d']),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { period = '24h', limit = 20 } = req.query;
        const interval = period === '7d' ? '7 days' : period === '30d' ? '30 days' : '24 hours';
        const cacheKey = `rec:trending:${period}:${limit}`;

        const data = await req.cache.getOrSet(cacheKey, 300, async () => {
            const [top, growing] = await Promise.all([
                // Most watched
                db.raw(`
                    SELECT c.id, c.name, c.slug, c.logo_url, cat.name as category_name,
                        COUNT(cv.id) as views, COUNT(DISTINCT cv.device_id) as unique_viewers
                    FROM channels c
                    LEFT JOIN channel_views cv ON c.id = cv.channel_id AND cv.viewed_at > NOW() - INTERVAL '${interval}'
                    LEFT JOIN categories cat ON c.category_id = cat.id
                    WHERE c.is_active = true
                    GROUP BY c.id, cat.name
                    HAVING COUNT(cv.id) > 0
                    ORDER BY unique_viewers DESC LIMIT ?
                `, [limit]),
                // Fastest growing
                db.raw(`
                    SELECT c.id, c.name,
                        COUNT(cv1.id) as current_views,
                        COUNT(cv2.id) as previous_views,
                        CASE WHEN COUNT(cv2.id) > 0
                            THEN ROUND(((COUNT(cv1.id) - COUNT(cv2.id))::numeric / COUNT(cv2.id)) * 100, 1)
                            ELSE 100
                        END as growth_pct
                    FROM channels c
                    LEFT JOIN channel_views cv1 ON c.id = cv1.channel_id AND cv1.viewed_at > NOW() - INTERVAL '${interval}'
                    LEFT JOIN channel_views cv2 ON c.id = cv2.channel_id AND cv2.viewed_at BETWEEN NOW() - INTERVAL '${interval}' * 2 AND NOW() - INTERVAL '${interval}'
                    WHERE c.is_active = true
                    GROUP BY c.id HAVING COUNT(cv1.id) > 5
                    ORDER BY growth_pct DESC LIMIT ?
                `, [10]),
            ]);

            return { most_watched: top.rows, fastest_growing: growing.rows };
        });

        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/recommendations/similar/:channelId ───────
router.get('/similar/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const cacheKey = `rec:similar:${channelId}`;

        const data = await req.cache.getOrSet(cacheKey, 600, async () => {
            // Direct recommendations
            const direct = await db('channel_recommendations')
                .where({ source_channel_id: channelId })
                .where('score', '>', 30)
                .orderBy('score', 'desc')
                .limit(10);

            // Same category fallback
            const category = await db('channels').where('id', channelId).first();
            const sameCategory = await db('v_channels_enriched')
                .where('category_id', category?.category_id)
                .where('id', '!=', channelId)
                .where('is_active', true)
                .orderBy('view_count', 'desc')
                .limit(10);

            return { direct, sameCategory };
        });

        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/recommendations/feedback ────────────────
router.post('/feedback', authenticate, async (req, res) => {
    try {
        const { channel_id, action } = req.body; // action: 'clicked', 'dismissed', 'watched'

        // Record co-watch if user clicked a recommendation after watching another channel
        if (action === 'clicked' && req.body.source_channel_id) {
            await recEngine.recordCoWatch(req.body.source_channel_id, channel_id);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
