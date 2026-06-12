#!/usr/bin/env node
// ============================================================
// A1TV CLI — Manual IPTV Sync
// Usage: node scripts/sync.js [--full] [--streams-only]
// ============================================================

const iptvSync = require('../src/services/iptvSync');
const cache = require('../src/services/cache');

async function main() {
    const args = process.argv.slice(2);
    const full = args.includes('--full');
    const streamsOnly = args.includes('--streams-only');

    console.log('A1TV IPTV Sync Tool');
    console.log('====================');
    console.log(`Mode: ${full ? 'full' : streamsOnly ? 'streams-only' : 'default'}`);

    try {
        await cache.connect();
        const result = await iptvSync.syncAll();
        console.log('\nSync result:', JSON.stringify(result, null, 2));
        await cache.quit();
        process.exit(0);
    } catch (err) {
        console.error('Sync failed:', err.message);
        process.exit(1);
    }
}

main();
