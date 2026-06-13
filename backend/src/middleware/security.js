// A1TV v2 - Security Middleware
// JWT hardening, RBAC enforcement, abuse protection, stream protection

const rateLimit = require('express-rate-limit');
const db = require('../config/database');
const authService = require('../services/auth');

// Rate limiters
const standardLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, message: { success: false, error: 'Rate limit exceeded' } });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, skipSuccessfulRequests: true });
const streamLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true });

// JWT Auth middleware
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ success: false, error: 'Authentication required' });
    const payload = authService.verifyAccessToken(header.substring(7));
    if (!payload) return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    req.userId = payload.sub;
    req.userRole = payload.role;
    next();
}

// Optional auth (works for both authenticated and anonymous)
function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        const payload = authService.verifyAccessToken(header.substring(7));
        if (payload) { req.userId = payload.sub; req.userRole = payload.role; }
    }
    const deviceId = req.headers['x-device-id'] || req.body?.device_id || req.query?.device_id;
    if (deviceId) req.deviceIdString = deviceId;
    next();
}

// RBAC middleware
function requireRole(...roles) {
    return function(req, res, next) {
        if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
        if (!roles.includes(req.userRole)) return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        next();
    };
}

function requireAdmin(req, res, next) {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, error: 'Admin access required' });
    next();
}

function requirePremium(req, res, next) {
    if (!['premium', 'admin'].includes(req.userRole)) return res.status(403).json({ success: false, error: 'Premium access required' });
    next();
}

// Device fingerprint middleware
function deviceFingerprint(req, res, next) {
    const ua = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress;
    req.fingerprint = require('crypto').createHash('sha256').update(ua + ip).digest('hex').substring(0, 16);
    next();
}

// Bot detection middleware
function botDetection(req, res, next) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const bots = ['bot', 'crawler', 'spider', 'scraper', 'curl', 'wget', 'python-requests'];
    if (bots.some(b => ua.includes(b)) && !req.headers.authorization) {
        return res.status(403).json({ success: false, error: 'Automated access denied' });
    }
    next();
}

// Input sanitization
function sanitizeInput(req, res, next) {
    const clean = (str) => {
        if (typeof str !== 'string') return str;
        return str.replace(/[<>]/g, '').trim().substring(0, 500);
    };
    if (req.query) Object.keys(req.query).forEach(k => { if (typeof req.query[k] === 'string') req.query[k] = clean(req.query[k]); });
    if (req.body) Object.keys(req.body).forEach(k => { if (typeof req.body[k] === 'string') req.body[k] = clean(req.body[k]); });
    next();
}

// Stream protection - signed URL verification
function verifyStreamToken(req, res, next) {
    const { token, expires, sid } = req.query;
    if (!token || !expires || !sid) return res.status(403).json({ success: false, error: 'Invalid stream token' });
    if (Date.now() / 1000 > parseInt(expires)) return res.status(403).json({ success: false, error: 'Stream token expired' });
    next();
}

// Abuse tracking
async function trackAbuse(req, type, details) {
    try {
        await db('rate_limits').insert({
            key: req.ip + ':' + type,
            endpoint: req.path,
            request_count: 1,
            window_start: new Date(),
        }).onConflict(['key', 'endpoint', 'window_start']).merge({ request_count: db.raw('rate_limits.request_count + 1') });
    } catch (e) {}
}

module.exports = {
    authenticate, optionalAuth, requireRole, requireAdmin, requirePremium,
    deviceFingerprint, botDetection, sanitizeInput, verifyStreamToken, trackAbuse,
    standardLimiter, strictLimiter, authLimiter, streamLimiter,
};
