// ============================================================
// A1TV Backend — Database Connection (PostgreSQL via Knex)
// Lazy initialization to avoid native module conflicts with socket.io
// ============================================================

const knexLib = require('knex');
const config = require('../config');

let _db = null;

function getDb() {
    if (!_db) {
        _db = knexLib({
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
        _db.raw('SELECT 1')
            .then(() => console.log('✓ PostgreSQL connected'))
            .catch(err => {
                console.error('✗ PostgreSQL connection failed:', err.message);
                console.warn('  Server will start without database. Retry on first request.');
            });
    }
    return _db;
}

// Proxy that lazily initializes knex on first use
const db = new Proxy(function() {}, {
    get(target, prop) {
        const realDb = getDb();
        const val = realDb[prop];
        if (typeof val === 'function') {
            return val.bind(realDb);
        }
        return val;
    },
    set(target, prop, value) {
        const realDb = getDb();
        realDb[prop] = value;
        return true;
    },
    apply(target, thisArg, args) {
        const realDb = getDb();
        return realDb.apply(realDb, args);
    },
});

module.exports = db;
