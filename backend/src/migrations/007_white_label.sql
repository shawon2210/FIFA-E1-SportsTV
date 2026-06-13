-- ============================================================
-- A1TV v4 -- White Label SaaS Schema
-- Tenant themes, branding, domains, analytics, billing
-- ============================================================

-- ── Tenant Branding / Themes ────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_themes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    -- Branding
    logo_url        TEXT,
    logo_dark_url   TEXT,
    favicon_url     TEXT,
    -- Colors
    primary_color   VARCHAR(7) DEFAULT '#1a73e8',
    secondary_color VARCHAR(7) DEFAULT '#34a853',
    accent_color    VARCHAR(7) DEFAULT '#fbbc04',
    background_color VARCHAR(7) DEFAULT '#ffffff',
    text_color      VARCHAR(7) DEFAULT '#202124',
    -- Typography
    font_family     VARCHAR(100) DEFAULT 'Inter, system-ui, sans-serif',
    heading_font    VARCHAR(100),
    -- Layout
    layout_type     VARCHAR(20) DEFAULT 'default',  -- default, compact, sidebar
    header_style    VARCHAR(20) DEFAULT 'standard', -- standard, minimal, transparent
    -- Custom CSS
    custom_css      TEXT,
    -- Metadata
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id)
);

-- ── Tenant Custom Domains ───────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_domains (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    domain          VARCHAR(255) NOT NULL UNIQUE,
    is_verified     BOOLEAN DEFAULT false,
    verification_token VARCHAR(255),
    ssl_status      VARCHAR(20) DEFAULT 'pending',  -- pending, active, expired, error
    ssl_expires_at  TIMESTAMP WITH TIME ZONE,
    cname_target    VARCHAR(255) DEFAULT 'cname.a1tv.com',
    status          VARCHAR(20) DEFAULT 'pending',  -- pending, active, suspended
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_domains_domain ON tenant_domains(domain);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant ON tenant_domains(tenant_id);

-- ── Tenant Channel Collections ──────────────────────────────
-- Each tenant can curate their own set of channels
CREATE TABLE IF NOT EXISTS tenant_channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL,
    channel_id      UUID NOT NULL REFERENCES channels(id),
    is_visible      BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    custom_name     VARCHAR(255),
    custom_logo_url TEXT,
    added_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_channels_tenant ON tenant_channels(tenant_id);

-- ── Tenant Analytics ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_analytics (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    date            DATE NOT NULL,
    -- Viewer metrics
    total_views     INTEGER DEFAULT 0,
    unique_viewers  INTEGER DEFAULT 0,
    avg_watch_duration INTEGER DEFAULT 0,           -- seconds
    total_watch_time BIGINT DEFAULT 0,              -- seconds
    -- Engagement
    peak_concurrent INTEGER DEFAULT 0,
    peak_time       TIMESTAMP WITH TIME ZONE,
    channel_switches INTEGER DEFAULT 0,
    -- Top content
    top_channels    JSONB DEFAULT '[]',             -- [{ channel_id, views, duration }]
    top_categories  JSONB DEFAULT '[]',
    -- Geographic
    top_countries   JSONB DEFAULT '[]',             -- [{ country, viewers }]
    -- Device breakdown
    devices         JSONB DEFAULT '{}',             -- { web: 45, ios: 30, android: 25 }
    -- Quality metrics
    avg_bitrate     INTEGER DEFAULT 0,
    buffering_events INTEGER DEFAULT 0,
    error_rate      DECIMAL(5,4) DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tenant_analytics_tenant ON tenant_analytics(tenant_id, date DESC);

-- ── Tenant Billing Settings ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_billing (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL UNIQUE,
    -- Billing plan
    plan_id         UUID REFERENCES plans(id),
    billing_cycle   VARCHAR(10) DEFAULT 'monthly',
    -- Payment
    payment_provider VARCHAR(50) DEFAULT 'stripe',
    provider_customer_id VARCHAR(255),
    -- Usage limits
    max_channels    INTEGER DEFAULT 100,
    max_viewers     INTEGER DEFAULT 1000,
    max_storage_gb  INTEGER DEFAULT 10,
    max_api_calls   INTEGER DEFAULT 100000,
    -- Overage
    overage_rate_per_viewer DECIMAL(10,4) DEFAULT 0.001,  -- $0.001 per viewer over limit
    overage_rate_per_channel DECIMAL(10,2) DEFAULT 1.00,   -- $1 per channel over limit
    -- Status
    status          VARCHAR(20) DEFAULT 'active',
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end   TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Tenant Usage Tracking ───────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_usage (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    metric          VARCHAR(50) NOT NULL,           -- viewers, channels, storage, api_calls
    value           INTEGER NOT NULL,
    recorded_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_analytics(tenant_id, date DESC);
