#!/usr/bin/env node
// ============================================================
// A1TV CLI — Manual Health Check
// Usage: node scripts/healthCheck.js [--stats]
// ============================================================

const healthChecker = require('../src/services/healthChecker');

async function main() {
    const args = process.argv.slice(2);
    const showStats = args.includes('--stats');

    if (showStats) {
        const stats = await healthChecker.getHealthStats();
        console.log('Stream Health Statistics:');
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
    }

    console.log('Running health check cycle...');
    const result = await healthChecker.runCycle();
    console.log('Result:', JSON.stringify(result, null, 2));
    process.exit(0);
}

main();
