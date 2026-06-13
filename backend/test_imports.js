require('dotenv').config();
console.log('dotenv OK');

const modules = [
    ['express', 'express'],
    ['http', 'http'],
    ['path', 'path'],
    ['cors', 'cors'],
    ['helmet', 'helmet'],
    ['compression', 'compression'],
    ['./src/config', 'config'],
    ['./src/services/cache', 'cache'],
    ['./src/services/rateLimiter', 'rateLimiter'],
    ['./src/services/websocket', 'websocket'],
    ['./src/routes/metrics', 'metrics'],
    ['./src/routes/channels', 'channelsRouter'],
    ['./src/routes/index', 'searchRouter'],
    ['./src/routes/proxy', 'proxyRouter'],
    ['./src/routes/admin', 'adminRouter'],
    ['./src/routes/epg', 'epgRouter'],
    ['./src/routes/recommendations', 'recRouter'],
    ['./src/routes/accounts', 'accountsRouter'],
    ['./src/routes/stream', 'streamRouter'],
    ['./src/routes/epg-intel', 'epgIntelRouter'],
    ['./src/routes/organizations', 'orgRouter'],
    ['./src/routes/gateway', 'gatewayRouter'],
    ['./src/routes/streamIntel', 'streamIntelRouter'],
    ['./src/routes/recommendationsV2', 'recV2Router'],
    ['./src/routes/sports', 'sportsRouter'],
    ['./src/routes/billing', 'billingRouter'],
    ['./src/routes/whiteLabel', 'whiteLabelRouter'],
    ['./src/routes/enterprise', 'enterpriseRouter'],
    ['./src/routes/ai', 'aiRouter'],
    ['./src/services/tracing', 'tracing'],
    ['./src/services/gateway/healthMonitor', 'healthMonitor'],
    ['./src/services/otel', 'otel'],
    ['./src/services/security', 'security'],
];

for (const [mod, name] of modules) {
    try {
        const start = Date.now();
        require(mod);
        const elapsed = Date.now() - start;
        console.log(`OK: ${name} (${elapsed}ms)`);
    } catch(e) {
        console.log(`FAIL: ${name} - ${e.message}`);
    }
}

console.log('ALL DONE');
process.exit(0);
