#!/usr/bin/env node
// ============================================================
// A1TV CLI — Manual Stream Scoring
// Usage: node scripts/score.js [--stats]
// ============================================================

const streamScorer = require('../src/services/streamScorer');

async function main() {
    const args = process.argv.slice(2);
    const showStats = args.includes('--stats');

    if (showStats) {
        const stats = await streamScorer.getStats();
        console.log('Stream Scoring Statistics:');
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
    }

    console.log('Recalculating all stream scores...');
    const updated = await streamScorer.recalculateAll();
    console.log(`Updated ${updated} stream scores`);
    process.exit(0);
}

main();
