// ============================================================
// A1TV v2 — User Accounts API Routes
// Register, login, OAuth, favorites sync, watch history, preferences
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const authService = require('../services/auth');
const { authenticate, optionalAuth, validate, body, query } = require('../middleware/auth');

const router = Router();

// ── POST /api/v1/auth/register ────────────────────────────
router.post('/register', [
    body('email').optional().isEmail().normalizeEmail(),
    body('username').optional().isAlphanumeric().isLength({ min: 3, max: 30 }),
    body('password').isLength({ min: 6 }),
    body('display_name').optional().isString().trim().isLength({ max: 100 }),
    validate,
], async (req, res) => {
    try {
        const result = await authService.register(req.body);
        res.status(201).json({ success: true, data: result });
    } catch (err) {
        const status = err.message.includes('already taken') ? 409 : 400;
        res.status(status).json({ success: false, error: err.message });
    }
});

// ── POST /api/v1/auth/login ───────────────────────────────
router.post('/login', [
    body('email').optional().isEmail(),
    body('username').optional().isString(),
    body('password').isString(),
    validate,
], async (req, res) => {
    try {
        const result = await authService.login({
            ...req.body,
            deviceInfo: req.headers['user-agent'],
            ipAddress: req.ip,
        });
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(401).json({ success: false, error: err.message });
    }
});

// ── POST /api/v1/auth/refresh ─────────────────────────────
router.post('/refresh', [
    body('refresh_token').isString(),
    validate,
], async (req, res) => {
    try {
        const result = await authService.refreshToken(req.body.refresh_token);
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(401).json({ success: false, error: err.message });
    }
});

// ── POST /api/v1/auth/logout ──────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
    try {
        await authService.revokeAllTokens(req.userId);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/auth/me ───────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
    try {
        const user = await db('users').where('id', req.userId).first();
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, data: authService.sanitizeUser(user) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── PUT /api/v1/auth/me — Update profile ──────────────────
router.put('/me', authenticate, [
    body('display_name').optional().isString().trim().isLength({ max: 100 }),
    body('preferences').optional().isObject(),
    validate,
], async (req, res) => {
    try {
        const update = {};
        if (req.body.display_name) update.display_name = req.body.display_name;
        if (req.body.preferences) update.preferences = req.body.preferences;
        update.updated_at = new Date();

        await db('users').where('id', req.userId).update(update);
        const user = await db('users').where('id', req.userId).first();
        res.json({ success: true, data: authService.sanitizeUser(user) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/auth/link-device ─────────────────────────
router.post('/link-device', authenticate, [
    body('device_id').isString(),
    validate,
], async (req, res) => {
    try {
        await authService.linkDevice(req.userId, req.body.device_id);
        res.json({ success: true, data: { message: 'Device linked' } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/users/:id/favorites ───────────────────────
router.get('/:id/favorites', authenticate, async (req, res) => {
    try {
        const favorites = await db('favorites')
            .where('user_id', req.params.id)
            .join('channels', 'favorites.channel_id', 'channels.id')
            .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url',
                'favorites.created_at')
            .orderBy('favorites.created_at', 'desc');

        res.json({ success: true, data: favorites });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/users/:id/history ─────────────────────────
router.get('/:id/history', authenticate, [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const history = await db('watch_history')
            .where({ user_id: req.params.id })
            .join('channels', 'watch_history.channel_id', 'channels.id')
            .select('channels.id', 'channels.name', 'channels.slug', 'channels.logo_url',
                'watch_history.started_at', 'watch_history.duration', 'watch_history.quality')
            .orderBy('watch_history.started_at', 'desc')
            .offset(offset)
            .limit(limit);

        const { count } = await db('watch_history')
            .where({ user_id: req.params.id })
            .count('* as count').first();

        res.json({
            success: true,
            data: history,
            pagination: { page, limit, total: parseInt(count), pages: Math.ceil(parseInt(count) / limit) },
        });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/users/history — Record watch event ───────
router.post('/history', optionalAuth, requireDevice, [
    body('channel_id').isUUID(),
    body('duration').optional().isInt({ min: 0 }),
    body('quality').optional().isString(),
    validate,
], async (req, res) => {
    try {
        const { channel_id, duration = 0, quality } = req.body;

        const entry = {
            channel_id,
            duration,
            quality: quality || null,
            started_at: new Date(),
        };

        if (req.userId) {
            entry.user_id = req.userId;
        } else if (req.deviceIdString) {
            const device = await db('devices').where('device_id', req.deviceIdString).first();
            if (device) entry.device_id = device.id;
        }

        // Record co-watch: what was the user watching before this?
        if (req.userId) {
            const lastWatch = await db('watch_history')
                .where({ user_id: req.userId })
                .orderBy('started_at', 'desc')
                .first();
            if (lastWatch && lastWatch.channel_id !== channel_id) {
                const recEngine = require('../services/recommendations');
                await recEngine.recordCoWatch(lastWatch.channel_id, channel_id);
            }
        }

        await db('watch_history').insert(entry);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
