// ============================================================
// A1TV v4 — Enterprise Security Routes
//
// SSO Configuration
//   GET  /api/v1/enterprise/sso/config          — Get SSO config
//   POST /api/v1/enterprise/sso/saml            — Configure SAML
//   POST /api/v1/enterprise/sso/oidc            — Configure OIDC
//   GET  /api/v1/enterprise/saml/:tenantId/auth — SAML AuthnRequest
//   POST /api/v1/enterprise/saml/:tenantId/acs  — SAML ACS
//   GET  /api/v1/enterprise/oidc/:tenantId/auth — OIDC Auth request
// SCIM
//   POST /api/v1/enterprise/scim/Users           — Provision user
//   PUT  /api/v1/enterprise/scim/Users/:id       — Update user
//   DELETE /api/v1/enterprise/scim/Users/:id     — Deprovision user
// GDPR
//   GET  /api/v1/enterprise/gdpr/export          — Export user data
//   DELETE /api/v1/enterprise/gdpr/delete        — Delete user data
//   POST /api/v1/enterprise/gdpr/consent         — Record consent
// Compliance
//   GET  /api/v1/enterprise/compliance           — Compliance status
// ============================================================

const { Router } = require('express');
const { authenticate, validate, query, param, body } = require('../middleware/auth');
const { enterpriseSecurity } = require('../services/enterprise');

const router = Router();

// ── SSO Configuration ───────────────────────────────────────
router.get('/sso/config', authenticate, async (req, res) => {
  try {
    const config = await enterpriseSecurity.getSSOConfig(req.organizationId);
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get SSO config' });
  }
});

router.post('/sso/saml',
  authenticate,
  validate([
    body('idpMetadataUrl').optional().isURL(),
    body('idpEntityId').optional().isString(),
    body('ssoUrl').optional().isURL(),
    body('x509Cert').optional().isString(),
  ]),
  async (req, res) => {
    try {
      const result = await enterpriseSecurity.configureSAML(req.organizationId, req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

router.post('/sso/oidc',
  authenticate,
  validate([
    body('issuer').isURL(),
    body('clientId').isString(),
    body('clientSecret').isString(),
  ]),
  async (req, res) => {
    try {
      const result = await enterpriseSecurity.configureOIDC(req.organizationId, req.body);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── SAML Endpoints ──────────────────────────────────────────
router.get('/saml/:tenantId/auth', async (req, res) => {
  try {
    const result = await enterpriseSecurity.generateSAMLRequest(req.params.tenantId);
    res.redirect(result.url);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/saml/:tenantId/acs',
  validate([body('SAMLResponse').isString()]),
  async (req, res) => {
    try {
      const user = await enterpriseSecurity.processSAMLResponse(
        req.params.tenantId,
        req.body.SAMLResponse
      );
      // Generate JWT and redirect
      res.json({ success: true, data: { user } });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── OIDC Endpoints ──────────────────────────────────────────
router.get('/oidc/:tenantId/auth', async (req, res) => {
  try {
    const result = await enterpriseSecurity.generateOIDCRequest(req.params.tenantId);
    res.json({ success: true, data: { url: result.url } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── SCIM Endpoints ──────────────────────────────────────────
router.post('/scim/Users',
  authenticate,
  validate([
    body('userName').isEmail(),
    body('displayName').optional().isString(),
    body('groups').optional().isArray(),
  ]),
  async (req, res) => {
    try {
      const user = await enterpriseSecurity.scimProvisionUser(req.organizationId, req.body);
      res.status(201).json({ success: true, data: user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

router.delete('/scim/Users/:userId',
  authenticate,
  validate([param('userId').isUUID()]),
  async (req, res) => {
    try {
      await enterpriseSecurity.scimDeprovisionUser(req.organizationId, req.params.userId);
      res.json({ success: true, message: 'User deprovisioned' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── GDPR Endpoints ──────────────────────────────────────────
router.get('/gdpr/export', authenticate, async (req, res) => {
  try {
    const data = await enterpriseSecurity.exportUserData(req.userId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

router.delete('/gdpr/delete', authenticate, async (req, res) => {
  try {
    await enterpriseSecurity.deleteUserData(req.userId);
    res.json({ success: true, message: 'All user data deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Deletion failed' });
  }
});

router.post('/gdpr/consent',
  authenticate,
  validate([
    body('purpose').isIn(['analytics', 'marketing', 'personalization']),
    body('granted').isBoolean(),
  ]),
  async (req, res) => {
    try {
      await enterpriseSecurity.recordConsent(req.userId, {
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.json({ success: true, message: 'Consent recorded' });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── Compliance Status ──────────────────────────────────────
router.get('/compliance', authenticate, async (req, res) => {
  try {
    const status = await enterpriseSecurity.getComplianceStatus(req.organizationId);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Compliance check failed' });
  }
});

module.exports = router;
