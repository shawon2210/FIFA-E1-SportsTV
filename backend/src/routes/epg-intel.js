// A1TV v2 - EPG Intelligence Routes
// Program search, upcoming match discovery, reminders

const { Router } = require('express');
const db = require('../config/database');
const cache = require('../config').cache;
const { authenticate, optionalAuth, validate, body, query, param } = require('../middleware/auth');

const router = Router();

// GET /api/v1/epg/search?q=liverpool - Search programs across EPG
router.get('/search', [
    query('q').isString().trim().isLength({ min: 2, max: 100 }),
    query('category').optional().isString(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { q, category, from, to, limit = 20 } = req.query;
        const searchFrom = from ? new Date(from) : new Date();
        const searchTo = to ? new Date(to) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const cacheKey = 'epg:search:' + q.toLowerCase().trim() + ':' + (category || 'all') + ':' + limit;
        const results = await req.cache.getOrSet(cacheKey, 120, async () => {
            let dbq = db('programs')
                .select('programs.*', 'channels.name as channel_name', 'channels.slug as channel_slug', 'channels.logo_url')
                .join('channels', 'programs.channel_id', 'channels.id')
                .where('channels.is_active', true)
                .where('programs.start_time', '>=', searchFrom)
                .where('programs.end_time', '<=', searchTo)
                .where(function () {
                    this.whereRaw('programs.title ILIKE ?', ['%' + q + '%'])
                        .orWhereRaw('programs.description ILIKE ?', ['%' + q + '%'])
                        .orWhereRaw('programs.category ILIKE ?', ['%' + q + '%']);
                });
            if (category) dbq = dbq.whereRaw('programs.category ILIKE ?', ['%' + category + '%']);
            return dbq.orderBy('programs.start_time', 'asc').limit(limit);
        });
        res.json({ success: true, data: results, query: q });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/epg/upcoming/:type - Upcoming sports/events discovery
router.get('/upcoming/:type', [
    param('type').isIn(['sports','football','cricket','ufc','formula1','movies','shows','news']),
    query('hours').optional().isInt({ min: 1, max: 168 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { type } = req.params;
        const hours = req.query.hours || 48;
        const limit = req.query.limit || 20;
        const now = new Date();
        const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
        const cacheKey = 'epg:upcoming:' + type + ':' + hours + ':' + limit;
        const results = await req.cache.getOrSet(cacheKey, 300, async () => {
            const keywords = {
                sports: ['sport','match','game','vs','live','championship','league','tournament'],
                football: ['football','soccer','premier league','la liga','serie a','bundesliga','champions league','world cup'],
                cricket: ['cricket','test','odi','t20','ipl','big bash','ashes'],
                ufc: ['ufc','mma','fight','boxing','wrestling','bellator'],
                formula1: ['formula 1','f1','grand prix','racing','motorsport'],
                movies: ['movie','film','cinema','premiere','blockbuster'],
                shows: ['show','series','season','episode','drama','comedy'],
                news: ['news','breaking','live','update','report'],
            }[type] || [type];
            let dbq = db('programs')
                .select('programs.*', 'channels.name as channel_name', 'channels.logo_url')
                .join('channels', 'programs.channel_id', 'channels.id')
                .where('channels.is_active', true)
                .where('programs.start_time', '>=', now)
                .where('programs.start_time', '<=', future)
                .where(function () { keywords.forEach(function(kw) {
                    this.orWhereRaw('programs.title ILIKE ?', ['%' + kw + '%']);
                    this.orWhereRaw('programs.description ILIKE ?', ['%' + kw + '%']);
                }, this); });
            return dbq.orderBy('programs.start_time', 'asc').limit(limit);
        });
        res.json({ success: true, data: results, type, hours });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/epg/reminders - Get user reminders
router.get('/reminders', authenticate, async (req, res) => {
    try {
        const user = await db('users').where('id', req.userId).first();
        const reminders = user?.preferences?.reminders || [];
        const enriched = [];
        for (const r of reminders) {
            const program = await db('programs').where('id', r.program_id).first();
            if (program && new Date(program.start_time) > new Date()) enriched.push({ ...r, program });
        }
        res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/v1/epg/reminders - Set reminder
router.post('/reminders', authenticate, [
    body('channel_id').isUUID(), body('program_id').isUUID(),
    body('remind_before_minutes').optional().isInt({ min: 1, max: 120 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { channel_id, program_id, remind_before_minutes = 10 } = req.body;
        const user = await db('users').where('id', req.userId).first();
        const prefs = user.preferences || {};
        prefs.reminders = prefs.reminders || [];
        if (!prefs.reminders.find(r => r.program_id === program_id)) {
            prefs.reminders.push({ channel_id, program_id, remind_before_minutes, created_at: new Date() });
            await db('users').where('id', req.userId).update({ preferences: prefs });
        }
        res.json({ success: true, data: { message: 'Reminder set' } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/v1/epg/reminders/:id - Remove reminder
router.delete('/reminders/:id', authenticate, async (req, res) => {
    try {
        const user = await db('users').where('id', req.userId).first();
        const prefs = user.preferences || {};
        if (prefs.reminders) {
            prefs.reminders = prefs.reminders.filter(r => r.program_id !== req.params.id);
            await db('users').where('id', req.userId).update({ preferences: prefs });
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
