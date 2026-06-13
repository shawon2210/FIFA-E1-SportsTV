// ============================================================
// A1TV v2 — Express Server (Production)
// API versioning (/api/v1/*), WebSocket, rate limiting,
// security headers, all routes wired.
//
// Note: All requires are deferred to avoid native module loading
// deadlock on Node 22 + WSL2 (pg vs express addon conflict).
// ============================================================

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const cache = require('./services/cache');

// Lazy-load remaining modules to avoid native module deadlock
let _rateLimiter, _wsService, _metricsRouter, _httpRequestDuration;
let _channelsRouter, _searchRouter, _proxyRouter, _adminRouter, _epgRouter;
let _recRouter, _accountsRouter, _streamRouter, _epgIntelRouter;
let _orgRouter, _gatewayRouter, _streamIntelRouter, _recV2Router;
let _sportsRouter, _billingRouter, _whiteLabelRouter, _enterpriseRouter;
let _traceMiddleware, _startHealthMonitor, _setupTelemetry;
let _securityMonitor, _auditService;

function getRateLimiter() {
    if (!_rateLimiter) _rateLimiter = require('./services/rateLimiter');
    return _rateLimiter;
}
function getWsService() {
    if (!_wsService) _wsService = require('./services/websocket');
    return _wsService;
}
function getMetricsRouter() {
    if (!_metricsRouter) {
        const m = require('./routes/metrics');
        _metricsRouter = m.router;
        _httpRequestDuration = m.httpRequestDuration;
    }
    return _metricsRouter;
}
function getHttpRequestDuration() {
    if (!_httpRequestDuration) { const m = require('./routes/metrics'); _httpRequestDuration = m.httpRequestDuration; }
    return _httpRequestDuration;
}
function getChannelsRouter() {
    if (!_channelsRouter) _channelsRouter = require('./routes/channels');
    return _channelsRouter;
}
function getSearchRouter() {
    if (!_searchRouter) _searchRouter = require('./routes/index');
    return _searchRouter;
}
function getProxyRouter() {
    if (!_proxyRouter) _proxyRouter = require('./routes/proxy');
    return _proxyRouter;
}
function getAdminRouter() {
    if (!_adminRouter) _adminRouter = require('./routes/admin');
    return _adminRouter;
}
function getEpgRouter() {
    if (!_epgRouter) _epgRouter = require('./routes/epg');
    return _epgRouter;
}
function getRecRouter() {
    if (!_recRouter) _recRouter = require('./routes/recommendations');
    return _recRouter;
}
function getAccountsRouter() {
    if (!_accountsRouter) _accountsRouter = require('./routes/accounts');
    return _accountsRouter;
}
function getStreamRouter() {
    if (!_streamRouter) _streamRouter = require('./routes/stream');
    return _streamRouter;
}
function getEpgIntelRouter() {
    if (!_epgIntelRouter) _epgIntelRouter = require('./routes/epg-intel');
    return _epgIntelRouter;
}
function getOrgRouter() {
    if (!_orgRouter) _orgRouter = require('./routes/organizations').router;
    return _orgRouter;
}
function getGatewayRouter() {
    if (!_gatewayRouter) _gatewayRouter = require('./routes/gateway');
    return _gatewayRouter;
}
function getStreamIntelRouter() {
    if (!_streamIntelRouter) _streamIntelRouter = require('./routes/streamIntel');
    return _streamIntelRouter;
}
function getRecV2Router() {
    if (!_recV2Router) _recV2Router = require('./routes/recommendationsV2');
    return _recV2Router;
}
function getSportsRouter() {
    if (!_sportsRouter) _sportsRouter = require('./routes/sports');
    return _sportsRouter;
}
function getBillingRouter() {
    if (!_billingRouter) _billingRouter = require('./routes/billing');
    return _billingRouter;
}
function getWhiteLabelRouter() {
    if (!_whiteLabelRouter) _whiteLabelRouter = require('./routes/whiteLabel');
    return _whiteLabelRouter;
}
function getEnterpriseRouter() {
    if (!_enterpriseRouter) _enterpriseRouter = require('./routes/enterprise');
    return _enterpriseRouter;
}
function getTraceMiddleware() {
    if (!_traceMiddleware) _traceMiddleware = require('./services/tracing').traceMiddleware;
    return _traceMiddleware;
}
function getStartHealthMonitor() {
    if (!_startHealthMonitor) _startHealthMonitor = require('./services/gateway/healthMonitor').startHealthMonitor;
    return _startHealthMonitor;
}
function getSetupTelemetry() {
    if (!_setupTelemetry) _setupTelemetry = require('./services/otel').setupTelemetry;
    return _setupTelemetry;
}
function getSecurity() {
    if (!_securityMonitor) {
        const s = require('./services/security');
        _securityMonitor = s.securityMonitor;
        _auditService = s.auditService;
    }
    return { securityMonitor: _securityMonitor, auditService: _auditService };
}

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
app.use((req, res, next) => getTraceMiddleware()(req, res, next));

// Security: bot detection + input sanitization
app.use((req, res, next) => {
    const { securityMonitor: sm, auditService: as } = getSecurity();
    const check = sm.checkRequest(req);
    if (check.suspicious && check.severity === 'critical') {
        as.log({ action: 'security:blocked', actor: { type: 'anonymous' }, target: { type: 'request', id: req.url }, details: check, ipAddress: req.ip, userAgent: req.headers['user-agent'] }).catch(() => {});
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
        getHttpRequestDuration().observe({ method: req.method, route, status_code: res.statusCode }, duration);
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
        websocket: getWsService().getConnectedCount(),
    });
});

// ============================================================
// API v1 Routes
// ============================================================

const v1 = express.Router();

// Rate limiting per endpoint type
v1.use('/channels/*/stream', getRateLimiter().middleware({ windowSeconds: 60, maxRequests: 10, keyGenerator: req => req.ip }));
v1.use('/search', getRateLimiter().middleware({ windowSeconds: 60, maxRequests: 20, keyGenerator: req => req.ip }));
v1.use('/auth', getRateLimiter().middleware({ windowSeconds: 900, maxRequests: 10, keyGenerator: req => req.ip }));
v1.use(getRateLimiter().middleware({ windowSeconds: 60, maxRequests: 100, keyGenerator: req => req.ip }));

// Channels
v1.use('/channels', getChannelsRouter());

// Search
v1.use('/search', getSearchRouter());

// Categories & Countries
v1.use('/categories', getSearchRouter());
v1.use('/countries', getSearchRouter());

// EPG
v1.use('/epg', getSearchRouter());

// Analytics
v1.use('/analytics', getSearchRouter());

// Stream proxy
v1.use('/proxy', getProxyRouter());

// EPG (rich TV guide, timeline, reminders)
v1.use('/epg', getEpgRouter());

// Recommendations (personalized, trending, similar)
v1.use('/recommendations', getRecRouter());

// Stream Proxy
v1.use('/stream', getStreamRouter());

// EPG Intelligence (search, upcoming, reminders)
v1.use('/epg', getEpgIntelRouter());

// Auth & User Accounts
v1.use('/auth', getAccountsRouter());
v1.use('/users', getAccountsRouter());

// Organizations (multi-tenant)
v1.use('/organizations', getOrgRouter());

// AI Layer (smart search, personalized home)
v1.use('/ai', require('./routes/ai'));

// Stream Gateway (regional routing, edge affinity, origin selection)
v1.use('/gateway', getGatewayRouter());

// Predictive Stream Intelligence v2
v1.use('/intelligence', getStreamIntelRouter());

// Recommendation Engine v2 (embedding-based)
v1.use('/recommendations/v2', getRecV2Router());

// Sports Intelligence (matches, timeline, sports hub)
v1.use('/sports', getSportsRouter());

// Subscription & Billing
v1.use('/billing', getBillingRouter());

// White Label SaaS (themes, domains, branding, analytics)
v1.use('/whitelabel', getWhiteLabelRouter());

// Enterprise Security (SSO, SCIM, GDPR, Compliance)
v1.use('/enterprise', getEnterpriseRouter());

// Admin (requires auth + admin role)
v1.use('/admin', getAdminRouter());

// Mount v1 router
app.use('/api/v1', v1);

// Prometheus metrics (unversioned, for scraping)
app.use('/metrics', getMetricsRouter());

// Serve admin dashboard
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// Legacy /api/ redirect to /api/v1/
app.use('/api/channels', (req, res) => res.redirect(301, '/api/v1' + req.path));
app.use('/api/search', (req, res) => res.redirect(301, '/api/v1' + req.path));
app.use('/api/categories', (req, res) => res.redirect(301, '/api/v1' + req.path));

// ============================================================
// WebSocket Initialization
// ============================================================

getWsService().init(server, config.server.corsOrigins);

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
    getStartHealthMonitor()();

    // Initialize OpenTelemetry
    getSetupTelemetry()();

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
