// ============================================================
// A1TV Backend — Express Server
// ============================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const cache = require('./services/cache');

// Import routes
const channelsRouter = require('./routes/channels');
const searchRouter = require('./routes/index');

const app = express();

// ============================================================
// Middleware
// ============================================================

app.use(helmet({
    contentSecurityPolicy: false, // Allow HLS.js CDN
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: config.server.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(compression());
app.use(express.json({ limit: '10kb' }));

// Attach cache to requests
app.use((req, res, next) => {
    req.cache = cache;
    next();
});

// Request logging (dev only)
if (config.server.env === 'development') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const elapsed = Date.now() - start;
            console.log(`${req.method} ${req.path} ${res.statusCode} ${elapsed}ms`);
        });
        next();
    });
}

// ============================================================
// Routes
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

app.use('/api/channels', channelsRouter);
app.use('/api/search', searchRouter);
app.use('/api/categories', searchRouter);
app.use('/api/countries', searchRouter);
app.use('/api/epg', searchRouter);
app.use('/api/analytics', searchRouter);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ============================================================
// Start Server
// ============================================================

async function start() {
    // Connect to Redis
    await cache.connect();

    // Start HTTP server
    app.listen(config.server.port, config.server.host, () => {
        console.log(`A1TV API Server running on http://${config.server.host}:${config.server.port}`);
        console.log(`Environment: ${config.server.env}`);
    });
}

start().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

module.exports = app;
