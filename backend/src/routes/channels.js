// ============================================================
// A1TV v2 — API Routes: Channels + Streaming + Search
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const cache = require('../config').cache;
const streamScorer = require('../services/streamScorer');
const { standardLimiter, validate, optionalAuth, authenticate, requireDevice, trackViewer, body, query, param } = require('../middleware/auth');

const router = Router();

// ── GET /api/channels ─────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { category, country, featured, verified, search, page = 1, limit = 50, sort = 'popular' } = req.query;
        const offset = (page - 1) * limit;
        let q = db('v_channels_enriched').where('is_active', true);
        if (category && category !== 'all') q = q.where('category_slug', category.toLowerCase());
        if (country && country !== 'all') q = q.where('country_code', country.toUpperCase());
        if (featured === 'true') q = q.where('is_featured', true);
        if (verified === 'true') q = q.where('is_verified', true);
        if (search) { const s = `%${search.toLowerCase()}%`; q = q.where(function() { this.whereRaw('name ILIKE ?', [s]).orWhereRaw('country_name ILIKE ?', [s]); }); }
        switch (sort) { case 'name': q = q.orderBy('name','asc'); break; case 'recent': q = q.orderBy('last_synced_at','desc'); break; case 'favorites': q = q.orderBy('favorite_count','desc'); break; default: q = q.orderBy('view_count','desc'); }
        const { count } = await q.clone().clearOrder().count('* as count').first();
        const channels = await q.offset(offset).limit(limit);
        res.json({ success: true, data: channels, pagination: { page, limit, total: parseInt(count), pages: Math.ceil(parseInt(count) / limit) } });
    } catch (err) { console.error('GET /channels:', err.message); res.status(500).json({ success: false, error: 'Failed to fetch channels' }); }
});

// ── GET /api/channels/featured ────────────────────────────
router.get('/featured', standardLimiter, async (req, res) => {
    try {
        const data = await req.cache.getOrSet('ch:featured', cache.ttl.featured, async () => {
            return db('v_channels_enriched').where('is_featured', true).where('is_active', true).orderBy('view_count', 'desc').limit(20);
        });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/channels/popular ─────────────────────────────
router.get('/popular', standardLimiter, async (req, res) => {
    try {
        const data = await req.cache.getOrSet('ch:popular', cache.ttl.featured, async () => {
            return db('v_channels_enriched').where('is_active', true).orderBy('view_count', 'desc').limit(50);
        });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/channels/:id ─────────────────────────────────
router.get('/:id', standardLimiter, optionalAuth, async (req, res) => {
    try {
        const channel = await req.cache.getOrSet(`ch:${req.params.id}`, cache.ttl.channel, async () => {
            return db('v_channels_enriched').where('id', req.params.id).orWhere('slug', req.params.id).first();
        });
        if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

        // Track view
        db('channels').where('id', channel.id).increment('view_count', 1).catch(() => {});
        db('channel_views').insert({ channel_id: channel.id, user_id: req.userId, device_id: req.deviceIdString, ip_address: req.ip }).catch(() => {});

        res.json({ success: true, data: channel });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/channels/:id/stream (with auto-failover) ─────
router.get('/:id/stream', standardLimiter, optionalAuth, requireDevice, async (req, res) => {
    try {
        const channelId = req.params.id;
        const sessionId = req.headers['x-session-id'] || req.query.session_id;

        // Get failover chain
        const chain = await streamScorer.getFailoverChain(channelId);
        if (!chain.length) {
            return res.status(404).json({ success: false, error: 'No active streams available' });
        }

        const best = chain[0];

        // Track concurrent viewer
        await trackViewer(channelId, sessionId, req.userId, req.deviceIdString);

        // Log play event
        db('play_events').insert({
            channel_id: channelId, stream_id: best.id, event_type: 'play',
            user_id: req.userId, device_id: req.deviceIdString,
            event_data: { quality: best.quality, score: best.score, failover_count: chain.length - 1 },
        }).catch(() => {});

        // Increment play count
        db('channels').where('id', channelId).increment('play_count', 1).catch(() => {});

        res.json({
            success: true,
            data: {
                channelId,
                streamUrl: best.url,
                quality: best.quality,
                status: best.status,
                score: best.score,
                failoverAvailable: chain.length - 1,
                failoverChain: chain.map(s => ({ id: s.id, url: s.url, quality: s.quality, score: s.score })),
            },
        });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/channels/:id/epg ─────────────────────────────
router.get('/:id/epg', standardLimiter, async (req, res) => {
    try {
        const data = await req.cache.getOrSet(`epg:${req.params.id}`, cache.ttl.epg, async () => {
            const now = new Date();
            const current = await db('programs').where({ channel_id: req.params.id })
                .where('start_time', '<=', now).where('end_time', '>', now).orderBy('start_time', 'desc').first();
            const upcoming = await db('programs').where({ channel_id: req.params.id })
                .where('start_time', '>', now).orderBy('start_time', 'asc').limit(6);
            return { current, upcoming };
        });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/channels/:id/favorite ───────────────────────
router.post('/:id/favorite', standardLimiter, optionalAuth, requireDevice, async (req, res) => {
    try {
        const channelId = req.params.id;
        const { device_id } = req.body;
        const effectiveDeviceId = device_id || req.deviceIdString;

        if (!req.userId && !effectiveDeviceId) {
            return res.status(400).json({ success: false, error: 'device_id required for anonymous users' });
        }

        let existing;
        if (req.userId) {
            existing = await db('favorites').where({ user_id: req.userId, channel_id: channelId }).first();
        } else {
            const device = await db('devices').where('device_id', effectiveDeviceId).first();
            if (device) {
                existing = await db('favorites').where({ device_id: device.id, channel_id: channelId }).first();
            }
        }

        if (existing) {
            await db('favorites').where('id', existing.id).delete();
            return res.json({ success: true, data: { favorited: false } });
        }

        const favData = { channel_id: channelId };
        if (req.userId) favData.user_id = req.userId;
        if (effectiveDeviceId) {
            let device = await db('devices').where('device_id', effectiveDeviceId).first();
            if (!device) {
                [device] = await db('devices').insert({ device_id: effectiveDeviceId, user_id: req.userId }).returning('*');
            }
            favData.device_id = device.id;
        }

        await db('favorites').insert(favData);
        res.json({ success: true, data: { favorited: true } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/search ──────────────────────────────────────
router.get('/search', standardLimiter, [
    query('q').isString().trim().isLength({ min: 2, max: 100 }),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;
        const cacheKey = `search:${q.toLowerCase().trim()}:${limit}`;

        const data = await req.cache.getOrSet(cacheKey, cache.ttl.search, async () => {
            const rows = await db.raw(`
                SELECT c.id, c.name, c.slug, c.logo_url, c.view_count,
                    cat.name as category_name, cat.slug as category_slug,
                    co.name as country_name, co.flag as country_flag,
                    similarity(c.name, ?) as sim
                FROM channels c
                LEFT JOIN categories cat ON c.category_id = cat.id
                LEFT JOIN countries co ON c.country_id = co.id
                WHERE c.is_active = true
                AND (c.name ILIKE ? OR ? % c.name OR c.alt_names @> ARRAY[?]::text[])
                ORDER BY sim DESC, c.view_count DESC
                LIMIT ?
            `, [q, `%${q}%`, q, q, limit]);

            // Log search
            db('search_queries').insert({ query: q.substring(0, 500), results_count: rows.rows?.length || 0 }).catch(() => {});
            return rows.rows || [];
        });

        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;

// Simple test route - no middleware
router.get('/test-simple', async (req, res) => {
    try {
        const db = require('../config/database');
        const channels = await db('channels').where('is_active', true).limit(3);
        res.json({ success: true, data: channels, count: channels.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
