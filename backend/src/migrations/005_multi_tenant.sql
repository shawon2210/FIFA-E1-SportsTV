-- ============================================================
-- Phase 9: Multi-Tenant Platform
-- Organizations, white-label support, tenant isolation
-- ============================================================

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    domain          VARCHAR(255) UNIQUE,              -- Custom domain (e.g., brand-a.com)
    status          VARCHAR(20) DEFAULT 'active',     -- active, suspended, trial, expired
    plan            VARCHAR(20) DEFAULT 'free',       -- free, starter, pro, enterprise
    settings        JSONB DEFAULT '{}',               -- White-label settings
    branding        JSONB DEFAULT '{}',               -- Colors, logos, favicon
    channel_limit   INTEGER DEFAULT 100,
    user_limit      INTEGER DEFAULT 10,
    expires_at      TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization users (membership + roles)
CREATE TABLE IF NOT EXISTS organization_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            VARCHAR(20) DEFAULT 'member',     -- owner, admin, editor, member, viewer
    permissions     JSONB DEFAULT '{}',               -- granular permissions
    is_active       BOOLEAN DEFAULT true,
    joined_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_org_users_org ON organization_users(organization_id);
CREATE INDEX idx_org_users_user ON organization_users(user_id);

-- Organization channel assignments (custom lineups)
CREATE TABLE IF NOT EXISTS organization_channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    is_visible      BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    custom_name     VARCHAR(255),                     -- Override channel name per tenant
    custom_logo     TEXT,                             -- Override logo per tenant
    categories      TEXT[],                           -- Tenant-specific categories
    added_by        UUID REFERENCES users(id),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, channel_id)
);

CREATE INDEX idx_org_channels_org ON organization_channels(organization_id);
CREATE INDEX idx_org_channels_ch ON organization_channels(channel_id);

-- Organization-specific favorites
CREATE TABLE IF NOT EXISTS organization_favorites (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, user_id, channel_id)
);

-- Organization-specific EPG categories
CREATE TABLE IF NOT EXISTS organization_epg_categories (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(100) NOT NULL,
    icon            VARCHAR(10),
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    UNIQUE (organization_id, slug)
);

-- Tenant isolation: add organization_id to existing tables
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watch_history' AND column_name='organization_id') THEN
        ALTER TABLE watch_history ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='channel_views' AND column_name='organization_id') THEN
        ALTER TABLE channel_views ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='play_events' AND column_name='organization_id') THEN
        ALTER TABLE play_events ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='search_queries' AND column_name='organization_id') THEN
        ALTER TABLE search_queries ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX idx_watch_history_org ON watch_history(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_channel_views_org ON channel_views(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_play_events_org ON play_events(organization_id) WHERE organization_id IS NOT NULL;

-- Subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(50) NOT NULL UNIQUE,
    description     TEXT,
    price_monthly   DECIMAL(10,2) DEFAULT 0,
    price_yearly    DECIMAL(10,2) DEFAULT 0,
    channel_limit   INTEGER DEFAULT 100,
    user_limit      INTEGER DEFAULT 10,
    features        JSONB DEFAULT '{}',               -- Feature flags per plan
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO subscription_plans (name, slug, description, price_monthly, price_yearly, channel_limit, user_limit, features) VALUES
    ('Free', 'free', 'Basic access with limited channels', 0, 0, 50, 3, '{"white_label": false, "custom_domain": false, "analytics": false}'),
    ('Starter', 'starter', 'Growing brands with custom lineup', 29, 290, 500, 10, '{"white_label": true, "custom_domain": false, "analytics": true}'),
    ('Pro', 'pro', 'Full white-label with custom domain', 99, 990, 5000, 50, '{"white_label": true, "custom_domain": true, "analytics": true, "api_access": true}'),
    ('Enterprise', 'enterprise', 'Unlimited with dedicated support', NULL, NULL, NULL, NULL, '{"white_label": true, "custom_domain": true, "analytics": true, "api_access": true, "dedicated_support": true}')
ON CONFLICT (slug) DO NOTHING;

-- Organization subscriptions
CREATE TABLE IF NOT EXISTS organization_subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
    status          VARCHAR(20) DEFAULT 'active',     -- active, past_due, canceled, trialing
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end   TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT false,
    payment_provider VARCHAR(50),
    external_subscription_id VARCHAR(255),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Triggers
CREATE OR REPLACE FUNCTION update_org_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_organizations_updated_at') THEN
        CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_org_subscriptions_updated_at') THEN
        CREATE TRIGGER trg_org_subscriptions_updated_at BEFORE UPDATE ON organization_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- View: Organization dashboard stats
CREATE OR REPLACE VIEW v_organization_stats AS
SELECT
    o.id,
    o.name,
    o.slug,
    o.status,
    o.plan,
    (SELECT COUNT(*) FROM organization_users ou WHERE ou.organization_id = o.id AND ou.is_active = true) as active_users,
    (SELECT COUNT(*) FROM organization_channels oc WHERE oc.organization_id = o.id AND oc.is_visible = true) as visible_channels,
    (SELECT COUNT(*) FROM organization_favorites of WHERE of.organization_id = o.id) as total_favorites,
    (SELECT COUNT(*) FROM channel_views cv WHERE cv.organization_id = o.id AND cv.viewed_at > NOW() - INTERVAL '24 hours') as views_24h,
    o.channel_limit,
    o.user_limit,
    o.created_at
FROM organizations o;
