// ============================================================
// A1TV v4 — Billing Engine
// Subscription management, payment processing, entitlements.
//
// Provider Abstraction:
//   PaymentProvider (interface)
//     ├── StripeProvider
//     ├── PaddleProvider
//     ├── PayPalProvider
//     ├── BKashProvider
//     └── NagadProvider
// ============================================================

const db = require('../config/database');
const cache = require('../config/services/cache');
const crypto = require('crypto');

// ── Payment Provider Interface ───────────────────────────────
class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  async createCustomer(user) { throw new Error('Not implemented'); }
  async createSubscription(customer, plan, options) { throw new Error('Not implemented'); }
  async cancelSubscription(subscriptionId) { throw new Error('Not implemented'); }
  async createCheckoutSession(plan, user, options) { throw new Error('Not implemented'); }
  async handleWebhook(payload, signature) { throw new Error('Not implemented'); }
  async createRefund(transactionId, amount) { throw new Error('Not implemented'); }
  async getPaymentMethods(customerId) { throw new Error('Not implemented'); }
}

// ── Stripe Provider ─────────────────────────────────────────
class StripeProvider extends PaymentProvider {
  constructor() {
    super('stripe');
    this.stripe = null;
    this._initialized = false;
  }

  _ensureInit() {
    if (!this._initialized) {
      const secretKey = process.env.STRIPE_SECRET_KEY;
      if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY not configured');
      }
      try {
        this.stripe = require('stripe')(secretKey);
      } catch {
        throw new Error('stripe package not installed. Run: npm install stripe');
      }
      this._initialized = true;
    }
  }

  async createCustomer(user) {
    this._ensureInit();
    return this.stripe.customers.create({
      email: user.email,
      name: user.name || user.email,
      metadata: { a1tv_user_id: user.id },
    });
  }

  async createSubscription(customer, plan, options = {}) {
    this._ensureInit();

    const stripePlanId = plan.metadata?.stripe_plan_id;
    if (!stripePlanId) {
      throw new Error(`No Stripe plan ID for plan ${plan.id}`);
    }

    const subscription = await this.stripe.subscriptions.create({
      customer: customer.id || customer,
      items: [{ price: stripePlanId }],
      trial_period_days: plan.trial_days || 0,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        a1tv_plan_id: plan.id,
        a1tv_user_id: options.userId,
      },
    });

    return {
      id: subscription.id,
      status: subscription.status,
      clientSecret: subscription.latest_invoice?.payment_intent?.client_secret,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    };
  }

  async cancelSubscription(subscriptionId) {
    this._ensureInit();
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async createCheckoutSession(plan, user, options = {}) {
    this._ensureInit();

    const priceId = plan.metadata?.stripe_price_id;
    if (!priceId) {
      throw new Error(`No Stripe price ID for plan ${plan.id}`);
    }

    return this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: options.successUrl || `${process.env.FRONTEND_URL}/billing/success`,
      cancel_url: options.cancelUrl || `${process.env.FRONTEND_URL}/billing/cancel`,
      subscription_data: {
        trial_period_days: plan.trial_days || 0,
        metadata: { a1tv_plan_id: plan.id, a1tv_user_id: user.id },
      },
    });
  }

  async handleWebhook(payload, signature) {
    this._ensureInit();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    if (webhookSecret) {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } else {
      event = JSON.parse(payload);
    }

    return { type: event.type, data: event.data.object };
  }

  async createRefund(transactionId, amount) {
    this._ensureInit();
    return this.stripe.refunds.create({
      charge: transactionId,
      amount: Math.round(amount * 100), // cents
    });
  }

  async getPaymentMethods(customerId) {
    this._ensureInit();
    return this.stripe.paymentMethods.list({ customer: customerId, type: 'card' });
  }
}

// ── Paddle Provider ─────────────────────────────────────────
class PaddleProvider extends PaymentProvider {
  constructor() {
    super('paddle');
    this.vendorId = process.env.PADDLE_VENDOR_ID;
    this.apiKey = process.env.PADDLE_API_KEY;
    this.publicKey = process.env.PADDLE_PUBLIC_KEY;
  }

  async createCheckoutSession(plan, user, options = {}) {
    const planId = plan.metadata?.paddle_plan_id;
    if (!planId) throw new Error(`No Paddle plan ID for plan ${plan.id}`);

    return {
      checkoutUrl: `https://checkout.paddle.com/checkout/${planId}?passthrough=${user.id}`,
      provider: 'paddle',
    };
  }

  async handleWebhook(payload) {
    // Paddle sends form-encoded webhook data
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { type: data.alert_name, data };
  }
}

// ── PayPal Provider ─────────────────────────────────────────
class PayPalProvider extends PaymentProvider {
  constructor() {
    super('paypal');
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    this.sandbox = process.env.PAYPAL_SANDBOX !== 'false';
  }

  async createCheckoutSession(plan, user, options = {}) {
    const planId = plan.metadata?.paypal_plan_id;
    if (!planId) throw new Error(`No PayPal plan ID for plan ${plan.id}`);

    return {
      provider: 'paypal',
      planId,
      sandbox: this.sandbox,
      clientId: this.clientId,
    };
  }

  async handleWebhook(payload, headers) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { type: data.event_type, data };
  }
}

// ── bKash Provider (Bangladesh) ─────────────────────────────
class BKashProvider extends PaymentProvider {
  constructor() {
    super('bkash');
    this.appKey = process.env.BKASH_APP_KEY;
    this.appSecret = process.env.BKASH_APP_SECRET;
    this.username = process.env.BKASH_USERNAME;
    this.password = process.env.BKASH_PASSWORD;
    this.baseUrl = process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';
  }

  async createCheckoutSession(plan, user, options = {}) {
    // bKash uses a token-based payment flow
    const amount = options.billingCycle === 'annual' ? plan.price_annual : plan.price_monthly;

    return {
      provider: 'bkash',
      amount,
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: `A1TV-${Date.now()}-${user.id.substring(0, 8)}`,
      callbackUrl: `${process.env.FRONTEND_URL}/billing/bkash/callback`,
    };
  }

  async handleWebhook(payload) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { type: data.transactionStatus, data };
  }
}

// ── Nagad Provider (Bangladesh) ─────────────────────────────
class NagadProvider extends PaymentProvider {
  constructor() {
    super('nagad');
    this.merchantId = process.env.NAGAD_MERCHANT_ID;
    this.merchantNumber = process.env.NAGAD_MERCHANT_NUMBER;
    this.publicKey = process.env.NAGAD_PUBLIC_KEY;
    this.privateKey = process.env.NAGAD_PRIVATE_KEY;
    this.baseUrl = process.env.NAGAD_BASE_URL || 'https://api.mynagad.com';
  }

  async createCheckoutSession(plan, user, options = {}) {
    const amount = options.billingCycle === 'annual' ? plan.price_annual : plan.price_monthly;

    return {
      provider: 'nagad',
      amount,
      currency: 'BDT',
      orderId: `A1TV-${Date.now()}-${user.id.substring(0, 8)}`,
      callbackUrl: `${process.env.FRONTEND_URL}/billing/nagad/callback`,
    };
  }

  async handleWebhook(payload) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    return { type: data.status, data };
  }
}

// ── Provider Factory ────────────────────────────────────────
const providers = {
  stripe: () => new StripeProvider(),
  paddle: () => new PaddleProvider(),
  paypal: () => new PayPalProvider(),
  bkash: () => new BKashProvider(),
  nagad: () => new NagadProvider(),
};

function getProvider(name) {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown payment provider: ${name}`);
  return factory();
}

// ── Billing Engine ──────────────────────────────────────────
class BillingEngine {
  constructor() {
    this.providers = {};
  }

  getProvider(name) {
    if (!this.providers[name]) {
      this.providers[name] = getProvider(name);
    }
    return this.providers[name];
  }

  // ── Plans ─────────────────────────────────────────────────
  async getPlans(tenantId = null) {
    const cacheKey = `billing:plans:${tenantId || 'default'}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    let plans = await db('plans')
      .where({ is_active: true, is_public: true })
      .orderBy('sort_order');

    // Apply tenant-specific pricing if applicable
    if (tenantId) {
      for (const plan of plans) {
        const override = await db('tenant_plans')
          .where({ tenant_id: tenantId, plan_id: plan.id, is_active: true })
          .first();
        if (override) {
          if (override.custom_price_monthly) plan.price_monthly = override.custom_price_monthly;
          if (override.custom_price_annual) plan.price_annual = override.custom_price_annual;
          if (override.custom_features) plan.features = { ...plan.features, ...override.custom_features };
        }
      }
    }

    await cache.set(cacheKey, plans, 300);
    return plans;
  }

  async getPlan(planId) {
    return db('plans').where({ id: planId, is_active: true }).first();
  }

  async getPlanBySlug(slug) {
    return db('plans').where({ slug, is_active: true }).first();
  }

  // ── Subscriptions ─────────────────────────────────────────
  async getSubscription(userId) {
    return db('subscriptions as s')
      .join('plans as p', 's.plan_id', 'p.id')
      .where({ 's.user_id': userId })
      .whereIn('s.status', ['active', 'trialing', 'past_due'])
      .orderBy('s.created_at', 'desc')
      .select('s.*', 'p.name as plan_name', 'p.slug as plan_slug', 'p.features as plan_features')
      .first();
  }

  async createSubscription(userId, planId, providerName, options = {}) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Plan not found');

    // Check for existing active subscription
    const existing = await this.getSubscription(userId);
    if (existing) {
      throw new Error('User already has an active subscription');
    }

    const subscription = await db('subscriptions').insert({
      user_id: userId,
      plan_id: planId,
      tenant_id: options.tenantId || null,
      status: plan.trial_days > 0 ? 'trialing' : 'active',
      billing_cycle: options.billingCycle || 'monthly',
      current_period_start: new Date(),
      current_period_end: new Date(Date.now() + (plan.trial_days > 0 ? plan.trial_days : 30) * 86400000),
      trial_ends_at: plan.trial_days > 0 ? new Date(Date.now() + plan.trial_days * 86400000) : null,
      payment_provider: providerName,
      source: options.source || 'web',
    }).returning('*');

    // Create entitlements
    await this.syncEntitlements(subscription[0].id, plan);

    return subscription[0];
  }

  async cancelSubscription(userId, atPeriodEnd = true) {
    const sub = await this.getSubscription(userId);
    if (!sub) throw new Error('No active subscription');

    if (atPeriodEnd) {
      await db('subscriptions').where({ id: sub.id }).update({
        cancel_at_period_end: true,
        updated_at: new Date(),
      });
    } else {
      // Cancel with provider
      if (sub.payment_provider && sub.provider_subscription_id) {
        try {
          const provider = this.getProvider(sub.payment_provider);
          await provider.cancelSubscription(sub.provider_subscription_id);
        } catch (err) {
          console.error('[Billing] Provider cancel error:', err.message);
        }
      }

      await db('subscriptions').where({ id: sub.id }).update({
        status: 'cancelled',
        cancelled_at: new Date(),
        updated_at: new Date(),
      });

      // Revoke entitlements
      await db('entitlements').where({ subscription_id: sub.id }).update({ is_granted: false });
    }

    return { success: true, atPeriodEnd };
  }

  // ── Entitlements ──────────────────────────────────────────
  async syncEntitlements(subscriptionId, plan) {
    const features = plan.features || {};
    const entitlements = [];

    // Map plan features to entitlements
    const featureMap = {
      hd_streaming: features.max_quality && ['1080p', '4k'].includes(features.max_quality),
      dvr: features.dvr === true,
      multiview: features.multiview === true,
      download: features.download === true,
      live_pause: features.live_pause === true,
      no_ads: features.ads === false,
      profiles: features.profiles > 0,
      saml: features.saml === true,
      scim: features.scim === true,
      api_access: features.api_access === true,
    };

    for (const [feature, granted] of Object.entries(featureMap)) {
      if (granted) {
        entitlements.push({
          subscription_id: subscriptionId,
          feature,
          is_granted: true,
          source: 'plan',
        });
      }
    }

    if (entitlements.length > 0) {
      await db('entitlements')
        .insert(entitlements)
        .onConflict(['subscription_id', 'feature'])
        .merge({ is_granted: true, granted_at: new Date() });
    }
  }

  async checkEntitlement(userId, feature) {
    const cacheKey = `billing:entitlement:${userId}:${feature}`;
    const cached = await cache.get(cacheKey);
    if (cached !== null) return cached;

    const entitlement = await db('entitlements as e')
      .join('subscriptions as s', 'e.subscription_id', 's.id')
      .where({
        's.user_id': userId,
        'e.feature': feature,
        'e.is_granted': true,
      })
      .whereIn('s.status', ['active', 'trialing'])
      .where(function() {
        this.whereNull('e.expires_at').orWhere('e.expires_at', '>', new Date());
      })
      .first();

    const granted = !!entitlement;
    await cache.set(cacheKey, granted, 60);
    return granted;
  }

  async getUserEntitlements(userId) {
    return db('entitlements as e')
      .join('subscriptions as s', 'e.subscription_id', 's.id')
      .where({ 's.user_id': userId, 'e.is_granted': true })
      .whereIn('s.status', ['active', 'trialing'])
      .select('e.feature', 'e.granted_at', 'e.expires_at', 'e.source');
  }

  // ── Invoices ──────────────────────────────────────────────
  async getInvoices(userId, limit = 20) {
    return db('invoices')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(limit);
  }

  async createInvoice(subscriptionId, amount, periodStart, periodEnd) {
    const invoiceNumber = `INV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const [invoice] = await db('invoices').insert({
      subscription_id: subscriptionId,
      invoice_number: invoiceNumber,
      status: 'open',
      amount_due: amount,
      period_start: periodStart,
      period_end: periodEnd,
      due_date: new Date(Date.now() + 3 * 86400000), // 3 days
    }).returning('*');

    return invoice;
  }

  // ── Webhook Processing ────────────────────────────────────
  async processWebhook(providerName, payload, signature) {
    const provider = this.getProvider(providerName);
    const event = await provider.handleWebhook(payload, signature);

    console.log(`[Billing] Webhook from ${providerName}: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed':
      case 'invoice.paid':
        await this.handlePaymentSuccess(event.data);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailure(event.data);
        break;
      case 'customer.subscription.deleted':
      case 'subscription_canceled':
        await this.handleSubscriptionCancelled(event.data);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data);
        break;
    }

    return event;
  }

  async handlePaymentSuccess(data) {
    const providerSubId = data.subscription || data.id;
    await db('subscriptions')
      .where({ provider_subscription_id: providerSubId })
      .update({
        status: 'active',
        updated_at: new Date(),
      });
  }

  async handlePaymentFailure(data) {
    const providerSubId = data.subscription || data.id;
    await db('subscriptions')
      .where({ provider_subscription_id: providerSubId })
      .update({
        status: 'past_due',
        updated_at: new Date(),
      });
  }

  async handleSubscriptionCancelled(data) {
    const providerSubId = data.subscription || data.id;
    await db('subscriptions')
      .where({ provider_subscription_id: providerSubId })
      .update({
        status: 'cancelled',
        cancelled_at: new Date(),
        updated_at: new Date(),
      });
  }

  async handleSubscriptionUpdated(data) {
    const providerSubId = data.subscription || data.id;
    const status = data.status;
    if (status) {
      await db('subscriptions')
        .where({ provider_subscription_id: providerSubId })
        .update({ status, updated_at: new Date() });
    }
  }
}

module.exports = {
  BillingEngine,
  billing: new BillingEngine(),
  PaymentProvider,
  StripeProvider,
  PaddleProvider,
  PayPalProvider,
  BKashProvider,
  NagadProvider,
  getProvider,
  providers,
};
