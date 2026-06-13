-- ============================================================
-- A1TV v4 — pgvector Embedding Tables
-- Stores embeddings for channels, programs, and users
-- to enable similarity-based recommendations.
--
-- Requires: CREATE EXTENSION IF NOT EXISTS vector;
-- ============================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Channel Embeddings ──────────────────────────────────────
-- Each channel gets a 384-dimensional embedding vector
-- representing its content profile (category, language, tags, etc.)
CREATE TABLE IF NOT EXISTS channel_embeddings (
    id              BIGSERIAL PRIMARY KEY,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    embedding       vector(384),                    -- 384-dim embedding
    model_version   VARCHAR(50) DEFAULT 'v1',       -- Which model generated this
    metadata        JSONB DEFAULT '{}',             -- Source features used
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(channel_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_channel_embeddings_channel ON channel_embeddings(channel_id);
-- IVFFlat index for approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_channel_embeddings_vector ON channel_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Program Embeddings (EPG) ────────────────────────────────
-- Embeddings for TV programs/shows
CREATE TABLE IF NOT EXISTS program_embeddings (
    id              BIGSERIAL PRIMARY KEY,
    program_id      UUID NOT NULL,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    embedding       vector(384),
    model_version   VARCHAR(50) DEFAULT 'v1',
    title           VARCHAR(500),
    category        VARCHAR(100),
    start_time      TIMESTAMP WITH TIME ZONE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(program_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_program_embeddings_program ON program_embeddings(program_id);
CREATE INDEX IF NOT EXISTS idx_program_embeddings_channel ON program_embeddings(channel_id);
CREATE INDEX IF NOT EXISTS idx_program_embeddings_vector ON program_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_program_embeddings_start ON program_embeddings(start_time);

-- ── User Embeddings ─────────────────────────────────────────
-- User preference embeddings based on watch history
CREATE TABLE IF NOT EXISTS user_embeddings (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    embedding       vector(384),
    model_version   VARCHAR(50) DEFAULT 'v1',
    watch_count     INTEGER DEFAULT 0,              -- Number of views used
    favorite_categories TEXT[],
    favorite_channels   TEXT[],
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, model_version)
);

CREATE INDEX IF NOT EXISTS idx_user_embeddings_user ON user_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_embeddings_vector ON user_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Embedding Generation Queue ──────────────────────────────
-- Tracks which items need embedding generation
CREATE TABLE IF NOT EXISTS embedding_queue (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     VARCHAR(50) NOT NULL,           -- 'channel', 'program', 'user'
    entity_id       UUID NOT NULL,
    status          VARCHAR(20) DEFAULT 'pending',  -- pending, processing, done, failed
    priority        INTEGER DEFAULT 5,              -- 1=highest, 10=lowest
    attempts        INTEGER DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at    TIMESTAMP WITH TIME ZONE,
    UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_queue_status ON embedding_queue(status, priority, created_at);
