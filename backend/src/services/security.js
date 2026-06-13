// A1TV v2 - Security & Compliance
// Audit system, security monitoring, secrets management

const db = require('../config/database');
const crypto = require('crypto');

class AuditService {
    /**
     * Log an audit event.
     */
    async log({ action, actor, target, details = {}, ipAddress, userAgent }) {
        try {
            await db('audit_log').insert({
                id: crypto.randomUUID(),
                action,
                actor_id: actor?.id || null,
                actor_type: actor?.type || 'user',
                target_type: target?.type || null,
                target_id: target?.id || null,
                details: JSONB(details),
                ip_address: ipAddress || null,
                user_agent: userAgent?.substring(0, 200) || null,
                created_at: new Date(),
            });
        } catch (err) { console.error('[Audit] Log failed:', err.message); }
    }

    /**
     * Get audit trail for a target.
     */
    async getTrail(targetType, targetId, limit = 50) {
        return db('audit_log')
            .where({ target_type: targetType, target_id: targetId })
            .orderBy('created_at', 'desc')
            .limit(limit);
    }

    /**
     * Get recent admin actions.
     */
    async getAdminActions(limit = 100) {
        return db('audit_log')
            .whereIn('action', ['channel.create', 'channel.update', 'channel.delete', 'stream.ban', 'user.role.change', 'org.settings.update'])
            .orderBy('created_at', 'desc')
            .limit(limit);
    }
}

// Audit log table (if not exists)
const auditTableSQL = `
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY,
    action          VARCHAR(100) NOT NULL,
    actor_id        UUID,
    actor_type      VARCHAR(20) DEFAULT 'user',
    target_type     VARCHAR(50),
    target_id       UUID,
    details         JSONB DEFAULT '{}',
    ip_address      INET,
    user_agent      VARCHAR(200),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`;

// Security monitoring
class SecurityMonitor {
    constructor() {
        this.suspiciousPatterns = [
            { pattern: /(\/api\/v1\/.*){50,}/, action: 'api_flood', severity: 'high' },
            { pattern: /(union|select|drop|insert|delete|update).*--/i, action: 'sql_injection', severity: 'critical' },
            { pattern: /<script|javascript:|on\w+=/i, action: 'xss_attempt', severity: 'high' },
            { pattern: /\.\.\/|\.\.\\/, action: 'path_traversal', severity: 'high' },
        ];
    }

    /**
     * Check request for suspicious patterns.
     */
    checkRequest(req) {
        const url = req.url || '';
        const body = JSON.stringify(req.body || {});
        const query = JSON.stringify(req.query || {});
        const checkString = url + ' ' + body + ' ' + query;

        for (const { pattern, action, severity } of this.suspiciousPatterns) {
            if (pattern.test(checkString)) {
                return { suspicious: true, action, severity, url: url.substring(0, 200) };
            }
        }

        return { suspicious: false };
    }

    /**
     * Track failed auth attempts.
     */
    async trackFailedAuth(identifier, ip) {
        const key = 'auth_fail:' + ip;
        const attempts = await require('../services/cache').get(key) || 0;
        await require('../services/cache').set(key, attempts + 1, 900); // 15 min window

        if (attempts >= 10) {
            await db('security_events').insert({
                id: crypto.randomUUID(),
                type: 'brute_force',
                severity: 'critical',
                identifier,
                ip_address: ip,
                details: { attempts: attempts + 1 },
                created_at: new Date(),
            }).onConflict().ignore();

            return { blocked: true, attempts: attempts + 1 };
        }

        return { blocked: false, attempts: attempts + 1 };
    }
}

// Security events table
const securityTableSQL = `
CREATE TABLE IF NOT EXISTS security_events (
    id              UUID PRIMARY KEY,
    type            VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL,
    identifier      VARCHAR(255),
    ip_address      INET,
    details         JSONB DEFAULT '{}',
    resolved        BOOLEAN DEFAULT false,
    resolved_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sec_type ON security_events(type);
CREATE INDEX IF NOT EXISTS idx_sec_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_sec_created ON security_events(created_at DESC);
`;

const auditService = new AuditService();
const securityMonitor = new SecurityMonitor();

module.exports = { auditService, securityMonitor, auditTableSQL, securityTableSQL };
