// ============================================================
// A1TV v4 — Predictive Stream Intelligence Routes
//
// Endpoints:
//   GET  /api/v1/intelligence/predict/:streamId   — Predict failure
//   GET  /api/v1/intelligence/batch                — Batch predict
//   GET  /api/v1/intelligence/telemetry/:streamId  — Telemetry summary
//   POST /api/v1/intelligence/record               — Record telemetry event
// ============================================================

const { Router } = require('express');
const { authenticate, optionalAuth, validate, query, param, body } = require('../middleware/auth');
const { model } = require('../services/streamIntelV2');

const router = Router();

// ── Predict failure for a single stream ─────────────────────
router.get('/predict/:streamId',
  optionalAuth,
  validate([
    param('streamId').isUUID().withMessage('Invalid stream ID'),
  ]),
  async (req, res) => {
    try {
      const prediction = await model.predictFailure(req.params.streamId);
      res.json({ success: true, data: prediction });
    } catch (err) {
      console.error('[Intel v2] Predict error:', err);
      res.status(500).json({ success: false, error: 'Prediction failed' });
    }
  }
);

// ── Batch predict for multiple streams ──────────────────────
router.get('/batch',
  authenticate,
  validate([
    query('ids').isString().notEmpty().withMessage('Stream IDs required (comma-separated)'),
  ]),
  async (req, res) => {
    try {
      const ids = req.query.ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 100) {
        return res.status(400).json({ success: false, error: 'Max 100 stream IDs' });
      }
      const predictions = await model.predictBatch(ids);
      res.json({ success: true, data: predictions });
    } catch (err) {
      console.error('[Intel v2] Batch predict error:', err);
      res.status(500).json({ success: false, error: 'Batch prediction failed' });
    }
  }
);

// ── Get telemetry summary ───────────────────────────────────
router.get('/telemetry/:streamId',
  optionalAuth,
  validate([
    param('streamId').isUUID().withMessage('Invalid stream ID'),
    query('hours').optional().isInt({ min: 1, max: 168 }),
  ]),
  async (req, res) => {
    try {
      const hours = parseInt(req.query.hours, 10) || 24;
      const summary = await model.getTelemetrySummary(req.params.streamId, hours);
      res.json({ success: true, data: summary });
    } catch (err) {
      console.error('[Intel v2] Telemetry error:', err);
      res.status(500).json({ success: false, error: 'Telemetry query failed' });
    }
  }
);

// ── Record a telemetry event ────────────────────────────────
router.post('/record',
  authenticate,
  validate([
    body('streamId').isUUID().withMessage('Stream ID required'),
    body('failure').optional().isBoolean(),
    body('packetLoss').optional().isFloat({ min: 0, max: 100 }),
    body('cdnLatency').optional().isInt({ min: 0 }),
    body('viewerDropoff').optional().isFloat({ min: 0, max: 100 }),
    body('buffering').optional().isBoolean(),
    body('reconnect').optional().isBoolean(),
    body('bitrateDelta').optional().isFloat(),
    body('segmentMissing').optional().isBoolean(),
    body('region').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const { streamId, ...event } = req.body;
      const updates = await model.recordEvent(streamId, event);
      res.json({ success: true, data: updates });
    } catch (err) {
      console.error('[Intel v2] Record error:', err);
      res.status(500).json({ success: false, error: 'Failed to record telemetry' });
    }
  }
);

module.exports = router;
