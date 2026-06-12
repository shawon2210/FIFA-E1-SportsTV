-- ============================================================
-- Migration: 003_create_alert_system
-- Alert rules, channels, and history for monitoring
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(50) NOT NULL,
    condition_type  VARCHAR(50) NOT NULL,
    condition_config JSONB NOT NULL,
    severity        VARCHAR(20) DEFAULT 'warning',
    is_active       BOOLEAN DEFAULT true,
    cooldown_minutes INTEGER DEFAULT 60,
    last_triggered  TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO alert_rules (name, category, condition_type, condition_config, severity) VALUES
    ('High Offline Rate', 'streams', 'threshold', '{"metric": "offline_stream_pct", "operator": ">", "value": 20}', 'warning'),
    ('Critical Offline Rate', 'streams', 'threshold', '{"metric": "offline_stream_pct", "operator": ">", "value": 50}', 'critical'),
    ('Sync Job Failed', 'sync', 'absence', '{"metric": "last_sync", "operator": ">", "value": "12 hours"}', 'warning')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS alert_channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    type            VARCHAR(20) NOT NULL,
    config          JSONB NOT NULL,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_history (
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

CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_unack ON alert_history(acknowledged) WHERE acknowledged = false;
