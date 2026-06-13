-- ============================================================
-- Migration: 004_create_backup_and_recommendations
-- Backup tracking + recommendation engine tables
-- ============================================================

CREATE TABLE IF NOT EXISTS backup_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type            VARCHAR(50) NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',
    storage_backend VARCHAR(50) DEFAULT 's3',
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

CREATE INDEX IF NOT EXISTS idx_backup_jobs_type ON backup_jobs(type, created_at DESC);

-- Recommendations
CREATE TABLE IF NOT EXISTS channel_recommendations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    recommended_channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    score           INTEGER DEFAULT 0,
    reason          VARCHAR(50),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (source_channel_id, recommended_channel_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_recommendations_source ON channel_recommendations(source_channel_id, score DESC);

CREATE TABLE IF NOT EXISTS co_watch_stats (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_a_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    channel_b_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    watch_count     INTEGER DEFAULT 0,
    last_updated    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_a_id, channel_b_id)
);

CREATE INDEX IF NOT EXISTS idx_co_watch_a ON co_watch_stats(channel_a_id, watch_count DESC);

-- Stream proxies
CREATE TABLE IF NOT EXISTS stream_proxies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id       UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    proxy_url       TEXT NOT NULL,
    proxy_type      VARCHAR(20) DEFAULT 'reverse',
    is_active       BOOLEAN DEFAULT true,
    use_count       INTEGER DEFAULT 0,
    success_count   INTEGER DEFAULT 0,
    fail_count      INTEGER DEFAULT 0,
    avg_latency     INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_proxies_stream ON stream_proxies(stream_id);

-- EPG quality scoring
CREATE TABLE IF NOT EXISTS epg_channel_quality (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    epg_source_id   UUID NOT NULL REFERENCES epg_sources(id) ON DELETE CASCADE,
    coverage_pct    DECIMAL(5,2) DEFAULT 0,
    accuracy_pct    DECIMAL(5,2) DEFAULT 0,
    program_count   INTEGER DEFAULT 0,
    last_check      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_id, epg_source_id)
);

CREATE INDEX IF NOT EXISTS idx_epg_cq_channel ON epg_channel_quality(channel_id);

-- EPG sources table (if not exists from original schema)
CREATE TABLE IF NOT EXISTS epg_sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    url             TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT true,
    last_fetch      TIMESTAMP WITH TIME ZONE,
    channel_count   INTEGER DEFAULT 0,
    quality_score   INTEGER DEFAULT 0,
    coverage_pct    DECIMAL(5,2) DEFAULT 0,
    accuracy_pct    DECIMAL(5,2) DEFAULT 0,
    update_frequency_minutes INTEGER DEFAULT 0,
    last_quality_check TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Geo restrictions tracking
CREATE TABLE IF NOT EXISTS channel_geo_restrictions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    country_code    VARCHAR(2) NOT NULL,
    restriction     VARCHAR(20) NOT NULL,
    confidence      VARCHAR(20) DEFAULT 'medium',
    detected_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (channel_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_geo_restrictions_channel ON channel_geo_restrictions(channel_id);
