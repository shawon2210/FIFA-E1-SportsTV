// ============================================================
// A1TV v4 — Stream Gateway Health Monitor
// Periodically checks origin health, updates health status,
// triggers failover when origins go down.
// ============================================================

const http = require('http');
const https = require('https');
const { originHealth, REGIONS } = require('./index');

const CHECK_INTERVAL_MS = parseInt(process.env.GATEWAY_HEALTH_INTERVAL_MS, 10) || 10000;
const CHECK_TIMEOUT_MS = parseInt(process.env.GATEWAY_HEALTH_TIMEOUT_MS, 10) || 5000;
const FAILURE_THRESHOLD = 3; // Mark unhealthy after 3 consecutive failures
const RECOVERY_THRESHOLD = 2; // Mark healthy after 2 consecutive successes

// Track consecutive failures per origin
const failureCounts = {};
const successCounts = {};

function originKey(regionId, host) {
  return `${regionId}:${host}`;
}

async function checkOrigin(regionId, origin) {
  return new Promise((resolve) => {
    const start = Date.now();
    const mod = origin.host.startsWith('https') ? https : http;

    // Try to hit the health endpoint of the origin
    const req = mod.get(`http://${origin.host}/health`, {
      timeout: CHECK_TIMEOUT_MS,
      rejectUnauthorized: false,
    }, (res) => {
      const latency = Date.now() - start;
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const healthy = res.statusCode === 200;
        resolve({ healthy, latency });
      });
    });

    req.on('error', () => {
      resolve({ healthy: false, latency: CHECK_TIMEOUT_MS });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false, latency: CHECK_TIMEOUT_MS });
    });
  });
}

async function runHealthCheck() {
  const results = {};

  for (const [regionId, region] of Object.entries(REGIONS)) {
    results[regionId] = {};

    for (const origin of region.origins) {
      const key = originKey(regionId, origin.host);
      const result = await checkOrigin(regionId, origin);

      if (result.healthy) {
        successCounts[key] = (successCounts[key] || 0) + 1;
        failureCounts[key] = 0;

        if (successCounts[key] >= RECOVERY_THRESHOLD) {
          originHealth.markHealthy(regionId, origin.host, result.latency);
        }
      } else {
        failureCounts[key] = (failureCounts[key] || 0) + 1;
        successCounts[key] = 0;

        if (failureCounts[key] >= FAILURE_THRESHOLD) {
          originHealth.markUnhealthy(regionId, origin.host);
        }
      }

      results[regionId][origin.host] = {
        healthy: result.healthy,
        latency: result.latency,
        consecutiveFailures: failureCounts[key] || 0,
      };
    }
  }

  return results;
}

let healthCheckInterval = null;

function startHealthMonitor() {
  if (healthCheckInterval) return;

  console.log(`[Gateway] Health monitor started (interval: ${CHECK_INTERVAL_MS}ms)`);

  // Run immediately
  runHealthCheck().catch(err => {
    console.error('[Gateway] Initial health check failed:', err.message);
  });

  healthCheckInterval = setInterval(() => {
    runHealthCheck().catch(err => {
      console.error('[Gateway] Health check error:', err.message);
    });
  }, CHECK_INTERVAL_MS);
}

function stopHealthMonitor() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log('[Gateway] Health monitor stopped');
  }
}

module.exports = {
  startHealthMonitor,
  stopHealthMonitor,
  runHealthCheck,
  CHECK_INTERVAL_MS,
};
