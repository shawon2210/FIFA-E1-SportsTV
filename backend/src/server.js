// ============================================================
// A1TV v2 — Express Server (Production)
// API versioning (/api/v1/*), WebSocket, rate limiting,
// security headers, all routes wired.
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const cache = require('./services/cache');
const rateLimiter = require('./services/rateLimiter');
const wsService = require('./services/websocket');
const { router: metricsRouter, httpRequestDuration } = require('./routes/metrics');

// Import routes
const channelsRouter = require('./routes/channels');
const searchRouter = require('./routes/index');
const proxyRouter = require('./routes/proxy');
const adminRouter = require('./routes/admin');
const epgRouter = require('./routes/epg');
const recRouter = require('./routes/recommendations');
const accountsRouter = require('./routes/accounts');
const streamRouter = require('./routes/stream');
const epgIntelRouter = require('./routes/epg-intel');
const orgRouter = require('./routes/organizations').router;
const gatewayRouter = require('./routes/gateway');
const streamIntelRouter = require('./routes/streamIntel');
const recV2Router = require('./routes/recommendationsV2');
const sportsRouter = require('./routes/sports');
const billingRouter = require('./routes/billing');
const whiteLabelRouter = require('./routes/whiteLabel');
const enterpriseRouter = require('./routes/enterprise');
const { traceMiddleware } = require('./services/tracing');
const { startHealthMonitor } = require('./services/gateway/healthMonitor');
const { setupTelemetry } = require('./services/otel');
const { securityMonitor, auditService, auditTableSQL, securityTableSQL } = require('./services/security');

const app = express();
const server = http.createServer(app);

// ============================================================
// Global Middleware
// ============================================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: config.server.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Session-Id'],
}));

app.use(compression());
app.use(express.json({ limit: '10kb' }));

// Attach cache to requests
app.use((req, res, next) => { req.cache = cache; next(); });

// Distributed tracing
app.use(traceMiddleware);

// Security: bot detection + input sanitization
app.use((req, res, next) => {
    const check = securityMonitor.checkRequest(req);
    if (check.suspicious && check.severity === 'critical') {
        auditService.log({ action: 'security:blocked', actor: { type: 'anonymous' }, target: { type: 'request', id: req.url }, details: check, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
        return res.status(403).json({ success: false, error: 'Request blocked' });
    }
    next();
});

// Prometheus HTTP duration tracking
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route?.path || req.path;
        httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, duration);
    });
    next();
});

// Request logging (dev only)
if (config.server.env === 'development') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
        });
        next();
    });
}

// ============================================================
// Health Check (unversioned)
// ============================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        version: '2.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        websocket: wsService.getConnectedCount(),
    });
});

// ============================================================
// API v1 Routes
// ============================================================

const v1 = express.Router();

// Rate limiting per endpoint type
v1.use('/channels/*/stream', rateLimiter.middleware({ windowSeconds: 60, maxRequests: 10, keyGenerator: req => req.ip }));
v1.use('/search', rateLimiter.middleware({ windowSeconds: 60, maxRequests: 20, keyGenerator: req => req.ip }));
v1.use('/auth', rateLimiter.middleware({ windowSeconds: 900, maxRequests: 10, keyGenerator: req => req.ip }));
v1.use(rateLimiter.middleware({ windowSeconds: 60, maxRequests: 100, keyGenerator: req => req.ip }));

// Channels
v1.use('/channels', channelsRouter);

// Search
v1.use('/search', searchRouter);

// Categories & Countries
v1.use('/categories', searchRouter);
v1.use('/countries', searchRouter);

// EPG
v1.use('/epg', searchRouter);

// Analytics
v1.use('/analytics', searchRouter);

// Stream proxy
v1.use('/proxy', proxyRouter);

// EPG (rich TV guide, timeline, reminders)
v1.use('/epg', epgRouter);

// Recommendations (personalized, trending, similar)
v1.use('/recommendations', recRouter);

// Stream Proxy
v1.use('/stream', streamRouter);

// EPG Intelligence (search, upcoming, reminders)
v1.use('/epg', epgIntelRouter);

// Auth & User Accounts
v1.use('/auth', accountsRouter);
v1.use('/users', accountsRouter);

// Organizations (multi-tenant)
v1.use('/organizations', orgRouter);

// AI Layer (smart search, personalized home)
v1.use('/ai', require('./routes/ai'));

// Stream Gateway (regional routing, edge affinity, origin selection)
v1.use('/gateway', gatewayRouter);

// Predictive Stream Intelligence v2
v1.use('/intelligence', streamIntelRouter);

// Recommendation Engine v2 (embedding-based)
v1.use('/recommendations/v2', recV2Router);

// Sports Intelligence (matches, timeline, sports hub)
v1.use('/sports', sportsRouter);

// Subscription & Billing
v1.use('/billing', billingRouter);

// White Label SaaS (themes, domains, branding, analytics)
v1.use('/whitelabel', whiteLabelRouter);

// Enterprise Security (SSO, SCIM, GDPR, Compliance)
v1.use('/enterprise', enterpriseRouter);

// Admin (requires auth + admin role)
v1.use('/admin', adminRouter);

// Mount v1 router
app.use('/api/v1', v1);

// Prometheus metrics (unversioned, for scraping)
app.use('/metrics', metricsRouter);

// Serve admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Legacy /api/ redirect to /api/v1/
app.use('/api/channels', (req, res) => res.redirect(301, '/api/v1' + req.path));
app.use('/api/search', (req, res) => res.redirect(301, '/api/v1' + req.path));
app.use('/api/categories', (req, res) => res.redirect(301, '/api/v1' + req.path));

// ============================================================
// WebSocket Initialization
// ============================================================

wsService.init(server, config.server.corsOrigins);

// ============================================================
// Error Handlers
// ============================================================

app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found', path: req.path });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================
// Graceful Shutdown
// ============================================================

function shutdown() {
    console.log('Shutting down server...');
    server.close(async () => {
        await cache.quit();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================
// Start Server
// ============================================================

async function start() {
    await cache.connect();

    // Start gateway health monitor
    startHealthMonitor();

    // Initialize OpenTelemetry
    setupTelemetry();

    server.listen(config.server.port, config.server.host, () => {
        console.log(`A1TV API v2 running on http://${config.server.host}:${config.server.port}`);
        console.log(`WebSocket: ws://${config.server.host}:${config.server.port}`);
        console.log(`Environment: ${config.server.env}`);
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = { app, server };
