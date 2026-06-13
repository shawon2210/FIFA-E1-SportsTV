// ============================================================
// A1TV v4 — White Label SaaS Routes
//
// Endpoints:
//   GET  /api/v1/whitelabel/theme           — Get tenant theme
//   PUT  /api/v1/whitelabel/theme           — Update theme
//   GET  /api/v1/whitelabel/theme/css        — Get CSS variables
//   POST /api/v1/whitelabel/domain           — Register custom domain
//   POST /api/v1/whitelabel/domain/verify   — Verify domain
//   GET  /api/v1/whitelabel/channels        — Tenant channels
//   POST /api/v1/whitelabel/channels        — Add channel
//   DELETE /api/v1/whitelabel/channels/:id  — Remove channel
//   GET  /api/v1/whitelabel/analytics        — Tenant analytics
//   GET  /api/v1/whitelabel/limits           — Check billing limits
// ============================================================

const { Router } = require('express');
const { authenticate, validate, query, param, body } = require('../middleware/auth');
const { whiteLabel } = require('../services/whiteLabel');

const router = Router();

// ── Theme ───────────────────────────────────────────────────
router.get('/theme', authenticate, async (req, res) => {
  try {
    const theme = await whiteLabel.getTheme(req.organizationId);
    res.json({ success: true, data: theme });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get theme' });
  }
});

router.put('/theme', authenticate, async (req, res) => {
  try {
    const theme = await whiteLabel.updateTheme(req.organizationId, req.body);
    res.json({ success: true, data: theme });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update theme' });
  }
});

router.get('/theme/css', authenticate, async (req, res) => {
  try {
    const theme = await whiteLabel.getTheme(req.organizationId);
    const css = whiteLabel.generateCssVariables(theme);
    res.setHeader('Content-Type', 'text/css');
    res.send(css);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to generate CSS' });
  }
});

// ── Custom Domains ──────────────────────────────────────────
router.post('/domain',
  authenticate,
  validate([body('domain').isFQDN().withMessage('Valid domain required')]),
  async (req, res) => {
    try {
      const result = await whiteLabel.registerDomain(req.organizationId, req.body.domain);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

router.post('/domain/verify',
  authenticate,
  validate([body('domain').isFQDN()]),
  async (req, res) => {
    try {
      const result = await whiteLabel.verifyDomain(req.organizationId, req.body.domain);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── Tenant Channels ─────────────────────────────────────────
router.get('/channels', authenticate, async (req, res) => {
  try {
    const channels = await whiteLabel.getTenantChannels(req.organizationId);
    res.json({ success: true, data: channels });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get channels' });
  }
});

router.post('/channels',
  authenticate,
  validate([
    body('channelId').isUUID(),
    body('customName').optional().isString(),
    body('sortOrder').optional().isInt(),
  ]),
  async (req, res) => {
    try {
      await whiteLabel.addChannelToTenant(req.organizationId, req.body.channelId, {
        customName: req.body.customName,
        sortOrder: req.body.sortOrder,
      });
      res.json({ success: true, message: 'Channel added' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

router.delete('/channels/:channelId',
  authenticate,
  validate([param('channelId').isUUID()]),
  async (req, res) => {
    try {
      await whiteLabel.removeChannelFromTenant(req.organizationId, req.params.channelId);
      res.json({ success: true, message: 'Channel removed' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── Analytics ───────────────────────────────────────────────
router.get('/analytics',
  authenticate,
  validate([query('days').optional().isInt({ min: 1, max: 365 })]),
  async (req, res) => {
    try {
      const analytics = await whiteLabel.getAnalytics(
        req.organizationId,
        parseInt(req.query.days, 10) || 30
      );
      res.json({ success: true, data: analytics });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
  }
);

// ── Billing Limits ──────────────────────────────────────────
router.get('/limits', authenticate, async (req, res) => {
  try {
    const limits = await whiteLabel.checkLimits(req.organizationId);
    res.json({ success: true, data: limits });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to check limits' });
  }
});

module.exports = router;
