-- ============================================================
-- A1TV Version 2 — Production PostgreSQL Schema
-- Database: a1tv
-- Supports: multi-source sync, health monitoring, scoring,
--           auth, favorites, analytics, EPG, asset management
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SOURCES (Track where data comes from)
-- ============================================================
CREATE TABLE sources (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,     -- 'iptv-org', 'free-tv', 'manual'
    type        VARCHAR(50) NOT NULL,              -- 'api', 'github', 'manual', 'verified'
    url         TEXT,
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    last_sync   TIMESTAMP WITH TIME ZONE,
    sync_count  INTEGER DEFAULT 0,
    fail_count  INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO sources (name, type, url, description) VALUES
    ('iptv-org', 'api', 'https://iptv-org.github.io/api', 'IPTV-Org public API'),
    ('free-tv', 'github', 'https://github.com/Free-TV/IPTV', 'Free-TV/IPTV GitHub repository'),
    ('manual', 'manual', NULL, 'Manually added verified channels');

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL UNIQUE,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon        VARCHAR(10),
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT true,
    channel_count INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- COUNTRIES
-- ============================================================
CREATE TABLE countries (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code        VARCHAR(2) NOT NULL UNIQUE,
    code3       VARCHAR(3),
    name        VARCHAR(100) NOT NULL,
    native_name VARCHAR(100),
    flag        VARCHAR(10),
    language    VARCHAR(10),
    region      VARCHAR(50),
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- CHANNELS
-- ============================================================
CREATE TABLE channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id       UUID REFERENCES sources(id),
    external_id     VARCHAR(255),                  -- ID from source (e.g., iptv-org channel ID)
    name            VARCHAR(255) NOT NULL,
    alt_names       TEXT[],
    slug            VARCHAR(255) NOT NULL UNIQUE,
    logo_url        TEXT,                          -- Original URL
    logo_local_path TEXT,                          -- Locally cached path
    country_id      UUID REFERENCES countries(id),
    category_id     UUID REFERENCES categories(id),
    language        VARCHAR(10),
    is_nsfw         BOOLEAN DEFAULT false,
    is_featured     BOOLEAN DEFAULT false,
    is_verified     BOOLEAN DEFAULT false,         -- Manually verified
    is_active       BOOLEAN DEFAULT true,
    website         TEXT,
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    -- Counters
    view_count      BIGINT DEFAULT 0,
    favorite_count  INTEGER DEFAULT 0,
    play_count      BIGINT DEFAULT 0,
    -- Timestamps
    last_synced_at  TIMESTAMP WITH TIME ZONE,
    last_played_at  TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Constraints
    CONSTRAINT uq_channel_source_ext UNIQUE (source_id, external_id)
);

CREATE INDEX idx_channels_source ON channels(source_id);
CREATE INDEX idx_channels_category ON channels(category_id);
CREATE INDEX idx_channels_country ON channels(country_id);
CREATE INDEX idx_channels_featured ON channels(is_featured) WHERE is_featured = true;
CREATE INDEX idx_channels_active ON channels(is_active) WHERE is_active = true;
CREATE INDEX idx_channels_verified ON channels(is_verified) WHERE is_verified = true;
CREATE INDEX idx_channels_name_trgm ON channels USING gin(name gin_trgm_ops);
CREATE INDEX idx_channels_view_count ON channels(view_count DESC);
CREATE INDEX idx_channels_play_count ON channels(play_count DESC);
CREATE INDEX idx_channels_created ON channels(created_at DESC);

-- ============================================================
-- STREAMS (Multiple streams per channel with health data)
-- ============================================================
CREATE TYPE stream_status AS ENUM ('online', 'offline', 'geo_blocked', 'slow', 'invalid', 'unknown');
CREATE TYPE stream_priority AS ENUM ('high', 'standard', 'low');

CREATE TABLE streams (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    source_id           UUID REFERENCES sources(id),
    url                 TEXT NOT NULL,
    quality             VARCHAR(20),
    label               VARCHAR(100),
    is_primary          BOOLEAN DEFAULT false,
    -- Health
    status              stream_status DEFAULT 'unknown',
    last_checked        TIMESTAMP WITH TIME ZONE,
    response_time       INTEGER,                   -- ms
    failures            INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    consecutive_successes INTEGER DEFAULT 0,
    -- Validation details
    http_status         INTEGER,
    content_type        VARCHAR(100),
    is_redirect         BOOLEAN DEFAULT false,
    redirect_url        TEXT,
    manifest_valid      BOOLEAN,
    segments_found      BOOLEAN,
    geo_blocked         BOOLEAN DEFAULT false,
    -- Scoring
    score               INTEGER DEFAULT 0,         -- 0-100
    uptime_pct          DECIMAL(5,2) DEFAULT 0,
    avg_latency         INTEGER DEFAULT 0,
    success_rate        DECIMAL(5,2) DEFAULT 0,
    stability_score     INTEGER DEFAULT 0,         -- Based on variance
    resolution_score    INTEGER DEFAULT 0,
    last_scored_at      TIMESTAMP WITH TIME ZONE,
    -- Scheduling
    priority            stream_priority DEFAULT 'standard',
    check_interval      INTEGER DEFAULT 1800,      -- seconds
    -- Metadata
    user_agent          TEXT,
    referrer            TEXT,
    metadata            JSONB DEFAULT '{}',
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Constraints
    CONSTRAINT uq_stream_channel_url UNIQUE (channel_id, url)
);

CREATE INDEX idx_streams_channel ON streams(channel_id);
CREATE INDEX idx_streams_status ON streams(status);
CREATE INDEX idx_streams_score ON streams(score DESC);
CREATE INDEX idx_streams_priority ON streams(priority);
CREATE INDEX idx_streams_active ON streams(is_active) WHERE is_active = true;
CREATE INDEX idx_streams_primary ON streams(channel_id) WHERE is_primary = true;
CREATE INDEX idx_streams_last_checked ON streams(last_checked);

-- ============================================================
-- EPG
-- ============================================================
CREATE TABLE epg_sources (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(255) NOT NULL,
    url         TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT true,
    last_fetch  TIMESTAMP WITH TIME ZONE,
    channel_count INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE programs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    epg_source_id   UUID REFERENCES epg_sources(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    category        VARCHAR(100),
    start_time      TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time        TIMESTAMP WITH TIME ZONE NOT NULL,
    duration        INTEGER,
    rating          VARCHAR(20),
    thumbnail       TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_programs_channel ON programs(channel_id);
CREATE INDEX idx_programs_time ON programs(start_time, end_time);
CREATE INDEX idx_programs_current ON programs(channel_id, start_time, end_time)
    WHERE start_time <= NOW() AND end_time > NOW();

-- ============================================================
-- USERS & AUTHENTICATION
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE,
    username        VARCHAR(100) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255),
    avatar_url      TEXT,
    role            VARCHAR(20) DEFAULT 'user',   -- user, admin, moderator
    is_active       BOOLEAN DEFAULT true,
    is_verified     BOOLEAN DEFAULT false,
    email_verified_at TIMESTAMP WITH TIME ZONE,
    last_login      TIMESTAMP WITH TIME ZONE,
    login_count     INTEGER DEFAULT 0,
    preferences     JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);

-- Refresh tokens for JWT
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(500) NOT NULL UNIQUE,
    device_info     TEXT,
    ip_address      INET,
    expires_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked      BOOLEAN DEFAULT false,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- Device tracking (for anonymous users)
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id       VARCHAR(255) NOT NULL UNIQUE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    user_agent      TEXT,
    ip_address      INET,
    last_active     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_devices_device ON devices(device_id);

-- ============================================================
-- FAVORITES
-- ============================================================
CREATE TABLE favorites (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id   UUID REFERENCES devices(id) ON DELETE CASCADE,
    channel_id  NOT NULL UUID REFERENCES channels(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_fav_owner CHECK (user_id IS NOT NULL OR device_id IS NOT NULL),
    CONSTRAINT uq_fav_user_channel UNIQUE (user_id, channel_id),
    CONSTRAINT uq_fav_device_channel UNIQUE (device_id, channel_id)
);

CREATE INDEX idx_fav_user ON favorites(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_fav_device ON favorites(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_fav_channel ON favorites(channel_id);

-- ============================================================
-- WATCH HISTORY
-- ============================================================
CREATE TABLE watch_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    device_id       UUID REFERENCES devices(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    stream_id       UUID REFERENCES streams(id),
    started_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at        TIMESTAMP WITH TIME ZONE,
    duration        INTEGER DEFAULT 0,
    quality         VARCHAR(20),
    had_errors      BOOLEAN DEFAULT false,
    error_count     INTEGER DEFAULT 0,
    metadata        JSONB DEFAULT '{}',
    CONSTRAINT fk_history_owner CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX idx_history_user ON watch_history(user_id, started_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_history_device ON watch_history(device_id, started_at DESC) WHERE device_id IS NOT NULL;
CREATE INDEX idx_history_channel ON watch_history(channel_id, started_at DESC);

-- ============================================================
-- ANALYTICS
-- ============================================================
CREATE TABLE channel_views (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    session_id      VARCHAR(255),
    ip_address      INET,
    user_agent      TEXT,
    viewed_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cv_channel ON channel_views(channel_id, viewed_at DESC);
CREATE INDEX idx_cv_date ON channel_views(viewed_at);
CREATE INDEX idx_cv_user ON channel_views(user_id) WHERE user_id IS NOT NULL;

-- Partition by month for performance
CREATE TABLE play_events (
    id              UUID,
    channel_id      UUID NOT NULL,
    stream_id       UUID,
    user_id         UUID,
    device_id       UUID,
    event_type      VARCHAR(50) NOT NULL,
    event_data      JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for current and next 3 months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..3 LOOP
        start_date := DATE_TRUNC('month', NOW() + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'play_events_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF play_events FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date);
    END LOOP;
END $$;

CREATE INDEX idx_pe_channel ON play_events(channel_id, created_at DESC);
CREATE INDEX idx_pe_type ON play_events(event_type, created_at DESC);

CREATE TABLE stream_errors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id       UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    error_type      VARCHAR(100) NOT NULL,
    error_message   TEXT,
    http_status     INTEGER,
    response_time   INTEGER,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_se_stream ON stream_errors(stream_id, created_at DESC);
CREATE INDEX idx_se_channel ON stream_errors(channel_id, created_at DESC);
CREATE INDEX idx_se_type ON stream_errors(error_type, created_at DESC);

CREATE TABLE search_queries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query           VARCHAR(500) NOT NULL,
    results_count   INTEGER DEFAULT 0,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sq_date ON search_queries(created_at DESC);
CREATE INDEX idx_sq_query ON search_queries(query);

-- Concurrent viewers tracking
CREATE TABLE concurrent_viewers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    session_id      VARCHAR(255) NOT NULL,
    started_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_heartbeat  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cv_session ON concurrent_viewers(session_id);
CREATE INDEX idx_cv_channel ON concurrent_viewers(channel_id);
CREATE INDEX idx_cv_heartbeat ON concurrent_viewers(last_heartbeat);

-- ============================================================
-- HEALTH CHECK LOG (partitioned)
-- ============================================================
CREATE TABLE health_check_log (
    id              UUID,
    stream_id       UUID NOT NULL,
    status          VARCHAR(20) NOT NULL,
    response_time   INTEGER,
    http_status     INTEGER,
    error_message   TEXT,
    checked_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..3 LOOP
        start_date := DATE_TRUNC('month', NOW() + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'health_check_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF health_check_log FOR VALUES FROM (%L) to (%L)',
            partition_name, start_date, end_date);
    END LOOP;
END $$;

CREATE INDEX idx_hcl_stream ON health_check_log(stream_id, checked_at DESC);

-- ============================================================
-- API RATE LIMITING
-- ============================================================
CREATE TABLE rate_limits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key             VARCHAR(255) NOT NULL,         -- IP or user ID
    endpoint        VARCHAR(255) NOT NULL,
    request_count   INTEGER DEFAULT 1,
    window_start    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_rate_limit UNIQUE (key, endpoint, window_start)
);

CREATE INDEX idx_rate_limits_key ON rate_limits(key, endpoint, window_start);

-- ============================================================
-- ASSET MANAGEMENT
-- ============================================================
CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID REFERENCES channels(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,          -- 'logo', 'thumbnail', 'banner'
    original_url    TEXT,
    local_path      TEXT,
    file_size       INTEGER,
    width           INTEGER,
    height          INTEGER,
    mime_type       VARCHAR(100),
    is_optimized    BOOLEAN DEFAULT false,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_assets_channel ON assets(channel_id);
CREATE INDEX idx_assets_type ON assets(type);

-- ============================================================
-- VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_channels_enriched AS
SELECT
    c.*,
    cat.name AS category_name,
    cat.slug AS category_slug,
    cat.icon AS category_icon,
    co.name AS country_name,
    co.code AS country_code,
    co.flag AS country_flag,
    s.name AS source_name,
    (
        SELECT json_build_object(
            'id', st.id, 'url', st.url, 'quality', st.quality,
            'status', st.status::text, 'score', st.score,
            'response_time', st.response_time, 'uptime_pct', st.uptime_pct
        )
        FROM streams st
        WHERE st.channel_id = c.id AND st.is_active = true
        ORDER BY st.score DESC, st.is_primary DESC
        LIMIT 1
    ) AS best_stream,
    (
        SELECT json_build_object(
            'title', p.title, 'description', p.description,
            'start_time', p.start_time, 'end_time', p.end_time
        )
        FROM programs p
        WHERE p.channel_id = c.id AND p.start_time <= NOW() AND p.end_time > NOW()
        ORDER BY p.start_time DESC LIMIT 1
    ) AS current_program,
    (
        SELECT json_build_object(
            'title', p.title, 'start_time', p.start_time, 'end_time', p.end_time
        )
        FROM programs p
        WHERE p.channel_id = c.id AND p.start_time > NOW()
        ORDER BY p.start_time ASC LIMIT 1
    ) AS next_program,
    (
        SELECT COUNT(*) FROM streams st
        WHERE st.channel_id = c.id AND st.status = 'online' AND st.is_active = true
    ) AS online_streams,
    (
        SELECT COUNT(*) FROM streams st
        WHERE st.channel_id = c.id AND st.is_active = true
    ) AS total_streams,
    (
        SELECT COUNT(*) FROM concurrent_viewers cv
        WHERE cv.channel_id = c.id AND cv.last_heartbeat > NOW() - INTERVAL '2 minutes'
    ) AS concurrent_viewers
FROM channels c
LEFT JOIN categories cat ON c.category_id = cat.id
LEFT JOIN countries co ON c.country_id = co.id
LEFT JOIN sources s ON c.source_id = s.id
WHERE c.is_active = true;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_channels_updated_at BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_streams_updated_at BEFORE UPDATE ON streams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_programs_updated_at BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_assets_updated_at BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Favorite count sync
CREATE OR REPLACE FUNCTION update_channel_favorite_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE channels SET favorite_count = favorite_count + 1 WHERE id = NEW.channel_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE channels SET favorite_count = GREATEST(0, favorite_count - 1) WHERE id = OLD.channel_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_favorite_count
    AFTER INSERT OR DELETE ON favorites
    FOR EACH ROW EXECUTE FUNCTION update_channel_favorite_count();

-- Category channel count sync
CREATE OR REPLACE FUNCTION update_category_channel_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.category_id IS DISTINCT FROM NEW.category_id) THEN
        UPDATE categories SET channel_count = (
            SELECT COUNT(*) FROM channels WHERE category_id = NEW.category_id AND is_active = true
        ) WHERE id = NEW.category_id;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.category_id IS DISTINCT FROM NEW.category_id THEN
        UPDATE categories SET channel_count = (
            SELECT COUNT(*) FROM channels WHERE category_id = OLD.category_id AND is_active = true
        ) WHERE id = OLD.category_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_category_count
    AFTER INSERT OR UPDATE OF category_id ON channels
    FOR EACH ROW EXECUTE FUNCTION update_category_channel_count();

-- Cleanup expired refresh tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW() OR is_revoked = true;
    DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
    DELETE FROM concurrent_viewers WHERE last_heartbeat < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO categories (name, slug, description, icon, sort_order) VALUES
    ('Sports', 'sports', 'Live sports channels', '⚽', 1),
    ('News', 'news', 'Breaking news and current affairs', '📰', 2),
    ('Entertainment', 'entertainment', 'General entertainment', '🎭', 3),
    ('Movies', 'movies', 'Movie channels', '🎬', 4),
    ('Music', 'music', 'Music and radio', '🎵', 5),
    ('Documentary', 'documentary', 'Documentary channels', '🎥', 6),
    ('Business', 'business', 'Business and finance', '💼', 7),
    ('Lifestyle', 'lifestyle', 'Health, fitness, and lifestyle', '🌿', 8),
    ('Family', 'family', 'Family-friendly content', '👨‍👩‍👧‍👦', 9),
    ('Kids', 'kids', 'Children''s programming', '🧸', 10),
    ('General', 'general', 'General programming', '📺', 11),
    ('Animation', 'animation', 'Animated content', '🎨', 12),
    ('Science', 'science', 'Science and technology', '🔬', 13),
    ('Education', 'education', 'Educational content', '📚', 14);

INSERT INTO countries (code, code3, name, flag, language, region) VALUES
    ('US', 'USA', 'United States', '🇺🇸', 'en', 'Americas'),
    ('GB', 'GBR', 'United Kingdom', '🇬🇧', 'en', 'Europe'),
    ('CA', 'CAN', 'Canada', '🇨🇦', 'en', 'Americas'),
    ('AU', 'AUS', 'Australia', '🇦🇺', 'en', 'Oceania'),
    ('DE', 'DEU', 'Germany', '🇩🇪', 'de', 'Europe'),
    ('FR', 'FRA', 'France', '🇫🇷', 'fr', 'Europe'),
    ('ES', 'ESP', 'Spain', '🇪🇸', 'es', 'Europe'),
    ('IT', 'ITA', 'Italy', '🇮🇹', 'it', 'Europe'),
    ('NL', 'NLD', 'Netherlands', '🇳🇱', 'nl', 'Europe'),
    ('SE', 'SWE', 'Sweden', '🇸🇪', 'sv', 'Europe'),
    ('JP', 'JPN', 'Japan', '🇯🇵', 'ja', 'Asia'),
    ('KR', 'KOR', 'South Korea', '🇰🇷', 'ko', 'Asia'),
    ('IN', 'IND', 'India', '🇮🇳', 'hi', 'Asia'),
    ('BR', 'BRA', 'Brazil', '🇧🇷', 'pt', 'Americas'),
    ('MX', 'MEX', 'Mexico', '🇲🇽', 'es', 'Americas'),
    ('ZA', 'ZAF', 'South Africa', '🇿🇦', 'en', 'Africa'),
    ('AE', 'ARE', 'United Arab Emirates', '🇦🇪', 'ar', 'Middle East'),
    ('TR', 'TUR', 'Turkey', '🇹🇷', 'tr', 'Europe'),
    ('RU', 'RUS', 'Russia', '🇷🇺', 'ru', 'Europe'),
    ('CN', 'CHN', 'China', '🇨🇳', 'zh', 'Asia');

-- Verified public broadcaster channels (seed)
INSERT INTO channels (source_id, external_id, name, slug, logo_url, country_id, category_id, is_verified, is_featured, is_active, description)
SELECT
    s.id, 'nasa-tv', 'NASA TV', 'nasa-tv',
    'https://www.nasa.gov/wp-content/uploads/2023/09/nasa-logo.svg',
    co.id, cat.id, true, true, true,
    'NASA Television is the television service of the NASA'
FROM sources s, countries co, categories cat
WHERE s.name = 'manual' AND co.code = 'US' AND cat.slug = 'science';

INSERT INTO channels (source_id, external_id, name, slug, logo_url, country_id, category_id, is_verified, is_featured, is_active, description)
SELECT
    s.id, 'dw', 'DW', 'dw',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Deutsche_Welle_logo.svg/200px-Deutsche_Welle_logo.svg.png',
    co.id, cat.id, true, true, true,
    'Deutsche Welle - Germany''s international broadcaster'
FROM sources s, countries co, categories cat
WHERE s.name = 'manual' AND co.code = 'DE' AND cat.slug = 'news';

INSERT INTO channels (source_id, external_id, name, slug, logo_url, country_id, category_id, is_verified, is_featured, is_active, description)
SELECT
    s.id, 'france24', 'France 24', 'france-24',
    'https://www.france24.com/bundles/france24front/img/logo-france24.png',
    co.id, cat.id, true, true, true,
    'France 24 - International news channel'
FROM sources s, countries co, categories cat
WHERE s.name = 'manual' AND co.code = 'FR' AND cat.slug = 'news';

INSERT INTO channels (source_id, external_id, name, slug, logo_url, country_id, category_id, is_verified, is_featured, is_active, description)
SELECT
    s.id, 'nhk-world', 'NHK World', 'nhk-world',
    'https://www.nhk.or.jp/nhkworld/assets/images/common/logo.png',
    co.id, cat.id, true, true, true,
    'NHK World - Japan''s international broadcaster'
FROM sources s, countries co, categories cat
WHERE s.name = 'manual' AND co.code = 'JP' AND cat.slug = 'news';

-- Add sample streams for verified channels
INSERT INTO streams (channel_id, source_id, url, quality, is_primary, status, priority, score)
SELECT c.id, s.id, 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8', '1080p', true, 'unknown'::stream_status, 'high'::stream_priority, 0
FROM channels c, sources s
WHERE c.external_id = 'nasa-tv' AND s.name = 'manual';

INSERT INTO streams (channel_id, source_id, url, quality, is_primary, status, priority, score)
SELECT c.id, s.id, 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8', '720p', true, 'unknown'::stream_status, 'high'::stream_priority, 0
FROM channels c, sources s
WHERE c.external_id = 'dw' AND s.name = 'manual';

INSERT INTO streams (channel_id, source_id, url, quality, is_primary, status, priority, score)
SELECT c.id, s.id, 'https://www.france24.com/en/live', '720p', true, 'unknown'::stream_status, 'high'::stream_priority, 0
FROM channels c, sources s
WHERE c.external_id = 'france24' AND s.name = 'manual';

INSERT INTO streams (channel_id, source_id, url, quality, is_primary, status, priority, score)
SELECT c.id, s.id, 'https://nhkwlive-ojp.akamaized.net/hls/live/2003459/nhkwlive-ojp-en/index.m3u8', '720p', true, 'unknown'::stream_status, 'high'::stream_priority, 0
FROM channels c, sources s
WHERE c.external_id = 'nhk-world' AND s.name = 'manual';
