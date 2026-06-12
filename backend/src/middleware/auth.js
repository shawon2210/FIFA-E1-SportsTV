// ============================================================
// A1TV v2 — API Middleware: Auth, Rate Limiting, Validation
// ============================================================

const rateLimit = require('express-rate-limit');
const { body, query, param, validationResult } = require('express-validator');
const authService = require('../services/auth');
const db = require('../config/database');

// ── JWT Auth Middleware ────────────────────────────────────
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const token = header.substring(7);
    const payload = authService.verifyAccessToken(token);

    if (!payload) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    req.userId = payload.sub;
    req.userRole = payload.role;
    next();
}

// ── Optional Auth (works for both authenticated and anonymous) ──
function optionalAuth(req, res, next) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        const payload = authService.verifyAccessToken(header.substring(7));
        if (payload) {
            req.userId = payload.sub;
            req.userRole = payload.role;
        }
    }
    next();
}

// ── Admin Only ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}

// ── Rate Limiters ─────────────────────────────────────────
const standardLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    message: { success: false, error: 'Too many requests, try again later' },
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    message: { success: false, error: 'Too many requests' },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    message: { success: false, error: 'Too many auth attempts' },
});

// ── Validation Error Handler ──────────────────────────────
function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array().map(e => ({ field: e.path, message: e.msg })),
        });
    }
    next();
}

// ── Device ID Middleware ───────────────────────────────────
function requireDevice(req, res, next) {
    const deviceId = req.headers['x-device-id'] || req.body?.device_id || req.query?.device_id;
    if (deviceId) {
        req.deviceIdString = deviceId;
    }
    next();
}

// ── Concurrent Viewer Tracker ─────────────────────────────
async function trackViewer(channelId, sessionId, userId, deviceId) {
    if (!sessionId) return;
    try {
        await db('concurrent_viewers')
            .insert({ channel_id: channelId, user_id: userId, device_id: deviceId, session_id: sessionId })
            .onConflict('session_id')
            .merge({ last_heartbeat: new Date() });
    } catch {}
}

module.exports = {
    authenticate, optionalAuth, requireAdmin,
    standardLimiter, strictLimiter, authLimiter,
    validate, requireDevice, trackViewer,
    body, query, param,
};
