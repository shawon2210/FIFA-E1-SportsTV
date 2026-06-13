// A1TV v2 - Distributed Tracing & Observability

const { Router } = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');

const traceStore = [];
const MAX_TRACES = 10000;

class TracingService {
    constructor() { this.spans = new Map(); }

    startSpan(name, context = {}) {
        const span = {
            traceId: context.traceId || this.genId(),
            spanId: this.genId(),
            parentSpanId: context.parentSpanId || null,
            name, startTime: Date.now(), endTime: null, duration: null,
            status: 'ok', tags: context.tags || {}, logs: [],
        };
        this.spans.set(span.spanId, span);
        return span;
    }

    endSpan(spanId, status = 'ok', error = null) {
        const span = this.spans.get(spanId);
        if (!span) return;
        span.endTime = Date.now();
        span.duration = span.endTime - span.startTime;
        span.status = status;
        if (error) span.logs.push({ time: Date.now(), event: 'error', message: error.message });
        traceStore.push(span);
        if (traceStore.length > MAX_TRACES) traceStore.shift();
        this.spans.delete(span.spanId);
        return span;
    }

    async trace(name, context, fn) {
        const span = this.startSpan(name, context);
        try { const r = await fn(span); this.endSpan(span.spanId, 'ok'); return r; }
        catch (err) { this.endSpan(span.spanId, 'error', err); throw err; }
    }

    getTraces(filter = {}) {
        let t = [...traceStore];
        if (filter.service) t = t.filter(s => s.tags?.service === filter.service);
        if (filter.status) t = t.filter(s => s.status === filter.status);
        if (filter.minDuration) t = t.filter(s => s.duration >= filter.minDuration);
        return t.sort((a, b) => b.startTime - a.startTime).slice(0, filter.limit || 100);
    }

    getPerformanceSummary() {
        const recent = traceStore.filter(s => s.startTime > Date.now() - 300000);
        const byName = {};
        for (const s of recent) {
            if (!byName[s.name]) byName[s.name] = { count: 0, total: 0, errors: 0, d: [] };
            byName[s.name].count++; byName[s.name].total += s.duration;
            byName[s.name].d.push(s.duration);
            if (s.status === 'error') byName[s.name].errors++;
        }
        const sum = {};
        for (const [n, d] of Object.entries(byName)) {
            d.d.sort((a, b) => a - b);
            sum[n] = { count: d.count, avg: Math.round(d.total / d.count),
                p50: d.d[Math.floor(d.d.length * 0.5)] || 0,
                p95: d.d[Math.floor(d.d.length * 0.95)] || 0,
                errorRate: (d.errors / d.count * 100).toFixed(1) };
        }
        return sum;
    }

    genId() { return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }
}

const tracing = new TracingService();

function traceMiddleware(req, res, next) {
    const span = tracing.startSpan(req.method + ' ' + req.path, { tags: { service: 'api', method: req.method, path: req.path } });
    req.traceSpan = span;
    const start = Date.now();
    res.on('finish', () => { tracing.endSpan(span.spanId, res.statusCode >= 400 ? 'error' : 'ok'); });
    next();
}

const router = Router();
router.get('/traces', authenticate, requireAdmin, (req, res) => {
    res.json({ success: true, data: tracing.getTraces({ service: req.query.service, status: req.query.status, limit: parseInt(req.query.limit) || 100 }) });
});
router.get('/traces/performance', authenticate, requireAdmin, (req, res) => {
    res.json({ success: true, data: tracing.getPerformanceSummary() });
});

module.exports = { router, tracing, traceMiddleware };
