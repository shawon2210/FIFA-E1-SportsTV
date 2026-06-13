-- ============================================================
-- Migration: 002_create_metrics_tables
-- Historical stream metrics (hourly aggregation) + rate limiting
-- ============================================================

-- Hourly metrics (partitioned)
CREATE TABLE IF NOT EXISTS stream_metrics_hourly (
    id              UUID,
    stream_id       UUID NOT NULL,
    channel_id      UUID NOT NULL,
    host_id         UUID,
    hour            TIMESTAMP WITH TIME ZONE NOT NULL,
    checks_total    INTEGER DEFAULT 0,
    checks_online   INTEGER DEFAULT 0,
    checks_offline  INTEGER DEFAULT 0,
    uptime_pct      DECIMAL(5,2) DEFAULT 0,
    avg_latency     INTEGER DEFAULT 0,
    min_latency     INTEGER DEFAULT 0,
    max_latency     INTEGER DEFAULT 0,
    score_avg       INTEGER DEFAULT 0,
    score_min       INTEGER DEFAULT 0,
    score_max       INTEGER DEFAULT 0,
    error_count     INTEGER DEFAULT 0,
    geo_block_count INTEGER DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (id, hour)
) PARTITION BY RANGE (hour);

-- Create partitions for next 3 months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    FOR i IN 0..3 LOOP
        start_date := DATE_TRUNC('month', NOW() + (i || ' months')::INTERVAL);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'stream_metrics_' || TO_CHAR(start_date, 'YYYY_MM');
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF stream_metrics_hourly FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date);
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_sm_stream ON stream_metrics_hourly(stream_id, hour DESC);
CREATE INDEX IF NOT EXISTS idx_sm_channel ON stream_metrics_hourly(channel_id, hour DESC);
CREATE INDEX IF NOT EXISTS idx_sm_hour ON stream_metrics_hourly(hour DESC);

-- Rate limit rules
CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    endpoint_pattern VARCHAR(255) NOT NULL,
    window_seconds  INTEGER NOT NULL DEFAULT 60,
    max_requests    INTEGER NOT NULL DEFAULT 100,
    scope           VARCHAR(20) DEFAULT 'ip',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO rate_limit_rules (name, endpoint_pattern, window_seconds, max_requests, scope) VALUES
    ('standard', '/api/v1/*', 60, 100, 'ip'),
    ('search', '/api/v1/search*', 60, 20, 'ip'),
    ('stream', '/api/v1/channels/*/stream', 60, 10, 'ip'),
    ('auth', '/api/v1/auth/*', 900, 10, 'ip'),
    ('analytics', '/api/v1/analytics/*', 60, 200, 'ip')
ON CONFLICT (name) DO NOTHING;
