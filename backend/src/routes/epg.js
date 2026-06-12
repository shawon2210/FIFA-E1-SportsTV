// ============================================================
// A1TV v2 — EPG API Routes
// Rich TV Guide: NOW/NEXT/LATER, timeline grid, reminders
// ============================================================

const { Router } = require('express');
const db = require('../config/database');
const cache = require('../config').cache;
const { authenticate, optionalAuth, validate, body, query, param } = require('../middleware/auth');

const router = Router();

// ── GET /api/v1/epg/now — What's on now across all channels ──
router.get('/now', async (req, res) => {
    try {
        const data = await req.cache.getOrSet('epg:now', cache.ttl.epg, async () => {
            return db('programs')
                .select('programs.*', 'channels.name as channel_name', 'channels.slug as channel_slug',
                    'channels.logo_url', 'channels.id as channel_id')
                .join('channels', 'programs.channel_id', 'channels.id')
                .where('channels.is_active', true)
                .where('programs.start_time', '<=', new Date())
                .where('programs.end_time', '>', new Date())
                .orderBy('programs.start_time', 'desc')
                .limit(100);
        });
        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/epg/:channelId — Full EPG for a channel ──────
router.get('/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const cacheKey = `epg:${channelId}`;

        const data = await req.cache.getOrSet(cacheKey, cache.ttl.epg, async () => {
            const now = new Date();

            // Current program
            const current = await db('programs')
                .where({ channel_id: channelId })
                .where('start_time', '<=', now)
                .where('end_time', '>', now)
                .orderBy('start_time', 'desc')
                .first();

            // Next 6 programs
            const next = await db('programs')
                .where({ channel_id: channelId })
                .where('start_time', '>', now)
                .orderBy('start_time', 'asc')
                .limit(6);

            // Later today (after the "next" programs)
            const later = await db('programs')
                .where({ channel_id: channelId })
                .where('start_time', '>', now)
                .where('start_time', '<', new Date(now.getTime() + 24 * 60 * 60 * 1000))
                .orderBy('start_time', 'asc')
                .offset(6)
                .limit(10);

            return { current, next, later };
        });

        res.json({ success: true, data });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/epg/:channelId/timeline — Timeline grid ──────
router.get('/:channelId/timeline', [
    query('hours').optional().isInt({ min: 1, max: 24 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { channelId } = req.params;
        const hours = req.query.hours || 6;
        const now = new Date();
        const end = new Date(now.getTime() + hours * 60 * 60 * 1000);

        const programs = await db('programs')
            .where({ channel_id: channelId })
            .where('start_time', '<', end)
            .where('end_time', '>', now)
            .orderBy('start_time', 'asc')
            .select('id', 'title', 'description', 'start_time', 'end_time', 'duration', 'category', 'rating');

        // Build timeline slots (30-min intervals)
        const slots = [];
        const slotDuration = 30 * 60 * 1000; // 30 minutes
        for (let t = now.getTime(); t < end.getTime(); t += slotDuration) {
            const slotStart = new Date(t);
            const slotEnd = new Date(t + slotDuration);
            const programsInSlot = programs.filter(p =>
                new Date(p.start_time) < slotEnd && new Date(p.end_time) > slotStart
            );
            slots.push({ time: slotStart, programs: programsInSlot });
        }

        res.json({ success: true, data: { programs, slots, hours } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── POST /api/v1/epg/reminders — Set a reminder ──────────────
router.post('/reminders', authenticate, [
    body('channel_id').isUUID(),
    body('program_id').isUUID(),
    body('remind_before_minutes').optional().isInt({ min: 1, max: 120 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const { channel_id, program_id, remind_before_minutes = 10 } = req.body;

        // Store reminder in user preferences
        const user = await db('users').where('id', req.userId).first();
        const prefs = user.preferences || {};
        prefs.reminders = prefs.reminders || [];
        prefs.reminders.push({ channel_id, program_id, remind_before_minutes, created_at: new Date() });

        await db('users').where('id', req.userId).update({ preferences: prefs });

        res.json({ success: true, data: { message: 'Reminder set' } });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── GET /api/v1/epg/reminders — Get user's reminders ─────────
router.get('/reminders', authenticate, async (req, res) => {
    try {
        const user = await db('users').where('id', req.userId).first();
        const reminders = user?.preferences?.reminders || [];

        // Enrich with program details
        const enriched = [];
        for (const r of reminders) {
            const program = await db('programs').where('id', r.program_id).first();
            if (program && new Date(program.start_time) > new Date()) {
                enriched.push({ ...r, program });
            }
        }

        res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
