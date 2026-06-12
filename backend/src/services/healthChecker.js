// ============================================================
// A1TV v2 — Stream Health Checker (BullMQ Worker)
// Full validation with scheduling tiers per channel priority.
// Schedules: high=5min, sports/news=5min, standard=30min, low=60min
// ============================================================

const db = require('../config/database');
const config = require('../config');
const { ValidationService, STATUS } = require('./validation');

class HealthChecker {
    constructor() {
        this.running = false;
        this.batchSize = 20; // Parallel checks per batch
    }

    async runCycle() {
        if (this.running) { console.log('[Health] Already running, skipping'); return { skipped: true }; }
        this.running = true;
        const start = Date.now();
        let checked = 0, online = 0, offline = 0;

        try {
            // High priority (featured + sports + news)
            const highStreams = await this.getStreamsDue('high');
            console.log(`[Health] Checking ${highStreams.length} high-priority streams...`);
            for (let i = 0; i < highStreams.length; i += this.batchSize) {
                const batch = highStreams.slice(i, i + this.batchSize);
                const results = await Promise.allSettled(batch.map(s => this.checkAndSave(s)));
                results.forEach(r => { if (r.status === 'fulfilled') { checked++; r.value ? online++ : offline++; } });
            }

            // Standard priority
            const stdStreams = await this.getStreamsDue('standard');
            console.log(`[Health] Checking ${stdStreams.length} standard streams...`);
            for (let i = 0; i < stdStreams.length; i += this.batchSize) {
                const batch = stdStreams.slice(i, i + this.batchSize);
                const results = await Promise.allSettled(batch.map(s => this.checkAndSave(s)));
                results.forEach(r => { if (r.status === 'fulfilled') { checked++; r.value ? online++ : offline++; } });
            }

            // Low priority (only check 50 per cycle)
            const lowStreams = (await this.getStreamsDue('low')).slice(0, 50);
            if (lowStreams.length) {
                console.log(`[Health] Checking ${lowStreams.length} low-priority streams...`);
                for (let i = 0; i < lowStreams.length; i += this.batchSize) {
                    const batch = lowStreams.slice(i, i + this.batchSize);
                    const results = await Promise.allSettled(batch.map(s => this.checkAndSave(s)));
                    results.forEach(r => { if (r.status === 'fulfilled') { checked++; r.value ? online++ : offline++; } });
                }
            }

            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`[Health] Done: ${checked} checked, ${online} online, ${offline} offline (${elapsed}s)`);
            return { checked, online, offline, elapsed: elapsed + 's' };
        } catch (err) {
            console.error('[Health] Cycle failed:', err.message);
            return { error: err.message };
        } finally {
            this.running = false;
        }
    }

    async getStreamsDue(priority) {
        const interval = config.healthCheck[`${priority}Interval`] || 1800;
        return db('streams')
            .select('streams.*', 'channels.is_featured', 'categories.slug as cat_slug')
            .join('channels', 'streams.channel_id', 'channels.id')
            .leftJoin('categories', 'channels.category_id', 'categories.id')
            .where('streams.is_active', true)
            .where('channels.is_active', true)
            .where(function () {
                this.where('streams.priority', priority)
                    .orWhere(function () {
                        if (priority === 'high') {
                            this.where('channels.is_featured', true)
                                .orWhereIn('categories.slug', ['sports', 'news']);
                        }
                    });
            })
            .where(function () {
                this.whereNull('streams.last_checked')
                    .orWhereRaw(`streams.last_checked < NOW() - INTERVAL '${interval} seconds'`);
            })
            .orderByRaw('streams.last_checked NULLS FIRST')
            .limit(500);
    }

    async checkAndSave(stream) {
        const result = await ValidationService.validate(stream);
        await ValidationService.saveResult(result);
        return result.status === STATUS.ONLINE || result.status === STATUS.SLOW;
    }

    async getStats() {
        return db('streams')
            .select(
                db.raw('COUNT(*) as total'),
                db.raw(`COUNT(*) FILTER (WHERE status = 'online') as online`),
                db.raw(`COUNT(*) FILTER (WHERE status = 'offline') as offline`),
                db.raw(`COUNT(*) FILTER (WHERE status = 'geo_blocked') as geo_blocked`),
                db.raw(`COUNT(*) FILTER (WHERE status = 'slow') as slow`),
                db.raw(`COUNT(*) FILTER (WHERE status = 'invalid') as invalid`),
                db.raw(`COUNT(*) FILTER (WHERE status = 'unknown') as unknown_count`),
                db.raw(`AVG(response_time) FILTER (WHERE status = 'online') as avg_response_time`),
            )
            .first();
    }
}

module.exports = new HealthChecker();
