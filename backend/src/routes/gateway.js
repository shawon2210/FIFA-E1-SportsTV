// ============================================================
// A1TV v4 — Stream Gateway Routes
// Exposes gateway functionality via REST API.
//
// Endpoints:
//   GET  /api/v1/gateway/route/:channelId  — Route to best origin
//   POST /api/v1/gateway/token/validate     — Validate stream token
//   GET  /api/v1/gateway/status             — Gateway status
//   GET  /api/v1/gateway/regions            — List regions
// ============================================================

const { Router } = require('express');
const { authenticate, optionalAuth, validate, query, param, body } = require('../middleware/auth');
const {
  StreamGateway,
  validateStreamToken,
  REGIONS,
  originHealth,
  checkGeoRestriction,
} = require('./index');

const router = Router();

// ── Middleware: Extract geo info from headers ─────────────────
function extractGeo(req, res, next) {
  // Cloudflare headers
  const cfCountry = req.headers['cf-ipcountry'];
  // Generic forwarded
  const xCountry = req.headers['x-country-code'];
  // IP-based (fallback)
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.connection.remoteAddress;

  req.geoCountry = cfCountry || xCountry || null;
  req.clientIP = clientIP;
  next();
}

router.use(extractGeo);

// ── Route to best origin for a stream ───────────────────────
router.get('/route/:channelId',
  optionalAuth,
  validate([
    param('channelId').isUUID().withMessage('Invalid channel ID'),
    query('protocol').optional().isIn(['hls', 'dash', 'ws']).withMessage('Invalid protocol'),
    query('quality').optional().isIn(['auto', '1080p', '720p', '480p', '360p']),
  ]),
  async (req, res) => {
    try {
      const { channelId } = req.params;
      const userId = req.userId || 'anonymous';

      const result = await StreamGateway.route({
        channelId,
        userId,
        countryCode: req.geoCountry,
        clientIP: req.clientIP,
      });

      if (!result.success) {
        const status = result.error === 'geo_blocked' ? 403 : 503;
        return res.status(status).json({
          success: false,
          error: result.error,
          reason: result.reason,
          region: result.region,
        });
      }

      res.json({
        success: true,
        data: {
          channelId,
          region: result.region,
          regionName: result.regionName,
          edgeNode: result.edgeNode,
          origin: result.origin,
          token: result.streamToken,
          tokenExpires: result.tokenExpires,
          urls: result.urls,
          clientCountry: req.geoCountry,
          clientIP: req.clientIP,
        },
      });
    } catch (err) {
      console.error('[Gateway] Route error:', err);
      res.status(500).json({ success: false, error: 'Gateway routing failed' });
    }
  }
);

// ── Validate a stream token ─────────────────────────────────
router.post('/token/validate',
  validate([
    body('token').isString().notEmpty().withMessage('Token required'),
  ]),
  async (req, res) => {
    try {
      const { token } = req.body;
      const result = validateStreamToken(token);

      if (!result.valid) {
        return res.status(401).json({
          success: false,
          valid: false,
          reason: result.reason,
        });
      }

      // Also check geo if country header present
      if (req.geoCountry) {
        const geoCheck = await checkGeoRestriction(result.channelId, req.geoCountry);
        if (!geoCheck.allowed) {
          return res.status(403).json({
            success: false,
            valid: false,
            reason: 'geo_blocked',
          });
        }
      }

      res.json({
        success: true,
        valid: true,
        channelId: result.channelId,
        region: result.regionId,
        expires: result.expires,
      });
    } catch (err) {
      console.error('[Gateway] Token validation error:', err);
      res.status(500).json({ success: false, error: 'Token validation failed' });
    }
  }
);

// ── Gateway status across all regions ───────────────────────
router.get('/status', async (req, res) => {
  try {
    const status = StreamGateway.getStatus();
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Gateway] Status error:', err);
    res.status(500).json({ success: false, error: 'Status check failed' });
  }
});

// ── List available regions ──────────────────────────────────
router.get('/regions', (req, res) => {
  const regions = Object.entries(REGIONS).map(([id, r]) => ({
    id,
    name: r.name,
    priority: r.priority,
    countries: r.countries,
    edgeNodes: r.edgeNodes.length,
    originCount: r.origins.length,
  }));

  res.json({
    success: true,
    data: regions.sort((a, b) => a.priority - b.priority),
  });
});

// ── Origin health details (admin only) ──────────────────────
router.get('/health/origins', authenticate, async (req, res) => {
  try {
    const health = originHealth.getStatus();
    res.json({
      success: true,
      data: health,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Health check failed' });
  }
});

module.exports = router;
