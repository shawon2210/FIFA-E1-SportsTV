// ============================================================
// A1TV v4 — Sports Intelligence Routes
//
// Endpoints:
//   GET  /api/v1/sports/hub                  — Sports Hub (aggregated)
//   GET  /api/v1/sports/live                 — Live matches
//   GET  /api/v1/sports/upcoming             — Upcoming matches
//   GET  /api/v1/sports/finished             — Finished matches
//   GET  /api/v1/sports/matches/:matchId     — Match details + timeline
//   GET  /api/v1/sports/matches/:matchId/events
//   POST /api/v1/sports/matches/:matchId/events  — Add event (admin)
//   PUT  /api/v1/sports/matches/:matchId/status  — Update status (admin)
//   POST /api/v1/sports/detect               — Detect match from text
//   GET  /api/v1/sports/leagues              — List leagues
// ============================================================

const { Router } = require('express');
const { authenticate, optionalAuth, validate, query, param, body } = require('../middleware/auth');
const { sportsIntelligence, matchDetector } = require('../services/sportsIntel');
const db = require('../config/database');

const router = Router();

// ── Sports Hub ──────────────────────────────────────────────
router.get('/hub',
  optionalAuth,
  validate([query('limit').optional().isInt({ min: 1, max: 100 })]),
  async (req, res) => {
    try {
      const hub = await sportsIntelligence.getSportsHub(parseInt(req.query.limit, 10) || 50);
      res.json({ success: true, data: hub });
    } catch (err) {
      console.error('[Sports] Hub error:', err);
      res.status(500).json({ success: false, error: 'Sports hub failed' });
    }
  }
);

// ── Live matches ────────────────────────────────────────────
router.get('/live',
  optionalAuth,
  validate([
    query('sport').optional().isString(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req, res) => {
    try {
      const matches = await sportsIntelligence.getLiveMatches(
        req.query.sport,
        parseInt(req.query.limit, 10) || 50
      );
      res.json({ success: true, data: matches, count: matches.length });
    } catch (err) {
      console.error('[Sports] Live error:', err);
      res.status(500).json({ success: false, error: 'Live matches failed' });
    }
  }
);

// ── Upcoming matches ────────────────────────────────────────
router.get('/upcoming',
  optionalAuth,
  validate([
    query('sport').optional().isString(),
    query('hours').optional().isInt({ min: 1, max: 168 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req, res) => {
    try {
      const matches = await sportsIntelligence.getUpcomingMatches(
        req.query.sport,
        parseInt(req.query.hours, 10) || 24,
        parseInt(req.query.limit, 10) || 50
      );
      res.json({ success: true, data: matches, count: matches.length });
    } catch (err) {
      console.error('[Sports] Upcoming error:', err);
      res.status(500).json({ success: false, error: 'Upcoming matches failed' });
    }
  }
);

// ── Finished matches ────────────────────────────────────────
router.get('/finished',
  optionalAuth,
  validate([
    query('sport').optional().isString(),
    query('hours').optional().isInt({ min: 1, max: 168 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req, res) => {
    try {
      const matches = await sportsIntelligence.getFinishedMatches(
        req.query.sport,
        parseInt(req.query.hours, 10) || 24,
        parseInt(req.query.limit, 10) || 50
      );
      res.json({ success: true, data: matches, count: matches.length });
    } catch (err) {
      console.error('[Sports] Finished error:', err);
      res.status(500).json({ success: false, error: 'Finished matches failed' });
    }
  }
);

// ── Match timeline ──────────────────────────────────────────
router.get('/matches/:matchId',
  optionalAuth,
  validate([param('matchId').isUUID()]),
  async (req, res) => {
    try {
      const timeline = await sportsIntelligence.getMatchTimeline(req.params.matchId);
      if (!timeline) {
        return res.status(404).json({ success: false, error: 'Match not found' });
      }
      res.json({ success: true, data: timeline });
    } catch (err) {
      console.error('[Sports] Timeline error:', err);
      res.status(500).json({ success: false, error: 'Timeline failed' });
    }
  }
);

// ── Add match event (admin) ─────────────────────────────────
router.post('/matches/:matchId/events',
  authenticate,
  validate([
    param('matchId').isUUID(),
    body('eventType').isIn(['goal', 'penalty', 'red_card', 'yellow_card', 'wicket', 'boundary', 'substitution', 'var_review', 'try', 'conversion', 'field_goal', 'dunk', 'three_pointer', 'fastest_lap', 'pit_stop']),
    body('teamId').optional().isUUID(),
    body('playerName').optional().isString(),
    body('minute').optional().isString(),
    body('scoreAfter').optional().isString(),
    body('description').optional().isString(),
    body('eventSubtype').optional().isString(),
  ]),
  async (req, res) => {
    try {
      await sportsIntelligence.addEvent(req.params.matchId, req.body);
      res.json({ success: true, message: 'Event recorded' });
    } catch (err) {
      console.error('[Sports] Add event error:', err);
      res.status(500).json({ success: false, error: 'Failed to add event' });
    }
  }
);

// ── Update match status (admin) ─────────────────────────────
router.put('/matches/:matchId/status',
  authenticate,
  validate([
    param('matchId').isUUID(),
    body('status').isIn(['scheduled', 'live', 'halftime', 'finished', 'postponed', 'cancelled']),
    body('homeScore').optional().isInt({ min: 0 }),
    body('awayScore').optional().isInt({ min: 0 }),
    body('period').optional().isString(),
    body('clock').optional().isString(),
  ]),
  async (req, res) => {
    try {
      await sportsIntelligence.updateMatchStatus(req.params.matchId, req.body.status, {
        homeScore: req.body.homeScore,
        awayScore: req.body.awayScore,
        period: req.body.period,
        clock: req.body.clock,
      });
      res.json({ success: true, message: 'Match status updated' });
    } catch (err) {
      console.error('[Sports] Update status error:', err);
      res.status(500).json({ success: false, error: 'Failed to update status' });
    }
  }
);

// ── Detect match from text ──────────────────────────────────
router.post('/detect',
  optionalAuth,
  validate([
    body('title').isString().notEmpty(),
    body('description').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const result = matchDetector.detectFromEpg(req.body.title, req.body.description || '');
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[Sports] Detect error:', err);
      res.status(500).json({ success: false, error: 'Detection failed' });
    }
  }
);

// ── List leagues ────────────────────────────────────────────
router.get('/leagues', optionalAuth, async (req, res) => {
  try {
    const leagues = await db('sports_leagues')
      .where({ is_active: true })
      .orderBy('name');
    res.json({ success: true, data: leagues });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list leagues' });
  }
});

module.exports = router;
