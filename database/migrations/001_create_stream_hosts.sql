-- ============================================================
-- Migration: 001_create_stream_hosts
-- Circuit breaker support: track per-domain health
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_hosts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host            VARCHAR(255) NOT NULL UNIQUE,
    domain          VARCHAR(255) NOT NULL,
    status          VARCHAR(20) DEFAULT 'healthy',
    total_streams   INTEGER DEFAULT 0,
    online_streams  INTEGER DEFAULT 0,
    failure_rate    DECIMAL(5,2) DEFAULT 0,
    avg_latency     INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    last_checked    TIMESTAMP WITH TIME ZONE,
    first_failure   TIMESTAMP WITH TIME ZONE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_hosts_status ON stream_hosts(status);
CREATE INDEX IF NOT EXISTS idx_stream_hosts_domain ON stream_hosts(domain);
CREATE INDEX IF NOT EXISTS idx_stream_hosts_failure_rate ON stream_hosts(failure_rate DESC);

-- Add host reference to streams
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='streams' AND column_name='host_id') THEN
        ALTER TABLE streams ADD COLUMN host_id UUID REFERENCES stream_hosts(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='streams' AND column_name='needs_proxy') THEN
        ALTER TABLE streams ADD COLUMN needs_proxy BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='streams' AND column_name='proxy_reason') THEN
        ALTER TABLE streams ADD COLUMN proxy_reason VARCHAR(100);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_streams_host ON streams(host_id);

-- Trigger for updated_at
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_stream_hosts_updated_at') THEN
        CREATE TRIGGER trg_stream_hosts_updated_at
            BEFORE UPDATE ON stream_hosts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;
