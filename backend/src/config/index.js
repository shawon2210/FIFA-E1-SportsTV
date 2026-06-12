// ============================================================
// A1TV Backend — Configuration
// ============================================================

require('dotenv').config();

module.exports = {
    server: {
        port: parseInt(process.env.PORT, 10) || 3000,
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development',
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5500,http://localhost:3001').split(','),
    },

    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        name: process.env.DB_NAME || 'a1tv',
        user: process.env.DB_USER || 'a1tv',
        password: process.env.DB_PASSWORD || 'a1tv_secret',
        poolMin: parseInt(process.env.DB_POOL_MIN, 10) || 2,
        poolMax: parseInt(process.env.DB_POOL_MAX, 10) || 10,
        ssl: process.env.DB_SSL === 'true',
    },

    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB, 10) || 0,
        keyPrefix: 'a1tv:',
    },

    cache: {
        ttl: {
            channels: 300,       // 5 minutes
            channel: 60,         // 1 minute
            categories: 600,     // 10 minutes
            countries: 3600,     // 1 hour
            search: 120,         // 2 minutes
            featured: 180,       // 3 minutes
            epg: 900,            // 15 minutes
            health: 60,          // 1 minute
        },
    },

    sync: {
        intervalHours: parseInt(process.env.SYNC_INTERVAL_HOURS, 10) || 6,
        iptvApiBase: 'https://iptv-org.github.io/api',
        batchSize: 500,
        requestTimeout: 30000,
    },

    healthCheck: {
        highPriorityInterval: 300,    // 5 minutes
        standardInterval: 1800,       // 30 minutes
        lowPriorityInterval: 3600,    // 1 hour
        timeout: 10000,               // 10 seconds
        maxFailures: 5,               // Mark offline after 5 consecutive failures
        recoveryThreshold: 2,         // Mark online after 2 consecutive successes
    },

    scoring: {
        weights: {
            uptime: 0.4,
            latency: 0.2,
            successRate: 0.3,
            resolution: 0.1,
        },
        resolutionScores: {
            '1080p': 100,
            '720p': 80,
            '480p': 50,
            '360p': 30,
        },
    },

    epg: {
        sources: [
            { name: 'iptv-org', url: 'https://iptv-org.github.io/epg/guides.xml.gz' },
        ],
        fetchIntervalHours: 12,
    },

    analytics: {
        batchSize: 100,
        flushIntervalMs: 30000,
    },
};
