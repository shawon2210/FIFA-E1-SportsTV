-- ============================================================
-- A1TV v4 -- Sports Intelligence Schema
-- Match detection, event tracking, timeline, sports hub
-- ============================================================

-- ── Sports Leagues & Tournaments ────────────────────────────
CREATE TABLE IF NOT EXISTS sports_leagues (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(200) NOT NULL UNIQUE,
    sport           VARCHAR(50) NOT NULL,          -- football, cricket, basketball, etc.
    country         VARCHAR(100),
    logo_url        TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Sports Teams ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sports_teams (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league_id       UUID REFERENCES sports_leagues(id),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(200) NOT NULL,
    short_name      VARCHAR(10),                    -- e.g., "LIV", "MCY"
    country         VARCHAR(100),
    logo_url        TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(league_id, slug)
);

-- ── Sports Matches ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sports_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    league_id       UUID REFERENCES sports_leagues(id),
    home_team_id    UUID REFERENCES sports_teams(id),
    away_team_id    UUID REFERENCES sports_teams(id),
    channel_id      UUID REFERENCES channels(id),   -- Which channel broadcasts this
    status          VARCHAR(20) DEFAULT 'scheduled', -- scheduled, live, halftime, finished, postponed, cancelled
    match_time      TIMESTAMP WITH TIME ZONE NOT NULL,
    home_score      INTEGER DEFAULT 0,
    away_score      INTEGER DEFAULT 0,
    period          VARCHAR(20),                    -- 1st_half, 2nd_half, inning_1, set_1, etc.
    clock           VARCHAR(20),                    -- "45+2'", "3rd over", etc.
    venue           VARCHAR(200),
    metadata        JSONB DEFAULT '{}',             -- Formation, referee, VAR, etc.
    detected_at     TIMESTAMP WITH TIME ZONE,       -- When auto-detection found this
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sports_matches_status ON sports_matches(status);
CREATE INDEX IF NOT EXISTS idx_sports_matches_time ON sports_matches(match_time);
CREATE INDEX IF NOT EXISTS idx_sports_matches_league ON sports_matches(league_id);
CREATE INDEX IF NOT EXISTS idx_sports_matches_channel ON sports_matches(channel_id);
CREATE INDEX IF NOT EXISTS idx_sports_matches_live ON sports_matches(status, match_time) WHERE status = 'live';

-- ── Match Events (Goals, Cards, Wickets, etc.) ─────────────
CREATE TABLE IF NOT EXISTS match_events (
    id              BIGSERIAL PRIMARY KEY,
    match_id        UUID NOT NULL REFERENCES sports_matches(id) ON DELETE CASCADE,
    event_type      VARCHAR(50) NOT NULL,           -- goal, penalty, red_card, yellow_card, wicket, boundary, substitution, var_review
    event_subtype   VARCHAR(50),                    -- penalty_goal, own_goal, free_kick, header, six, four
    team_id         UUID REFERENCES sports_teams(id),
    player_name     VARCHAR(200),
    minute          VARCHAR(20),                    -- "23'", "14.3 overs"
    score_after     VARCHAR(20),                    -- "2-1", "145/3"
    description     TEXT,
    is_key_event    BOOLEAN DEFAULT false,          -- Highlight-worthy
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events(event_type);

-- ── Match-to-Channel Mapping ────────────────────────────────
-- Links live sports content to EPG programs for auto-detection
CREATE TABLE IF NOT EXISTS match_channel_mapping (
    id              BIGSERIAL PRIMARY KEY,
    match_id        UUID REFERENCES sports_matches(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES channels(id) ON DELETE CASCADE,
    epg_program_id  UUID,
    confidence      DECIMAL(3,2) DEFAULT 1.0,      -- Detection confidence
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(match_id, channel_id)
);

-- ── Sports Detection Log ────────────────────────────────────
-- Tracks auto-detection results from EPG scanning
CREATE TABLE IF NOT EXISTS sports_detection_log (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      UUID REFERENCES channels(id),
    program_title   VARCHAR(500),
    detected_match  VARCHAR(500),                   -- "Liverpool vs Arsenal"
    detected_league VARCHAR(200),
    confidence      DECIMAL(3,2),
    match_id        UUID REFERENCES sports_matches(id),
    status          VARCHAR(20) DEFAULT 'pending',  -- pending, confirmed, rejected
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sports_detection_channel ON sports_detection_log(channel_id, created_at);
