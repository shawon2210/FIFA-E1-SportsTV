// ============================================================
// A1TV v4 — Billing Routes
//
// Endpoints:
//   GET  /api/v1/billing/plans               — List plans
//   GET  /api/v1/billing/subscription        — Current subscription
//   POST /api/v1/billing/subscription        — Create subscription
//   POST /api/v1/billing/checkout            — Create checkout session
//   POST /api/v1/billing/cancel              — Cancel subscription
//   GET  /api/v1/billing/invoices            — List invoices
//   GET  /api/v1/billing/entitlements        — User entitlements
//   GET  /api/v1/billing/entitlements/:feature — Check entitlement
//   POST /api/v1/billing/webhook/:provider   — Payment provider webhook
// ============================================================

const { Router } = require('express');
const { authenticate, optionalAuth, validate, query, param, body } = require('../middleware/auth');
const { billing } = require('../services/billing');

const router = Router();

// ── List plans ──────────────────────────────────────────────
router.get('/plans', optionalAuth, async (req, res) => {
  try {
    const plans = await billing.getPlans(req.organizationId);
    res.json({ success: true, data: plans });
  } catch (err) {
    console.error('[Billing] Plans error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch plans' });
  }
});

// ── Current subscription ────────────────────────────────────
router.get('/subscription', authenticate, async (req, res) => {
  try {
    const subscription = await billing.getSubscription(req.userId);
    const entitlements = await billing.getUserEntitlements(req.userId);

    res.json({
      success: true,
      data: {
        subscription,
        entitlements,
      },
    });
  } catch (err) {
    console.error('[Billing] Subscription error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch subscription' });
  }
});

// ── Create subscription ─────────────────────────────────────
router.post('/subscription',
  authenticate,
  validate([
    body('planId').isUUID().withMessage('Plan ID required'),
    body('provider').isIn(['stripe', 'paddle', 'paypal', 'bkash', 'nagad']).withMessage('Provider required'),
    body('billingCycle').optional().isIn(['monthly', 'annual']),
  ]),
  async (req, res) => {
    try {
      const subscription = await billing.createSubscription(
        req.userId,
        req.body.planId,
        req.body.provider,
        {
          billingCycle: req.body.billingCycle,
          tenantId: req.organizationId,
        }
      );

      res.json({ success: true, data: subscription });
    } catch (err) {
      console.error('[Billing] Create subscription error:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── Create checkout session ─────────────────────────────────
router.post('/checkout',
  authenticate,
  validate([
    body('planId').isUUID().withMessage('Plan ID required'),
    body('provider').isIn(['stripe', 'paddle', 'paypal', 'bkash', 'nagad']),
    body('billingCycle').optional().isIn(['monthly', 'annual']),
  ]),
  async (req, res) => {
    try {
      const plan = await billing.getPlan(req.body.planId);
      if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

      const provider = billing.getProvider(req.body.provider);
      const session = await provider.createCheckoutSession(plan, req.user, {
        billingCycle: req.body.billingCycle || 'monthly',
        successUrl: req.body.successUrl,
        cancelUrl: req.body.cancelUrl,
      });

      res.json({ success: true, data: session });
    } catch (err) {
      console.error('[Billing] Checkout error:', err);
      res.status(500).json({ success: false, error: 'Checkout session failed', details: err.message });
    }
  }
);

// ── Cancel subscription ─────────────────────────────────────
router.post('/cancel',
  authenticate,
  validate([
    body('atPeriodEnd').optional().isBoolean(),
  ]),
  async (req, res) => {
    try {
      const result = await billing.cancelSubscription(
        req.userId,
        req.body.atPeriodEnd !== false // Default true
      );
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[Billing] Cancel error:', err);
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

// ── Invoices ────────────────────────────────────────────────
router.get('/invoices',
  authenticate,
  validate([query('limit').optional().isInt({ min: 1, max: 100 })]),
  async (req, res) => {
    try {
      const invoices = await billing.getInvoices(
        req.userId,
        parseInt(req.query.limit, 10) || 20
      );
      res.json({ success: true, data: invoices });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
    }
  }
);

// ── Entitlements ────────────────────────────────────────────
router.get('/entitlements', authenticate, async (req, res) => {
  try {
    const entitlements = await billing.getUserEntitlements(req.userId);
    res.json({ success: true, data: entitlements });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch entitlements' });
  }
});

// ── Check specific entitlement ──────────────────────────────
router.get('/entitlements/:feature', authenticate, async (req, res) => {
  try {
    const granted = await billing.checkEntitlement(req.userId, req.params.feature);
    res.json({ success: true, data: { feature: req.params.feature, granted } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to check entitlement' });
  }
});

// ── Payment provider webhooks ───────────────────────────────
router.post('/webhook/:provider',
  validate([
    param('provider').isIn(['stripe', 'paddle', 'paypal', 'bkash', 'nagad']),
  ]),
  async (req, res) => {
    try {
      const provider = req.params.provider;
      const signature = req.headers['stripe-signature']
        || req.headers['paddle-signature']
        || req.headers['paypal-transmission-id']
        || '';

      const event = await billing.processWebhook(
        provider,
        req.body,
        signature
      );

      res.json({ success: true, received: true, type: event.type });
    } catch (err) {
      console.error('[Billing] Webhook error:', err);
      // Always return 200 to prevent provider retries for unknown events
      res.status(200).json({ success: true, processed: false });
    }
  }
);

module.exports = router;
