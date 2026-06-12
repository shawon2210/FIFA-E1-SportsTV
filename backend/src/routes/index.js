// ============================================================
// A1TV Backend — API Routes: Search, Categories, EPG, Health
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const cache = require('../config').cache;
const healthChecker = require('../services/healthChecker');
const streamScorer = require('../services/streamScorer');

const router = Router();

// ============================================================
// SEARCH
// ============================================================

/**
 * GET /api/search?q=sports&limit=20
 * Full-text search across channels with trigram matching.
 */
router.get('/', async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.trim().length < 2) {
            return res.json({ success: true, data: [] });
        }

        const cacheKey = `search:${q.toLowerCase().trim()}:${limit}`;

        const results = await req.cache.getOrSet(cacheKey, cache.ttl.search, async () => {
            // Use trigram similarity for fuzzy matching
            const channels = await db.raw(`
                SELECT 
                    c.id, c.name, c.slug, c.logo_url,
                    cat.name as category_name, cat.slug as category_slug,
                    co.name as country_name, co.flag as country_flag,
                    c.view_count, c.favorite_count,
                    similarity(c.name, ?) as sim_score
                FROM channels c
                LEFT JOIN categories cat ON c.category_id = cat.id
                LEFT JOIN countries co ON c.country_id = co.id
                WHERE c.is_active = true
                AND (
                    c.name ILIKE ?
                    OR ? % c.name
                    OR c.alt_names @> ARRAY[?]::text[]
                )
                ORDER BY sim_score DESC, c.view_count DESC
                LIMIT ?
            `, [q, `%${q}%`, q, q, Math.min(50, parseInt(limit))]);

            // Log search query
            db('search_queries').insert({
                query: q.substring(0, 500),
                results_count: channels.rows?.length || 0,
            }).catch(() => {});

            return channels.rows || [];
        });

        res.json({ success: true, data: results });
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// ============================================================
// CATEGORIES
// ============================================================

/**
 * GET /api/categories
 */
router.get('/', async (req, res) => {
    try {
        const result = await req.cache.getOrSet('categories:all', cache.ttl.categories, async () => {
            return db('categories')
                .where('is_active', true)
                .orderBy('sort_order', 'asc')
                .select('id', 'name', 'slug', 'description', 'icon');
        });

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
});

// ============================================================
// COUNTRIES
// ============================================================

/**
 * GET /api/countries
 */
router.get('/', async (req, res) => {
    try {
        const result = await req.cache.getOrSet('countries:all', cache.ttl.countries, async () => {
            return db('countries')
                .where('is_active', true)
                .orderBy('name', 'asc')
                .select('id', 'code', 'name', 'flag', 'language');
        });

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch countries' });
    }
});

// ============================================================
// EPG — Electronic Program Guide
// ============================================================

/**
 * GET /api/epg/:channelId
 * Get current and upcoming programs for a channel.
 */
router.get('/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const cacheKey = `epg:${channelId}`;

        const result = await req.cache.getOrSet(cacheKey, cache.ttl.epg, async () => {
            const now = new Date();

            // Current program
            const current = await db('programs')
                .where('channel_id', channelId)
                .where('start_time', '<=', now)
                .where('end_time', '>', now)
                .orderBy('start_time', 'desc')
                .first();

            // Upcoming programs (next 6)
            const upcoming = await db('programs')
                .where('channel_id', channelId)
                .where('start_time', '>', now)
                .orderBy('start_time', 'asc')
                .limit(6);

            return { current, upcoming };
        });

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch EPG' });
    }
});

/**
 * GET /api/epg/now
 * Get currently playing programs for all channels.
 */
router.get('/now', async (req, res) => {
    try {
        const result = await req.cache.getOrSet('epg:now', cache.ttl.epg, async () => {
            return db('programs')
                .select('programs.*', 'channels.name as channel_name', 'channels.slug as channel_slug')
                .join('channels', 'programs.channel_id', 'channels.id')
                .where('start_time', '<=', new Date())
                .where('end_time', '>', new Date())
                .orderBy('programs.start_time', 'desc')
                .limit(100);
        });

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch EPG' });
    }
});

// ============================================================
// HEALTH & STATS
// ============================================================

/**
 * GET /api/health
 * Overall system health.
 */
router.get('/', async (req, res) => {
    try {
        const [streamHealth, scoringStats] = await Promise.all([
            healthChecker.getHealthStats(),
            streamScorer.getStats(),
        ]);

        res.json({
            success: true,
            data: {
                streams: streamHealth,
                scoring: scoringStats,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get health stats' });
    }
});

/**
 * POST /api/health/check
 * Trigger a health check cycle (admin only).
 */
router.post('/check', async (req, res) => {
    try {
        // In production, add admin auth middleware
        const result = await healthChecker.runCycle();
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Health check failed' });
    }
});

// ============================================================
// ANALYTICS
// ============================================================

/**
 * POST /api/analytics/event
 * Track a play event (play, pause, error, buffer, quality_change).
 */
router.post('/event', async (req, res) => {
    try {
        const { channel_id, stream_id, event_type, event_data, device_id, user_id } = req.body;

        if (!channel_id || !event_type) {
            return res.status(400).json({ success: false, error: 'channel_id and event_type required' });
        }

        await db('play_events').insert({
            channel_id,
            stream_id: stream_id || null,
            event_type,
            event_data: event_data || {},
            device_id: device_id || null,
            user_id: user_id || null,
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to log event' });
    }
});

/**
 * POST /api/analytics/view
 * Track a channel view.
 */
router.post('/view', async (req, res) => {
    try {
        const { channel_id, device_id, user_id, session_id } = req.body;

        if (!channel_id) {
            return res.status(400).json({ success: false, error: 'channel_id required' });
        }

        await db('channel_views').insert({
            channel_id,
            device_id: device_id || null,
            user_id: user_id || null,
            session_id: session_id || null,
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to log view' });
    }
});

module.exports = router;
