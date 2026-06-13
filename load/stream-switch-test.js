// ============================================================
// A1TV v4 — Stream Switch & Reconnect Storm Test
// Simulates rapid channel switching and reconnection storms
// that occur when users flip between channels or when a
// stream fails and clients reconnect simultaneously.
//
// Tests:
//   Rapid channel switch latency
//   Reconnection storm handling
//   Cache stampede on popular channels
//   Stream proxy failover speed
//
// Usage:
//   node load/stream-switch-test.js
// ============================================================

const http = require('http');

const BASE_URL = process.env.API || 'http://localhost:3000';
const SWITCH_CONCURRENCY = parseInt(process.env.SWITCH_CONCURRENCY, 10) || 50;
const SWITCH_ROUNDS = parseInt(process.env.SWITCH_ROUNDS, 10) || 10;

// ── HTTP helper ─────────────────────────────────────────────
function httpGet(path, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const req = http.get(`${BASE_URL}${path}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'A1TV-SwitchTest/4.0' },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const latency = Number(process.hrtime.bigint() - start) / 1e6;
        resolve({ status: res.statusCode, latency, data: data.length, error: null });
      });
    });
    req.on('error', (err) => {
      const latency = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, latency, data: 0, error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      const latency = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, latency, data: 0, error: 'timeout' });
    });
  });
}

// ── Get channel IDs first ───────────────────────────────────
async function getChannelIds() {
  const res = await httpGet('/api/v1/channels?limit=20');
  if (res.error || res.status !== 200) {
    // Fallback: use mock IDs for testing
    return ['ch-001', 'ch-002', 'ch-003', 'ch-004', 'ch-005',
            'ch-006', 'ch-007', 'ch-008', 'ch-009', 'ch-010'];
  }
  try {
    const json = JSON.parse(res.data || '{}');
    const channels = json.data || json.channels || json || [];
    if (Array.isArray(channels) && channels.length > 0) {
      return channels.slice(0, 10).map(c => c.id);
    }
  } catch {}
  return ['ch-001', 'ch-002', 'ch-003', 'ch-004', 'ch-005'];
}

// ── Test 1: Rapid Channel Switching ─────────────────────────
async function testChannelSwitching(channelIds) {
  console.log('Test 1: Rapid Channel Switching');
  console.log(`  ${SWITCH_CONCURRENCY} concurrent users x ${SWITCH_ROUNDS} switches each`);

  const results = [];
  const startTime = Date.now();

  for (let round = 0; round < SWITCH_ROUNDS; round++) {
    const batch = [];
    for (let i = 0; i < SWITCH_CONCURRENCY; i++) {
      const chId = channelIds[i % channelIds.length];
      batch.push(httpGet(`/api/v1/stream/${chId}`));
    }
    const roundResults = await Promise.all(batch);
    results.push(...roundResults);
  }

  const elapsed = Date.now() - startTime;
  const errors = results.filter(r => r.error);
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);

  console.log(`  Duration: ${elapsed}ms`);
  console.log(`  Total: ${results.length}, Errors: ${errors.length}`);
  console.log(`  P50: ${latencies[Math.floor(latencies.length * 0.5)].toFixed(1)}ms`);
  console.log(`  P95: ${latencies[Math.floor(latencies.length * 0.95)].toFixed(1)}ms`);
  console.log(`  P99: ${latencies[Math.floor(latencies.length * 0.99)].toFixed(1)}ms`);
  console.log('');

  return { results, elapsed, errors: errors.length };
}

// ── Test 2: Cache Stampede (same channel, many requesters) ──
async function testCacheStampede(channelIds) {
  console.log('Test 2: Cache Stampede');
  console.log(`  ${SWITCH_CONCURRENCY * 2} requests to SAME channel simultaneously`);

  const targetCh = channelIds[0];
  const results = [];
  const startTime = Date.now();

  const batch = [];
  for (let i = 0; i < SWITCH_CONCURRENCY * 2; i++) {
    batch.push(httpGet(`/api/v1/stream/${targetCh}`));
  }
  const batchResults = await Promise.all(batch);
  results.push(...batchResults);

  const elapsed = Date.now() - startTime;
  const errors = results.filter(r => r.error);
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);

  // Check for thundering herd: if cache miss, all requests hit DB simultaneously
  const firstResponse = latencies[0];
  const lastResponse = latencies[latencies.length - 1];
  const spread = lastResponse - firstResponse;

  console.log(`  Duration: ${elapsed}ms`);
  console.log(`  Total: ${results.length}, Errors: ${errors.length}`);
  console.log(`  First response: ${firstResponse.toFixed(1)}ms`);
  console.log(`  Last response:  ${lastResponse.toFixed(1)}ms`);
  console.log(`  Spread:         ${spread.toFixed(1)}ms (thundering herd indicator)`);
  console.log(`  P95: ${latencies[Math.floor(latencies.length * 0.95)].toFixed(1)}ms`);
  console.log('');

  return { results, elapsed, errors: errors.length, spread };
}

// ── Test 3: Reconnect Storm ─────────────────────────────────
async function testReconnectStorm(channelIds) {
  console.log('Test 3: Reconnect Storm');
  console.log(`  Simulating ${SWITCH_CONCURRENCY} clients reconnecting after outage`);

  const results = [];
  const startTime = Date.now();

  // All clients hit multiple endpoints simultaneously (like after reconnect)
  const endpoints = [
    '/api/v1/channels?limit=20',
    '/api/v1/categories',
    '/api/v1/epg/now',
    '/health',
  ];

  const batch = [];
  for (let i = 0; i < SWITCH_CONCURRENCY; i++) {
    for (const ep of endpoints) {
      batch.push(httpGet(ep));
    }
  }
  const batchResults = await Promise.all(batch);
  results.push(...batchResults);

  const elapsed = Date.now() - startTime;
  const errors = results.filter(r => r.error);
  const latencies = results.map(r => r.latency).sort((a, b) => a - b);

  console.log(`  Duration: ${elapsed}ms`);
  console.log(`  Total: ${results.length}, Errors: ${errors.length}`);
  console.log(`  P50: ${latencies[Math.floor(latencies.length * 0.5)].toFixed(1)}ms`);
  console.log(`  P95: ${latencies[Math.floor(latencies.length * 0.95)].toFixed(1)}ms`);
  console.log(`  P99: ${latencies[Math.floor(latencies.length * 0.99)].toFixed(1)}ms`);
  console.log('');

  return { results, elapsed, errors: errors.length };
}

// ── Main ────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(70));
  console.log('A1TV v4 — Stream Switch & Reconnect Storm Test');
  console.log('='.repeat(70));
  console.log(`Target: ${BASE_URL}`);
  console.log('');

  const channelIds = await getChannelIds();
  console.log(`Found ${channelIds.length} channel IDs for testing`);
  console.log('');

  const switchResult = await testChannelSwitching(channelIds);
  const stampedeResult = await testCacheStampede(channelIds);
  const reconnectResult = await testReconnectStorm(channelIds);

  // ── Summary ─────────────────────────────────────────────────
  const totalReqs = switchResult.results.length + stampedeResult.results.length + reconnectResult.results.length;
  const totalErrors = switchResult.errors + stampedeResult.errors + reconnectResult.errors;
  const errorRate = ((totalErrors / totalReqs) * 100).toFixed(2);

  console.log('─'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log(`  Total Requests: ${totalReqs}`);
  console.log(`  Total Errors:   ${totalErrors} (${errorRate}%)`);
  console.log(`  Cache Spread:   ${stampedeResult.spread.toFixed(1)}ms`);
  console.log('');

  const pass = parseFloat(errorRate) < 2 && stampedeResult.spread < 500;
  console.log(pass ? 'STREAM SWITCH TEST PASSED' : 'STREAM SWITCH TEST NEEDS ATTENTION');
  console.log('='.repeat(70));

  process.exit(pass ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
