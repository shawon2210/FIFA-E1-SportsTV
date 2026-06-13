-- ============================================================
-- A1TV v4 -- Subscription & Billing Schema
-- Plans, subscriptions, invoices, entitlements, payment providers
-- ============================================================

-- ── Subscription Plans ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,           -- 'Free', 'Premium', 'Family', 'Enterprise'
    slug            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    tier            VARCHAR(50) NOT NULL,            -- free, basic, premium, team, enterprise
    price_monthly   DECIMAL(10,2) NOT NULL,          -- 0.00 for free
    price_annual    DECIMAL(10,2) NOT NULL,          -- 0.00 for free
    currency        VARCHAR(3) DEFAULT 'USD',
    max_streams     INTEGER DEFAULT 1,               -- Concurrent streams allowed
    max_devices     INTEGER DEFAULT 1,               -- Registered devices allowed
    max_quality     VARCHAR(10) DEFAULT '720p',      -- 360p, 480p, 720p, 1080p, 4k
    features        JSONB DEFAULT '{}',              -- { dvr: true, multiview: true, download: false }
    is_active       BOOLEAN DEFAULT true,
    is_public       BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    trial_days      INTEGER DEFAULT 0,
    grace_period_days INTEGER DEFAULT 3,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Tenant-specific plan overrides ──────────────────────────
CREATE TABLE IF NOT EXISTS tenant_plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    plan_id         UUID REFERENCES plans(id),
    custom_price_monthly DECIMAL(10,2),
    custom_price_annual  DECIMAL(10,2),
    custom_features JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, plan_id)
);

-- ── Subscriptions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    plan_id         UUID REFERENCES plans(id),
    tenant_id       UUID,
    -- Subscription state
    status          VARCHAR(20) DEFAULT 'active',    -- active, trialing, past_due, cancelled, expired, paused
    billing_cycle   VARCHAR(10) DEFAULT 'monthly',   -- monthly, annual
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end   TIMESTAMP WITH TIME ZONE,
    trial_ends_at   TIMESTAMP WITH TIME ZONE,
    cancelled_at    TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT false,
    -- Payment
    payment_provider VARCHAR(50),                    -- stripe, paddle, paypal, bkash, nagad
    payment_method_id VARCHAR(255),
    provider_subscription_id VARCHAR(255),           -- External subscription ID
    -- Metadata
    source          VARCHAR(50) DEFAULT 'web',       -- web, ios, android, admin, api
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period ON subscriptions(current_period_end);

-- ── Invoices ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES subscriptions(id),
    user_id         UUID NOT NULL,
    -- Invoice details
    invoice_number  VARCHAR(50) NOT NULL UNIQUE,
    status          VARCHAR(20) DEFAULT 'draft',     -- draft, open, paid, void, uncollectable
    amount_due      DECIMAL(10,2) NOT NULL,
    amount_paid     DECIMAL(10,2) DEFAULT 0,
    currency        VARCHAR(3) DEFAULT 'USD',
    -- Dates
    period_start    TIMESTAMP WITH TIME ZONE,
    period_end      TIMESTAMP WITH TIME ZONE,
    due_date        TIMESTAMP WITH TIME ZONE,
    paid_at         TIMESTAMP WITH TIME ZONE,
    -- Provider
    payment_provider VARCHAR(50),
    provider_invoice_id VARCHAR(255),
    -- Receipt
    receipt_url     TEXT,
    invoice_pdf_url TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- ── Payment Transactions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id      UUID REFERENCES invoices(id),
    user_id         UUID NOT NULL,
    -- Transaction
    type            VARCHAR(50) NOT NULL,            -- charge, refund, dispute, adjustment
    status          VARCHAR(20) NOT NULL,            -- pending, succeeded, failed, cancelled
    amount          DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    -- Provider
    payment_provider VARCHAR(50) NOT NULL,
    provider_transaction_id VARCHAR(255),
    provider_response JSONB DEFAULT '{}',
    failure_reason  TEXT,
    -- Metadata
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_txn_invoice ON payment_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_user ON payment_transactions(user_id);

-- ── Entitlements (feature access) ───────────────────────────
CREATE TABLE IF NOT EXISTS entitlements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    feature         VARCHAR(100) NOT NULL,           -- 'hd_streaming', 'dvr', 'multiview', etc.
    is_granted      BOOLEAN DEFAULT true,
    granted_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at      TIMESTAMP WITH TIME ZONE,
    source          VARCHAR(50) DEFAULT 'plan',      -- plan, promo, admin, compensation
    metadata        JSONB DEFAULT '{}',
    UNIQUE(subscription_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_subscription ON entitlements(subscription_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);

-- ── Coupons / Promo Codes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    discount_type   VARCHAR(20) NOT NULL,            -- percentage, fixed
    discount_value  DECIMAL(10,2) NOT NULL,          -- 20.00 = 20% or $20
    currency        VARCHAR(3) DEFAULT 'USD',
    -- Limits
    max_redemptions INTEGER,
    current_redemptions INTEGER DEFAULT 0,
    valid_from      TIMESTAMP WITH TIME ZONE,
    valid_until     TIMESTAMP WITH TIME ZONE,
    applies_to      VARCHAR(50) DEFAULT 'all',       -- all, monthly, annual, specific_plan
    plan_id         UUID REFERENCES plans(id),
    is_active       BOOLEAN DEFAULT true,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Insert default plans ────────────────────────────────────
INSERT INTO plans (name, slug, description, tier, price_monthly, price_annual, max_streams, max_devices, max_quality, features, trial_days, sort_order)
VALUES
    ('Free', 'free', 'Limited access with ads', 'free', 0, 0, 1, 1, '480p',
     '{"ads": true, "dvr": false, "multiview": false, "download": false, "live_pause": false}', 0, 1),
    ('Basic', 'basic', 'Standard HD streaming', 'basic', 4.99, 49.99, 1, 2, '1080p',
     '{"ads": false, "dvr": false, "multiview": false, "download": false, "live_pause": false}', 7, 2),
    ('Premium', 'premium', 'Full HD, DVR, MultiView', 'premium', 9.99, 99.99, 3, 5, '1080p',
     '{"ads": false, "dvr": true, "multiview": true, "download": true, "live_pause": true}', 14, 3),
    ('Family', 'family', 'Up to 6 simultaneous streams', 'team', 14.99, 149.99, 6, 10, '4k',
     '{"ads": false, "dvr": true, "multiview": true, "download": true, "live_pause": true, "profiles": 6}', 14, 4),
    ('Enterprise', 'enterprise', 'Custom solution for organizations', 'enterprise', 0, 0, 100, 1000, '4k',
     '{"ads": false, "dvr": true, "multiview": true, "download": true, "live_pause": true, "saml": true, "scim": true, "api_access": true}', 30, 5)
ON CONFLICT (slug) DO NOTHING;
