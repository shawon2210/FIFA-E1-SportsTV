-- ============================================================
-- A1TV v2 — Operational Improvements: Database Schema Additions
-- Circuit Breakers, Rate Limiting, Historical Metrics, Proxies,
-- Recommendations, Logo Optimization, EPG Scoring, Geo, Alerts, Backups
-- ============================================================

-- ============================================================
-- 1. STREAM HOSTS (Circuit Breakers)
-- ============================================================
CREATE TABLE stream_hosts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host            VARCHAR(255) NOT NULL UNIQUE,     -- e.g., 'cdn1.example.com'
    domain          VARCHAR(255) NOT NULL,             -- e.g., 'example.com'
    status          VARCHAR(20) DEFAULT 'healthy',    -- healthy, degraded, down, banned
    total_streams   INTEGER DEFAULT 0,
    online_streams  INTEGER DEFAULT 0,
    failure_rate    DECIMAL(5,2) DEFAULT 0,           -- Percentage of failed checks
    avg_latency     INTEGER DEFAULT 0,                 -- ms
    consecutive_failures INTEGER DEFAULT 0,
    last_checked    TIMESTAMP WITH TIME ZONE,
    first_failure   TIMESTAMP WITH TIME ZONE,         -- When degradation started
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_stream_hosts_status ON stream_hosts(status);
CREATE INDEX idx_stream_hosts_domain ON stream_hosts(domain);
CREATE INDEX idx_stream_hosts_failure_rate ON stream_hosts(failure_rate DESC);

-- Add host reference to streams table
ALTER TABLE streams ADD COLUMN host_id UUID REFERENCES stream_hosts(id);
CREATE INDEX idx_streams_host ON streams(host_id);

-- ============================================================
-- 2. RATE LIMITING (Distributed, per-endpoint)
-- ============================================================
CREATE TABLE rate_limit_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL UNIQUE,     -- 'standard', 'search', 'stream', 'auth'
    endpoint_pattern VARCHAR(255) NOT NULL,            -- '/api/v1/channels', '/api/v1/search', etc.
    window_seconds  INTEGER NOT NULL DEFAULT 60,
    max_requests    INTEGER NOT NULL DEFAULT 100,
    scope           VARCHAR(20) DEFAULT 'ip',          -- ip, user, device, global
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO rate_limit_rules (name, endpoint_pattern, window_seconds, max_requests, scope) VALUES
    ('standard', '/api/v1/*', 60, 100, 'ip'),
    ('search', '/api/v1/search*', 60, 20, 'ip'),
    ('stream', '/api/v1/channels/*/stream', 60, 10, 'ip'),
    ('auth', '/api/v1/auth/*', 900, 10, 'ip'),
    ('analytics', '/api/v1/analytics/*', 60, 200, 'ip'),
    ('admin', '/api/v1/admin/*', 60, 30, 'user'),
    ('global', '/api/v1/*', 1, 10, 'global');

-- ============================================================
-- 3. HISTORICAL STREAM METRICS (Hourly Aggregation)
-- ============================================================
CREATE TABLE stream_metrics_hourly (
    id              UUID,
    stream_id       UUID NOT NULL,
    channel_id      UUID NOT NULL,
    host_id         UUID,
    hour            TIMESTAMP WITH TIME ZONE NOT NULL,
    -- Aggregates
    checks_total    INTEGER DEFAULT 0,
    checks_online   INTEGER DEFAULT 0,
    checks_offline  INTEGER DEFAULT 0,
    uptime_pct      DECIMAL(5,2) DEFAULT 0,
    avg_latency     INTEGER DEFAULT 0,
    min_latency     INTEGER DEFAULT 0,
    max_latency     INTEGER DEFAULT 0,
    latency_stddev  INTEGER DEFAULT 0,
    score_avg       INTEGER DEFAULT 0,
    score_min       INTEGER DEFAULT 0,
    score_max       INTEGER DEFAULT 0,
    error_count     INTEGER DEFAULT 0,
    geo_block_count INTEGER DEFAULT 0,
    -- Metadata
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, hour)
) PARTITION BY RANGE (hour);

-- Create partitions for current and next 6 months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..6 LOOP
        start_date := DATE_TRUNC('month', NOW() + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'stream_metrics_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF stream_metrics_hourly FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date);
    END LOOP;
END $$;

CREATE INDEX idx_sm_stream ON stream_metrics_hourly(stream_id, hour DESC);
CREATE INDEX idx_sm_channel ON stream_metrics_hourly(channel_id, hour DESC);
CREATE INDEX idx_sm_host ON stream_metrics_hourly(host_id, hour DESC);
CREATE INDEX idx_sm_hour ON stream_metrics_hourly(hour DESC);

-- ============================================================
-- 4. STREAM PROXY REGISTRY
-- ============================================================
CREATE TABLE stream_proxies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id       UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    proxy_url       TEXT NOT NULL,
    proxy_type      VARCHAR(20) DEFAULT 'reverse',     -- reverse, forward, tunnel
    is_active       BOOLEAN DEFAULT true,
    use_count       INTEGER DEFAULT 0,
    success_count   INTEGER DEFAULT 0,
    fail_count      INTEGER DEFAULT 0,
    avg_latency     INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_stream_proxies_stream ON stream_proxies(stream_id);

-- Track which streams need proxying
ALTER TABLE streams ADD COLUMN needs_proxy BOOLEAN DEFAULT false;
ALTER TABLE streams ADD COLUMN proxy_reason VARCHAR(100); -- 'cors', 'referer', 'user-agent', 'geo';

-- ============================================================
-- 5. CHANNEL RECOMMENDATIONS
-- ============================================================
CREATE TABLE channel_recommendations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    recommended_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    score           INTEGER DEFAULT 0,                -- 0-100 relevance score
    reason          VARCHAR(50),                      -- 'similar_viewers', 'same_category', 'same_country', 'co_watch', 'trending'
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (source_channel_id, recommended_channel_id, reason)
);

CREATE INDEX idx_recommendations_source ON channel_recommendations(source_channel_id, score DESC);
CREATE INDEX idx_recommendations_target ON channel_recommendations(recommended_channel_id);

-- Co-watch tracking (channels watched together)
CREATE TABLE co_watch_stats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_a_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    channel_b_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    watch_count     INTEGER DEFAULT 0,
    last_updated    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_a_id, channel_b_id)
);

CREATE INDEX idx_co_watch_a ON co_watch_stats(channel_a_id, watch_count DESC);
CREATE INDEX idx_co_watch_b ON co_watch_stats(channel_b_id, watch_count DESC);

-- ============================================================
-- 6. LOGO OPTIMIZATION TRACKING
-- ============================================================
ALTER TABLE assets ADD COLUMN width INTEGER;
ALTER TABLE assets ADD COLUMN height INTEGER;
ALTER TABLE assets ADD COLUMN file_size INTEGER;
ALTER TABLE assets ADD COLUMN mime_type VARCHAR(100);
ALTER TABLE assets ADD COLUMN is_optimized BOOLEAN DEFAULT false;

-- Logo variants table (different sizes)
CREATE TABLE logo_variants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    variant         VARCHAR(20) NOT NULL,             -- '64px', '128px', '256px', 'original'
    local_path      TEXT,
    cdn_url         TEXT,
    width           INTEGER,
    height          INTEGER,
    file_size       INTEGER,
    format          VARCHAR(10) DEFAULT 'webp',       -- webp, png, jpeg
    is_available    BOOLEAN DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_logo_variants_channel ON logo_variants(channel_id);
CREATE INDEX idx_logo_variants_variant ON logo_variants(variant);

-- ============================================================
-- 7. EPG QUALITY SCORING
-- ============================================================
ALTER TABLE epg_sources ADD COLUMN quality_score INTEGER DEFAULT 0;
ALTER TABLE epg_sources ADD COLUMN coverage_pct DECIMAL(5,2) DEFAULT 0;
ALTER TABLE epg_sources ADD COLUMN accuracy_pct DECIMAL(5,2) DEFAULT 0;
ALTER TABLE epg_sources ADD COLUMN update_frequency_minutes INTEGER DEFAULT 0;
ALTER TABLE epg_sources ADD COLUMN last_quality_check TIMESTAMP WITH TIME ZONE;

-- Per-channel EPG quality
CREATE TABLE epg_channel_quality (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    epg_source_id   UUID NOT NULL REFERENCES epg_sources(id) ON DELETE CASCADE,
    coverage_pct    DECIMAL(5,2) DEFAULT 0,
    accuracy_pct    DECIMAL(5,2) DEFAULT 0,
    program_count   INTEGER DEFAULT 0,
    last_check      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_id, epg_source_id)
);

CREATE INDEX idx_epg_cq_channel ON epg_channel_quality(channel_id);

-- ============================================================
-- 8. GEOGRAPHIC AWARENESS
-- ============================================================
-- Regions table
CREATE TABLE regions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO regions (name, slug, description) VALUES
    ('Americas', 'americas', 'North, Central, and South America'),
    ('Europe', 'europe', 'European countries'),
    ('Asia', 'asia', 'Asian countries'),
    ('Africa', 'africa', 'African countries'),
    ('Middle East', 'middle-east', 'Middle Eastern countries'),
    ('Oceania', 'oceania', 'Oceania and Pacific islands');

-- Add region to countries
ALTER TABLE countries ADD COLUMN region_id UUID REFERENCES regions(id);
CREATE INDEX idx_countries_region ON countries(region_id);

-- Update existing countries with regions
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'americas') WHERE code IN ('US', 'CA', 'BR', 'MX', 'AR', 'CL', 'CO', 'PE');
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'europe') WHERE code IN ('GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'AT', 'CH', 'BE', 'PT', 'IE', 'UA', 'RU', 'RO', 'HU');
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'asia') WHERE code IN ('JP', 'KR', 'IN', 'CN', 'HK', 'TW', 'PH', 'TH', 'VN', 'ID', 'MY', 'SG', 'PK', 'BD');
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'africa') WHERE code IN ('ZA', 'NG', 'KE', 'GH', 'EG');
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'middle-east') WHERE code IN ('AE', 'SA', 'TR', 'IL');
UPDATE countries SET region_id = (SELECT id FROM regions WHERE slug = 'oceania') WHERE code IN ('AU', 'NZ');

-- Channel geo-blocking metadata
CREATE TABLE channel_geo_restrictions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    country_code    VARCHAR(2) NOT NULL,
    restriction     VARCHAR(20) NOT NULL,             -- 'blocked', 'allowed'
    confidence      VARCHAR(20) DEFAULT 'medium',     -- low, medium, high
    detected_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_id, country_code)
);

CREATE INDEX idx_geo_restrictions_channel ON channel_geo_restrictions(channel_id);

-- ============================================================
-- 9. MONITORING ALERTS
-- ============================================================
CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(50) NOT NULL,             -- 'streams', 'system', 'sync', 'api', 'database'
    condition_type  VARCHAR(50) NOT NULL,             -- 'threshold', 'rate', 'absence'
    condition_config JSONB NOT NULL,                  -- { "metric": "offline_pct", "operator": ">", "value": 20 }
    severity        VARCHAR(20) DEFAULT 'warning',    -- info, warning, critical
    is_active       BOOLEAN DEFAULT true,
    cooldown_minutes INTEGER DEFAULT 60,
    last_triggered  TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO alert_rules (name, category, condition_type, condition_config, severity) VALUES
    ('High Offline Rate', 'streams', 'threshold', '{"metric": "offline_stream_pct", "operator": ">", "value": 20}', 'warning'),
    ('Critical Offline Rate', 'streams', 'threshold', '{"metric": "offline_stream_pct", "operator": ">", "value": 50}', 'critical'),
    ('High API Latency', 'api', 'threshold', '{"metric": "api_p95_latency_ms", "operator": ">", "value": 2000}', 'warning'),
    ('Redis Unavailable', 'system', 'absence', '{"metric": "redis_ping", "operator": "==", "value": 0}', 'critical'),
    ('Sync Job Failed', 'sync', 'absence', '{"metric": "last_sync", "operator": ">", "value": "12 hours"}', 'warning'),
    ('Database Disk High', 'database', 'threshold', '{"metric": "disk_usage_pct", "operator": ">", "value": 80}', 'critical'),
    ('Low Cache Hit Ratio', 'system', 'threshold', '{"metric": "cache_hit_ratio", "operator": "<", "value": 50}', 'info');

-- Alert channels (where to send notifications)
CREATE TABLE alert_channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    type            VARCHAR(20) NOT NULL,             -- 'telegram', 'discord', 'email', 'webhook', 'slack'
    config          JSONB NOT NULL,                   -- { "bot_token": "...", "chat_id": "..." }
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Alert history
CREATE TABLE alert_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id         UUID REFERENCES alert_rules(id),
    severity        VARCHAR(20) NOT NULL,
    title           VARCHAR(500) NOT NULL,
    message         TEXT,
    data            JSONB DEFAULT '{}',
    acknowledged    BOOLEAN DEFAULT false,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved        BOOLEAN DEFAULT false,
    resolved_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_alert_history_created ON alert_history(created_at DESC);
CREATE INDEX idx_alert_history_unack ON alert_history(acknowledged) WHERE acknowledged = false;

-- ============================================================
-- 10. BACKUP TRACKING
-- ============================================================
CREATE TABLE backup_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            VARCHAR(50) NOT NULL,             -- 'postgres_full', 'postgres_wal', 'redis_snapshot', 'assets'
    status          VARCHAR(20) DEFAULT 'pending',    -- pending, running, completed, failed
    storage_backend VARCHAR(50) DEFAULT 's3',         -- s3, r2, gcs, local
    storage_path    TEXT,
    file_size       BIGINT,
    checksum        VARCHAR(64),
    started_at      TIMESTAMP WITH TIME ZONE,
    completed_at    TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    error_message   TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_backup_jobs_type ON backup_jobs(type, created_at DESC);
CREATE INDEX idx_backup_jobs_status ON backup_jobs(status);

-- ============================================================
-- 11. SESSION TRACKING (for WebSocket connections)
-- ============================================================
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    session_token   VARCHAR(500) NOT NULL UNIQUE,
    socket_id       VARCHAR(255),                     -- Socket.IO socket ID
    ip_address      INET,
    user_agent      TEXT,
    is_active       BOOLEAN DEFAULT true,
    last_activity   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sessions_socket ON user_sessions(socket_id) WHERE socket_id IS NOT NULL;
CREATE INDEX idx_sessions_active ON user_sessions(is_active) WHERE is_active = true;

-- ============================================================
-- VIEWS (Updated)
-- ============================================================

-- Channel list with geo/recommendation data
CREATE OR REPLACE VIEW v_channels_complete AS
SELECT
    c.*,
    cat.name AS category_name, cat.slug AS category_slug, cat.icon AS category_icon,
    co.name AS country_name, co.code AS country_code, co.flag AS country_flag,
    r.name AS region_name, r.slug AS region_slug,
    s.name AS source_name,
    sh.status AS host_status, sh.failure_rate AS host_failure_rate,
    cv.view_count AS recent_views,
    cv.play_count AS recent_plays,
    (SELECT json_build_object('id', st.id, 'url', st.url, 'quality', st.quality,
        'status', st.status::text, 'score', st.score)
     FROM streams st WHERE st.channel_id = c.id AND st.is_active = true
     ORDER BY st.score DESC LIMIT 1) AS best_stream,
    (SELECT json_build_object('title', p.title, 'start_time', p.start_time, 'end_time', p.end_time)
     FROM programs p WHERE p.channel_id = c.id AND p.start_time <= NOW() AND p.end_time > NOW()
     ORDER BY p.start_time DESC LIMIT 1) AS current_program,
    (
        SELECT json_agg(json_build_object('id', rec.recommended_channel_id, 'name', rc.name, 'score', rec.score) ORDER BY rec.score DESC)
        FROM channel_recommendations rec
        JOIN channels rc ON rec.recommended_channel_id = rc.id
        WHERE rec.source_channel_id = c.id AND rec.score > 50
        LIMIT 5
    ) AS recommendations
FROM channels c
LEFT JOIN categories cat ON c.category_id = cat.id
LEFT JOIN countries co ON c.country_id = co.id
LEFT JOIN regions r ON co.region_id = r.id
LEFT JOIN sources s ON c.source_id = s.id
LEFT JOIN LATERAL (
    SELECT sh2.status, sh2.failure_rate FROM streams st2
    JOIN stream_hosts sh2 ON st2.host_id = sh2.id
    WHERE st2.channel_id = c.id ORDER BY st2.score DESC LIMIT 1
) sh ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) as view_count FROM channel_views WHERE channel_id = c.id AND viewed_at > NOW() - INTERVAL '24 hours'
) cv ON true
WHERE c.is_active = true;
