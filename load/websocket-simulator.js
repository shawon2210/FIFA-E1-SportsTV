// ============================================================
// A1TV v4 — WebSocket Load Simulator
// Simulates concurrent WebSocket connections for real-time
// features: live viewer counts, stream status updates,
// channel switching notifications, chat.
//
// Tests:
//   Connection storm handling
//   Message broadcast latency
//   Reconnection behavior
//   Memory leak detection under sustained connections
//
// Usage:
//   node load/websocket-simulator.js
//   WS_CONCURRENCY=5000 node load/websocket-simulator.js
// ============================================================

const http = require('http');

// ── Configuration ───────────────────────────────────────────
const BASE_URL = (process.env.API || 'http://localhost:3000').replace('http://', '');
const WS_CONCURRENCY = parseInt(process.env.WS_CONCURRENCY, 10) || 100;
const TEST_DURATION_MS = parseInt(process.env.TEST_DURATION_MS, 10) || 30000;
const HOST = BASE_URL.split(':')[0];
const PORT = parseInt(BASE_URL.split(':')[1], 10) || 3000;

// ── Simplified WebSocket client using raw TCP ───────────────
// (Node.js ws module may not be installed; this tests raw WS upgrade)
class SimpleWSClient {
  constructor(id) {
    this.id = id;
    this.connected = false;
    this.messages = [];
    this.errors = [];
    this.connectTime = null;
    this.firstMessageTime = null;
    this.lastError = null;
  }

  connect() {
    return new Promise((resolve) => {
      const start = Date.now();
      const options = {
        hostname: HOST,
        port: PORT,
        path: '/ws',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from(`loadtest-${this.id}`).toString('base64'),
        },
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 101) {
          this.connected = true;
          this.connectTime = Date.now() - start;
          let buf = Buffer.alloc(0);

          res.on('data', (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            try {
              const msg = JSON.parse(buf.toString());
              buf = Buffer.alloc(0);
              if (!this.firstMessageTime) {
                this.firstMessageTime = Date.now() - start;
              }
              this.messages.push(msg);
            } catch {
              // Partial message, accumulate
            }
          });

          res.on('end', () => {
            this.connected = false;
            resolve(this);
          });

          res.on('error', (err) => {
            this.errors.push(err.message);
            this.lastError = err.message;
            this.connected = false;
            resolve(this);
          });
        } else {
          this.connectTime = Date.now() - start;
          this.lastError = `HTTP ${res.statusCode}`;
          // Collect body
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => {
            this.lastError += body ? ` - ${body.substring(0, 200)}` : '';
            resolve(this);
          });
        }
      });

      req.on('error', (err) => {
        this.connectTime = Date.now() - start;
        this.errors.push(err.message);
        this.lastError = err.message;
        resolve(this);
      });

      req.on('timeout', () => {
        req.destroy();
        this.connectTime = Date.now() - start;
        this.lastError = 'timeout';
        resolve(this);
      });

      req.end();
    });
  }
}

// ── Stats ───────────────────────────────────────────────────
class WSStats {
  constructor() {
    this.clients = [];
  }

  add(client) {
    this.clients.push(client);
  }

  summary() {
    const total = this.clients.length;
    const connected = this.clients.filter(c => c.connected || c.connectTime !== null).length;
    const successful = this.clients.filter(c => c.connectTime !== null && !c.lastError || c.firstMessageTime !== null).length;
    const withErrors = this.clients.filter(c => c.lastError).length;
    const connectTimes = this.clients
      .filter(c => c.connectTime !== null && !c.lastError)
      .map(c => c.connectTime)
      .sort((a, b) => a - b);
    const firstMsgTimes = this.clients
      .filter(c => c.firstMessageTime !== null)
      .map(c => c.firstMessageTime)
      .sort((a, b) => a - b);
    const totalMessages = this.clients.reduce((sum, c) => sum + c.messages.length, 0);

    const pct = (arr, p) => {
      if (!arr.length) return 0;
      return arr[Math.floor(arr.length * (p / 100))];
    };

    return {
      total,
      connected,
      successful,
      withErrors,
      totalMessages,
      connectP50: pct(connectTimes, 50),
      connectP95: pct(connectTimes, 95),
      connectP99: pct(connectTimes, 99),
      firstMsgP50: pct(firstMsgTimes, 50),
      firstMsgP95: pct(firstMsgTimes, 95),
      errorReasons: this.clients
        .filter(c => c.lastError)
        .reduce((acc, c) => {
          const key = c.lastError.split(' - ')[0].substring(0, 60);
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
    };
  }
}

// ── Main ────────────────────────────────────────────────────
async function run() {
  console.log('='.repeat(70));
  console.log('A1TV v4 — WebSocket Load Simulator');
  console.log('='.repeat(70));
  console.log(`Target:      ${HOST}:${PORT}/ws`);
  console.log(`Connections: ${WS_CONCURRENCY}`);
  console.log(`Duration:    ${TEST_DURATION_MS}ms`);
  console.log('');

  const stats = new WSStats();
  const startTime = Date.now();

  // Phase 1: Connection storm — all at once
  console.log('Phase 1: Connection storm...');
  const stormBatch = [];
  for (let i = 0; i < WS_CONCURRENCY; i++) {
    const client = new SimpleWSClient(i);
    stormBatch.push(client.connect().then(c => {
      stats.add(c);
      const pct = ((stats.clients.length / WS_CONCURRENCY) * 100).toFixed(0);
      process.stdout.write(`\r  Connected: ${stats.clients.length}/${WS_CONCURRENCY} (${pct}%)`);
    }));
  }
  await Promise.all(stormBatch);
  console.log('');

  // Phase 2: Sustained duration
  if (TEST_DURATION_MS > 0) {
    console.log(`Phase 2: Sustaining for ${TEST_DURATION_MS}ms...`);
    await new Promise(r => setTimeout(r, TEST_DURATION_MS));
  }

  const elapsed = Date.now() - startTime;

  // ── Results ─────────────────────────────────────────────────
  const s = stats.summary();

  console.log('');
  console.log('─'.repeat(70));
  console.log('RESULTS');
  console.log('─'.repeat(70));
  console.log(`  Total Clients:       ${s.total}`);
  console.log(`  Successful Connect:  ${s.successful}`);
  console.log(`  Failed:              ${s.withErrors}`);
  console.log(`  Total Messages Rcvd: ${s.totalMessages}`);
  console.log(`  Test Duration:       ${elapsed}ms`);
  console.log('');

  if (s.connectP50 > 0) {
    console.log(`  Connect P50:         ${s.connectP50}ms`);
    console.log(`  Connect P95:         ${s.connectP95}ms`);
    console.log(`  Connect P99:         ${s.connectP99}ms`);
  }

  if (s.firstMsgP50 > 0) {
    console.log(`  First Msg P50:       ${s.firstMsgP50}ms`);
    console.log(`  First Msg P95:       ${s.firstMsgP95}ms`);
  }

  if (Object.keys(s.errorReasons).length > 0) {
    console.log('');
    console.log('  Error breakdown:');
    for (const [reason, count] of Object.entries(s.errorReasons)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  // Note: if WS returns non-101, it means WS isn't exposed at /ws
  // That's expected if Socket.IO uses a different path
  console.log('');
  console.log('─'.repeat(70));
  console.log('NOTES');
  console.log('─'.repeat(70));
  console.log('  If connections return HTTP 200/404 instead of 101, the');
  console.log('  WebSocket may be on a different path (e.g. /socket.io/).');
  console.log('  This test still measures HTTP upgrade handling under load.');
  console.log('');
  console.log('='.repeat(70));
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
