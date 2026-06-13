-- ============================================================
-- A1TV v4 — Stream Telemetry Table
-- Time-series data for predictive stream intelligence
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_telemetry (
    id              BIGSERIAL PRIMARY KEY,
    stream_id       UUID NOT NULL,
    region          VARCHAR(50) DEFAULT 'unknown',
    failure         BOOLEAN DEFAULT false,
    packet_loss     DECIMAL(5,2) DEFAULT 0,       -- Percentage 0-100
    cdn_latency     INTEGER DEFAULT 0,             -- Milliseconds
    viewer_dropoff  DECIMAL(5,2) DEFAULT 0,       -- Percentage 0-100
    buffering       BOOLEAN DEFAULT false,
    reconnect       BOOLEAN DEFAULT false,
    bitrate_delta   DECIMAL(10,2) DEFAULT 0,      -- Kbps change
    segment_missing BOOLEAN DEFAULT false,
    recorded_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_stream_telemetry_stream_id ON stream_telemetry(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_telemetry_recorded_at ON stream_telemetry(recorded_at);
CREATE INDEX IF NOT EXISTS idx_stream_telemetry_stream_time ON stream_telemetry(stream_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_telemetry_region ON stream_telemetry(region);

-- Auto-cleanup: keep only 7 days of telemetry data
-- (Run via pg_cron or application-level cleanup)
CREATE INDEX IF NOT EXISTS idx_stream_telemetry_cleanup ON stream_telemetry(recorded_at)
    WHERE recorded_at < NOW() - INTERVAL '7 days';
