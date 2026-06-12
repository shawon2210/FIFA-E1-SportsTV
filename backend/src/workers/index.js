// ============================================================
// A1TV Backend — Background Job Workers (BullMQ)
// Manages: IPTV sync, health checks, scoring, EPG collection
// ============================================================

const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const config = require('./config');
const iptvSync = require('./services/iptvSync');
const healthChecker = require('./services/healthChecker');
const streamScorer = require('./services/streamScorer');
const cache = require('./services/cache');

// Redis connection for BullMQ
const redisConnection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
    maxRetriesPerRequest: null,
});

// ============================================================
// Queues
// ============================================================

const syncQueue = new Queue('iptv-sync', { connection: redisConnection });
const healthCheckQueue = new Queue('health-check', { connection: redisConnection });
const scoringQueue = new Queue('stream-scoring', { connection: redisConnection });
const epgQueue = new Queue('epg-collect', { connection: redisConnection });

// ============================================================
// Workers
// ============================================================

// IPTV Sync Worker
const syncWorker = new Worker('iptv-sync', async (job) => {
    console.log(`[Sync] Starting IPTV sync job ${job.id}...`);
    const result = await iptvSync.syncAll();
    console.log(`[Sync] Completed:`, result);
    return result;
}, {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 1, duration: 60000 }, // Max 1 per minute
});

// Health Check Worker
const healthWorker = new Worker('health-check', async (job) => {
    const { priority } = job.data;
    console.log(`[Health] Running health check cycle${priority ? ` (${priority})` : ''}...`);
    const result = await healthChecker.runCycle();
    console.log(`[Health] Completed:`, result);
    return result;
}, {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 1, duration: 60000 },
});

// Stream Scoring Worker
const scoringWorker = new Worker('stream-scoring', async (job) => {
    console.log(`[Scoring] Recalculating stream scores...`);
    const result = await streamScorer.recalculateAll();
    console.log(`[Scoring] Updated ${result} stream scores`);
    return { updated: result };
}, {
    connection: redisConnection,
    concurrency: 1,
});

// EPG Collection Worker
const epgWorker = new Worker('epg-collect', async (job) => {
    console.log(`[EPG] Collecting EPG data...`);
    // EPG collection logic would go here
    // For now, just a placeholder
    return { status: 'not_implemented' };
}, {
    connection: redisConnection,
    concurrency: 1,
});

// ============================================================
// Scheduled Jobs
// ============================================================

async function setupScheduledJobs() {
    // IPTV Sync: every 6 hours
    await syncQueue.add('sync-all', {}, {
        repeat: { cron: '0 */6 * * *' },
        jobId: 'scheduled-sync',
    });
    console.log('✓ Scheduled: IPTV sync every 6 hours');

    // Health Check: every 5 minutes
    await healthCheckQueue.add('health-cycle', {}, {
        repeat: { cron: '*/5 * * * *' },
        jobId: 'scheduled-health',
    });
    console.log('✓ Scheduled: Health check every 5 minutes');

    // Stream Scoring: every 15 minutes
    await scoringQueue.add('recalculate-scores', {}, {
        repeat: { cron: '*/15 * * * *' },
        jobId: 'scheduled-scoring',
    });
    console.log('✓ Scheduled: Stream scoring every 15 minutes');

    // EPG Collection: every 12 hours
    await epgQueue.add('collect-epg', {}, {
        repeat: { cron: '0 */12 * * *' },
        jobId: 'scheduled-epg',
    });
    console.log('✓ Scheduled: EPG collection every 12 hours');
}

// ============================================================
// Event Handlers
// ============================================================

[syncWorker, healthWorker, scoringWorker, epgWorker].forEach(worker => {
    worker.on('completed', (job, result) => {
        console.log(`[${worker.name}] Job ${job.id} completed:`, JSON.stringify(result));
    });

    worker.on('failed', (job, err) => {
        console.error(`[${worker.name}] Job ${job?.id} failed:`, err.message);
    });
});

// ============================================================
// Graceful Shutdown
// ============================================================

async function shutdown() {
    console.log('Shutting down workers...');
    await Promise.all([
        syncWorker.close(),
        healthWorker.close(),
        scoringWorker.close(),
        epgWorker.close(),
        syncQueue.close(),
        healthCheckQueue.close(),
        scoringQueue.close(),
        epgQueue.close(),
        redisConnection.quit(),
        cache.quit(),
    ]);
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================
// Start
// ============================================================

async function start() {
    await cache.connect();
    await setupScheduledJobs();
    console.log('A1TV Background Workers started');
}

start().catch(err => {
    console.error('Failed to start workers:', err);
    process.exit(1);
});

module.exports = {
    syncQueue,
    healthCheckQueue,
    scoringQueue,
    epgQueue,
};
