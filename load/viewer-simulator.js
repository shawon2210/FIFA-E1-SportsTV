// ============================================================
// A1TV v4 — Viewer Load Simulator
// Simulates concurrent viewers hitting stream endpoints,
// channel listings, search, and EPG data.
//
// Usage:
//   node load/viewer-simulator.js
//   CONCURRENCY=10000 REQUESTS=100000 node load/viewer-simulator.js
//
// Targets:
//   10,000 concurrent viewers  —  P95 < 150ms
//   50,000 concurrent viewers  —  P95 < 150ms
//   100,000 concurrent viewers —  P99 < 400ms
// ============================================================

const http = require('http');
const { URL } = require('url');

// ── Configuration ───────────────────────────────────────────
const BASE_URL = process.env.API || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 100;
const TOTAL_REQUESTS = parseInt(process.env.REQUESTS, 10) || 1000;
const RAMP_UP_MS = parseInt(process.env.RAMP_UP_MS, 10) || 5000;
const TEST_DURATION_MS = parseInt(process.env.TEST_DURATION_MS, 10) || 0; // 0 = run all requests then stop

const base = new URL(BASE_URL);

// ── Realistic endpoint mix (weighted) ──────────────────────
const ENDPOINTS = [
  { path: '/api/v1/channels?limit=50',              weight: 30, name: 'channels-list' },
  { path: '/api/v1/channels?limit=20&page=1',       weight: 20, name: 'channels-page' },
  { path: '/api/v1/categories',                     weight: 10, name: 'categories' },
  { path: '/api/v1/search?q=sports',                weight: 10, name: 'search' },
  { path: '/api/v1/channels/featured',              weight: 8,  name: 'featured' },
  { path: '/api/v1/epg/now',                        weight: 7,  name: 'epg-now' },
  { path: '/api/v1/recommendations/trending',       weight: 5,  name: 'trending' },
  { path: '/api/v1/countries',                      weight: 5,  name: 'countries' },
  { path: '/health',                                weight: 5,  name: 'health' },
];

// Build weighted array for random selection
let weightedEndpoints = [];
for (const ep of ENDPOINTS) {
  for (let i = 0; i < ep.weight; i++) {
    weightedEndpoints.push(ep);
  }
}

function randomEndpoint() {
  return weightedEndpoints[Math.floor(Math.random() * weightedEndpoints.length)];
}

// ── HTTP request with timing ────────────────────────────────
function makeRequest(endpoint) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const url = `${BASE_URL}${endpoint.path}`;

    const req = http.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'A1TV-LoadTest/4.0',
      },
      timeout: 10000,
    }, (res) => {
      let size = 0;
      res.on('data', (chunk) => { size += chunk.length; });
      res.on('end', () => {
        const latency = Number(process.hrtime.bigint() - start) / 1e6; // ms
        resolve({
          endpoint: endpoint.name,
          status: res.statusCode,
          latency,
          size,
          error: null,
        });
      });
    });

    req.on('error', (err) => {
      const latency = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({
        endpoint: endpoint.name,
        status: 0,
        latency,
        size: 0,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({
        endpoint: endpoint.name,
        status: 0,
        latency,
        size: 0,
        error: 'timeout',
      });
    });
  });
}

// ── Stats collector ─────────────────────────────────────────
class Stats {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  add(result) {
    this.results.push(result);
  }

  percentile(p) {
    const sorted = this.results
      .filter(r => !r.error)
      .map(r => r.latency)
      .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const idx = Math.floor(sorted.length * (p / 100));
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  summary() {
    const elapsed = this.endTime - this.startTime;
    const total = this.results.length;
    const errors = this.results.filter(r => r.error).length;
    const success = total - errors;
    const rps = Math.round(success / (elapsed / 1000));
    const byEndpoint = {};

    for (const r of this.results) {
      if (!byEndpoint[r.endpoint]) {
        byEndpoint[r.endpoint] = { count: 0, errors: 0, latencies: [] };
      }
      byEndpoint[r.endpoint].count++;
      if (r.error) byEndpoint[r.endpoint].errors++;
      else byEndpoint[r.endpoint].latencies.push(r.latency);
    }

    return {
      total,
      success,
      errors,
      errorRate: ((errors / total) * 100).toFixed(2) + '%',
      duration: elapsed + 'ms',
      rps,
      p50: this.percentile(50).toFixed(1),
      p90: this.percentile(90).toFixed(1),
      p95: this.percentile(95).toFixed(1),
      p99: this.percentile(99).toFixed(1),
      byEndpoint,
    };
  }
}

// ── Main runner ─────────────────────────────────────────────
async function run() {
  console.log('='.repeat(70));
  console.log('A1TV v4 — Viewer Load Simulator');
  console.log('='.repeat(70));
  console.log(`Target:      ${BASE_URL}`);
  console.log(`Requests:    ${TOTAL_REQUESTS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Ramp-up:     ${RAMP_UP_MS}ms`);
  console.log('');

  const stats = new Stats();
  stats.startTime = Date.now();

  let completed = 0;
  const total = TOTAL_REQUESTS;

  // Process in batches with ramp-up
  const batches = Math.ceil(total / CONCURRENCY);
  const rampDelayPerBatch = batches > 1 ? RAMP_UP_MS / batches : 0;

  const batchPromises = [];

  for (let b = 0; b < batches; b++) {
    const batchSize = Math.min(CONCURRENCY, total - b * CONCURRENCY);
    const batch = [];

    for (let i = 0; i < batchSize; i++) {
      const ep = randomEndpoint();
      batch.push(makeRequest(ep));
    }

    // Ramp-up delay between batches
    if (b > 0 && rampDelayPerBatch > 0) {
      await new Promise(r => setTimeout(r, rampDelayPerBatch));
    }

    const results = await Promise.all(batch);
    for (const r of results) {
      stats.add(r);
      completed++;
    }

    // Progress
    if (batches <= 20 || b % Math.max(1, Math.floor(batches / 20)) === 0) {
      const pct = ((completed / total) * 100).toFixed(1);
      const currentP95 = stats.percentile(95).toFixed(1);
      process.stdout.write(`\r  Progress: ${completed}/${total} (${pct}%)  P95: ${currentP95}ms   `);
    }
  }

  stats.endTime = Date.now();
  process.stdout.write('\n\n');

  // ── Results ─────────────────────────────────────────────────
  const s = stats.summary();

  console.log('─'.repeat(70));
  console.log('RESULTS');
  console.log('─'.repeat(70));
  console.log(`  Total Requests:  ${s.total}`);
  console.log(`  Successful:      ${s.success}`);
  console.log(`  Errors:          ${s.errors} (${s.errorRate})`);
  console.log(`  Duration:        ${s.duration}`);
  console.log(`  Throughput:      ${s.rps} req/s`);
  console.log('');
  console.log(`  P50 Latency:     ${s.p50}ms`);
  console.log(`  P90 Latency:     ${s.p90}ms`);
  console.log(`  P95 Latency:     ${s.p95}ms`);
  console.log(`  P99 Latency:     ${s.p99}ms`);
  console.log('');

  console.log('─'.repeat(70));
  console.log('BY ENDPOINT');
  console.log('─'.repeat(70));
  for (const [name, data] of Object.entries(s.byEndpoint)) {
    const sorted = data.latencies.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const errPct = ((data.errors / data.count) * 100).toFixed(1);
    console.log(`  ${name.padEnd(20)}  n=${String(data.count).padStart(6)}  err=${errPct.padStart(5)}%  P50=${p50.toFixed(1).padStart(7)}ms  P95=${p95.toFixed(1).padStart(7)}ms`);
  }
  console.log('');

  // ── Pass/Fail ──────────────────────────────────────────────
  const p95Ms = parseFloat(s.p95);
  const p99Ms = parseFloat(s.p99);
  const passP95 = p95Ms < 150;
  const passP99 = p99Ms < 400;
  const passErrors = parseFloat(s.errorRate) < 1;

  console.log('─'.repeat(70));
  console.log('PASS / FAIL');
  console.log('─'.repeat(70));
  console.log(`  P95 < 150ms:    ${passP95 ? 'PASS' : 'FAIL'}  (${s.p95}ms)`);
  console.log(`  P99 < 400ms:    ${passP99 ? 'PASS' : 'FAIL'}  (${s.p99}ms)`);
  console.log(`  Error rate <1%: ${passErrors ? 'PASS' : 'FAIL'}  (${s.errorRate})`);

  const allPass = passP95 && passP99 && passErrors;
  console.log('');
  console.log(allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
  console.log('='.repeat(70));

  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
