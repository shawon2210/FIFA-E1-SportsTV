// ============================================================
// A1TV Backend — Database Connection (PostgreSQL via Knex)
// ============================================================

const knex = require('knex');
const config = require('../config');

const db = knex({
    client: 'pg',
    connection: {
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
        password: config.database.password,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    },
    pool: {
        min: config.database.poolMin,
        max: config.database.poolMax,
    },
    migrations: {
        directory: '../../database/migrations',
        tableName: 'knex_migrations',
    },
});

// Health check — don't crash if DB is down (graceful degradation)
db.raw('SELECT 1')
    .then(() => console.log('✓ PostgreSQL connected'))
    .catch(err => {
        console.error('✗ PostgreSQL connection failed:', err.message);
        console.warn('  Server will start without database. Retry on first request.');
    });

module.exports = db;
