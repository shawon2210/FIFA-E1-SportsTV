// ============================================================
// A1TV v4 — Recommendation Engine v2 Routes
//
// Endpoints:
//   GET /api/v1/recommendations/v2/similar/:channelId
//   GET /api/v1/recommendations/v2/collaborative/:channelId
//   GET /api/v1/recommendations/v2/feed          (personalized)
//   GET /api/v1/recommendations/v2/sports/:channelId
//   POST /api/v1/recommendations/v2/queue        (admin: queue embedding)
//   POST /api/v1/recommendations/v2/process       (admin: process queue)
// ============================================================

const { Router } = require('express');
const { authenticate, optionalAuth, validate, query, param, body } = require('../middleware/auth');
const { engineV2 } = require('../services/recEngineV2');

const router = Router();

// ── Similar channels (embedding-based) ──────────────────────
router.get('/similar/:channelId',
  optionalAuth,
  validate([
    param('channelId').isUUID().withMessage('Invalid channel ID'),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const results = await engineV2.findSimilarChannels(req.params.channelId, limit);
      res.json({ success: true, data: results, source: 'embedding' });
    } catch (err) {
      console.error('[RecV2] Similar error:', err);
      res.status(500).json({ success: false, error: 'Recommendation failed' });
    }
  }
);

// ── Collaborative filtering ─────────────────────────────────
router.get('/collaborative/:channelId',
  optionalAuth,
  validate([
    param('channelId').isUUID().withMessage('Invalid channel ID'),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const results = await engineV2.findCollaborativeRecommendations(req.params.channelId, limit);
      res.json({ success: true, data: results, source: 'collaborative' });
    } catch (err) {
      console.error('[RecV2] Collaborative error:', err);
      res.status(500).json({ success: false, error: 'Recommendation failed' });
    }
  }
);

// ── Personalized home feed ──────────────────────────────────
router.get('/feed',
  authenticate,
  validate([
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 30;
      const results = await engineV2.getPersonalizedFeed(req.userId, limit);
      res.json({ success: true, data: results, source: 'personalized' });
    } catch (err) {
      console.error('[RecV2] Feed error:', err);
      res.status(500).json({ success: false, error: 'Feed generation failed' });
    }
  }
);

// ── Related sports content ──────────────────────────────────
router.get('/sports/:channelId',
  optionalAuth,
  validate([
    param('channelId').isUUID().withMessage('Invalid channel ID'),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ]),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 10;
      const results = await engineV2.findRelatedSports(req.params.channelId, limit);
      res.json({ success: true, data: results, source: 'sports' });
    } catch (err) {
      console.error('[RecV2] Sports error:', err);
      res.status(500).json({ success: false, error: 'Sports recommendation failed' });
    }
  }
);

// ── Queue embedding generation (admin) ──────────────────────
router.post('/queue',
  authenticate,
  validate([
    body('entityType').isIn(['channel', 'program', 'user']).withMessage('Invalid entity type'),
    body('entityId').isUUID().withMessage('Invalid entity ID'),
    body('priority').optional().isInt({ min: 1, max: 10 }),
  ]),
  async (req, res) => {
    try {
      const { entityType, entityId, priority } = req.body;
      await engineV2.queueEmbedding(entityType, entityId, priority || 5);
      res.json({ success: true, message: 'Queued for embedding generation' });
    } catch (err) {
      console.error('[RecV2] Queue error:', err);
      res.status(500).json({ success: false, error: 'Queue failed' });
    }
  }
);

// ── Process embedding queue (admin/worker) ──────────────────
router.post('/process',
  authenticate,
  validate([
    body('batchSize').optional().isInt({ min: 1, max: 200 }),
  ]),
  async (req, res) => {
    try {
      const batchSize = parseInt(req.body.batchSize, 10) || 50;
      const results = await engineV2.processQueue(batchSize);
      res.json({ success: true, data: results });
    } catch (err) {
      console.error('[RecV2] Process error:', err);
      res.status(500).json({ success: false, error: 'Processing failed' });
    }
  }
);

module.exports = router;
