-- ============================================================
-- Phase 16: Commercial Features
-- Subscription engine, billing, entitlements
-- ============================================================

-- Entitlements (feature flags per plan)
CREATE TABLE IF NOT EXISTS entitlements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id         UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
    feature         VARCHAR(100) NOT NULL,
    enabled         BOOLEAN DEFAULT true,
    limit_value     INTEGER,                          -- NULL = unlimited
    UNIQUE (plan_id, feature)
);

-- Insert default entitlements per plan
INSERT INTO entitlements (plan_id, feature, enabled, limit_value)
SELECT id, 'max_channels', true, channel_limit FROM subscription_plans ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, max_concurrent_streams', true, 1) FROM subscription_plans WHERE slug = 'free' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'max_concurrent_streams', true, 3) FROM subscription_plans WHERE slug = 'starter' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'max_concurrent_streams', true, 10) FROM subscription_plans WHERE slug = 'pro' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'max_concurrent_streams', true, NULL) FROM subscription_plans WHERE slug = 'enterprise' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'white_label', true, NULL) FROM subscription_plans WHERE slug != 'free' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'custom_domain', true, NULL) FROM subscription_plans WHERE slug IN ('pro', 'enterprise') ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'analytics', true, NULL) FROM subscription_plans WHERE slug != 'free' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'api_access', true, NULL) FROM subscription_plans WHERE slug IN ('pro', 'enterprise') ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'dedicated_support', true, NULL) FROM subscription_plans WHERE slug = 'enterprise' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'sports_package', true, NULL) FROM subscription_plans WHERE slug != 'free' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'news_package', true, NULL) FROM subscription_plans WHERE slug != 'free' ON CONFLICT DO NOTHING;
INSERT INTO entitlements (plan_id, feature, 'premium_quality', true, NULL) FROM subscription_plans WHERE slug IN ('pro', 'enterprise') ON CONFLICT DO NOTHING;

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    subscription_id UUID REFERENCES organization_subscriptions(id),
    amount          DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3) DEFAULT 'USD',
    status          VARCHAR(20) DEFAULT 'pending',    -- pending, paid, failed, refunded
    billing_period_start DATE,
    billing_period_end   DATE,
    payment_provider VARCHAR(50),
    external_invoice_id  VARCHAR(255),
    paid_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Usage tracking (for usage-based billing)
CREATE TABLE IF NOT EXISTS usage_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    metric          VARCHAR(50) NOT NULL,             -- api_calls, bandwidth_gb, streams, viewers
    quantity        DECIMAL(12,2) NOT NULL,
    recorded_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_usage_org ON usage_records(organization_id, metric, recorded_at);
