// A1TV v2 - AI Layer Routes
// Smart search, personalized home, channel classification

const { Router } = require('express');
const ai = require('../services/ai');
const { optionalAuth, validate, query, param } = require('../middleware/auth');

const router = Router();

// GET /api/v1/ai/search?q=football tonight
router.get('/search', [
    query('q').isString().trim().isLength({ min: 2, max: 100 }),
    query('country').optional().isString().isLength({ max: 2 }),
    query('language').optional().isString().isLength({ max: 2 }),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    validate,
], async (req, res) => {
    try {
        const result = await ai.smartSearch(req.query.q, {
            countryCode: req.query.country,
            language: req.query.language,
            limit: req.query.limit || 20,
            userId: req.userId,
        });
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v1/ai/home - Personalized home screen
router.get('/home', optionalAuth, async (req, res) => {
    try {
        if (!req.userId) {
            // Return popular channels for anonymous users
            const popular = await require('../config/database')('channels').where('is_active', true).orderBy('view_count', 'desc').limit(20);
            return res.json({ success: true, data: { continueWatching: [], recentlyWatched: [], recommended: popular, nowPlaying: [] } });
        }
        const result = await ai.generatePersonalizedHome(req.userId);
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/v1/ai/classify/:channelId - Auto-classify channel
router.post('/classify/:channelId', async (req, res) => {
    try {
        const result = await ai.classifyChannel(req.params.channelId);
        res.json({ success: true, data: result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
