// ============================================================
// A1TV v4 — OpenTelemetry Instrumentation
// Auto-instruments API, WebSocket, Redis, Postgres, Stream Proxy.
//
// SLO Dashboard Metrics:
//   - Availability: 99.95%
//   - Stream Start Time: < 2s
//   - Buffer Ratio: < 0.5%
//   - Failover Rate: < 0.1%
//   - Error Budget: 0.05% per month
// ============================================================

const config = require('../config');

// ── SLO Definitions ─────────────────────────────────────────
const SLOS = {
  availability: {
    target: 0.9995,           // 99.95%
    window: '30d',
    description: 'Percentage of successful requests',
  },
  apiLatency: {
    p95: 150,                 // ms
    p99: 400,                 // ms
    target: 0.99,             // 99% of requests under threshold
    description: 'API response latency',
  },
  streamStartTime: {
    target: 2000,             // ms
    percentile: 0.90,         // 90% of streams start under 2s
    description: 'Time from play request to first frame',
  },
  bufferRatio: {
    target: 0.005,            // 0.5%
    description: 'Percentage of playback time spent buffering',
  },
  failoverRate: {
    target: 0.001,            // 0.1%
    description: 'Percentage of streams requiring failover',
  },
  errorBudget: {
    target: 0.0005,           // 0.05% error budget per month
    window: '30d',
    description: 'Allowed error rate before SLO breach',
  },
};

// ── SLO Tracker ─────────────────────────────────────────────
class SLOTracker {
  constructor() {
    this.metrics = {};
    for (const slo of Object.keys(SLOS)) {
      this.metrics[slo] = {
        total: 0,
        violations: 0,
        lastViolation: null,
      };
    }
  }

  record(sloName, isViolation = false) {
    if (!this.metrics[sloName]) return;
    this.metrics[sloName].total++;
    if (isViolation) {
      this.metrics[sloName].violations++;
      this.metrics[sloName].lastViolation = new Date();
    }
  }

  recordLatency(sloName, latencyMs) {
    const slo = SLOS[sloName];
    if (!slo) return;
    const threshold = slo.p95 || slo.target;
    this.record(sloName, latencyMs > threshold);
  }

  getReport() {
    const report = {
      timestamp: new Date().toISOString(),
      slos: {},
    };

    for (const [name, slo] of Object.entries(SLOS)) {
      const metric = this.metrics[name];
      const compliance = metric.total > 0
        ? 1 - (metric.violations / metric.total)
        : 1;

      report.slos[name] = {
        ...slo,
        compliance: parseFloat(compliance.toFixed(6)),
        total: metric.total,
        violations: metric.violations,
        status: compliance >= slo.target ? 'passing' : 'breached',
        lastViolation: metric.lastViolation,
      };
    }

    return report;
  }
}

const sloTracker = new SLOTracker();

// ── OpenTelemetry Setup ─────────────────────────────────────
// This module provides the instrumentation setup.
// In production, use the @opentelemetry/auto-instrumentations-node package.
function setupTelemetry() {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'a1tv-api';
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!otelEndpoint) {
    console.log('[OTel] OpenTelemetry disabled (OTEL_EXPORTER_OTLP_ENDPOINT not set)');
    return null;
  }

  try {
    // Dynamic import to avoid hard dependency
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
    const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

    const sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: otelEndpoint }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otelEndpoint }),
        exportIntervalMillis: 15000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
          '@opentelemetry/instrumentation-ioredis': { enabled: true },
          '@opentelemetry/instrumentation-socket.io': { enabled: true },
        }),
      ],
    });

    sdk.start();
    console.log(`[OTel] OpenTelemetry initialized for ${serviceName}`);

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk.shutdown().then(() => process.exit(0));
    });

    return sdk;
  } catch (err) {
    console.warn('[OTel] OpenTelemetry setup failed:', err.message);
    console.warn('[OTel] Install OTel packages: npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/exporter-metrics-otlp-grpc');
    return null;
  }
}

// ── Custom Metrics ──────────────────────────────────────────
const promClient = require('prom-client');

// SLO-specific metrics
const sloAvailabilityGauge = new promClient.Gauge({
  name: 'a1tv_slo_availability_ratio',
  help: 'Current availability ratio (target: 0.9995)',
});

const sloLatencyHistogram = new promClient.Histogram({
  name: 'a1tv_slo_api_latency_ms',
  help: 'API latency distribution for SLO tracking',
  buckets: [10, 25, 50, 100, 150, 250, 400, 1000, 2500],
});

const sloStreamStartHistogram = new promClient.Histogram({
  name: 'a1tv_slo_stream_start_ms',
  help: 'Stream start time distribution',
  buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
});

const sloBufferRatio = new promClient.Gauge({
  name: 'a1tv_slo_buffer_ratio',
  help: 'Current buffer ratio (target: < 0.005)',
});

const sloErrorBudgetGauge = new promClient.Gauge({
  name: 'a1tv_slo_error_budget_remaining',
  help: 'Remaining error budget (1.0 = full, 0.0 = exhausted)',
});

const failoverCounter = new promClient.Counter({
  name: 'a1tv_stream_failovers_total',
  help: 'Total number of stream failovers',
});

// Update SLO gauges periodically
function updateSLOMetrics() {
  const report = sloTracker.getReport();

  if (report.slos.availability) {
    sloAvailabilityGauge.set(report.slos.availability.compliance);
  }
  if (report.slos.bufferRatio) {
    sloBufferRatio.set(report.slos.bufferRatio.violations / Math.max(report.slos.bufferRatio.total, 1));
  }
  if (report.slos.errorBudget) {
    const remaining = Math.max(0, 1 - (report.slos.errorBudget.violations / Math.max(report.slos.errorBudget.total, 1)) / SLOS.errorBudget.target);
    sloErrorBudgetGauge.set(remaining);
  }
}

// Update every 15 seconds
setInterval(updateSLOMetrics, 15000);

module.exports = {
  setupTelemetry,
  SLOTracker,
  sloTracker,
  SLOS,
  metrics: {
    sloAvailabilityGauge,
    sloLatencyHistogram,
    sloStreamStartHistogram,
    sloBufferRatio,
    sloErrorBudgetGauge,
    failoverCounter,
  },
};
