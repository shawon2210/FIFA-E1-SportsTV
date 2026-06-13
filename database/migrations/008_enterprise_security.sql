-- ============================================================
-- A1TV v4 -- Enterprise Security Schema
-- SSO configurations, user consents, audit trail
-- ============================================================

-- ── SSO Configurations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sso_configurations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL UNIQUE,
    protocol        VARCHAR(10) NOT NULL,            -- saml, oidc
    -- SAML
    idp_metadata_url TEXT,
    idp_metadata_xml TEXT,
    idp_entity_id   VARCHAR(500),
    idp_sso_url     TEXT,
    idp_slo_url     TEXT,
    idp_x509_cert   TEXT,
    -- OIDC
    oidc_issuer     VARCHAR(500),
    oidc_client_id  VARCHAR(255),
    oidc_client_secret VARCHAR(255),
    oidc_authorization_url TEXT,
    oidc_token_url  TEXT,
    oidc_userinfo_url TEXT,
    oidc_scopes     VARCHAR(255) DEFAULT 'openid email profile',
    -- Common
    sp_entity_id    VARCHAR(500),
    sp_acs_url      TEXT,
    attribute_mapping JSONB DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── User Consents (GDPR) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_consents (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    purpose         VARCHAR(50) NOT NULL,            -- analytics, marketing, personalization
    granted         BOOLEAN NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents(user_id, purpose);

-- ── User Sessions (for audit) ──────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    token_hash      VARCHAR(255) NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    device_type     VARCHAR(50),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
