const path = require('path');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

module.exports = {
    client: 'pg',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        database: process.env.DB_NAME || 'a1tv',
        user: process.env.DB_USER || 'a1tv',
        password: process.env.DB_PASSWORD || 'a1tv_secret',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: {
        min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
        max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    },
    migrations: {
        directory: path.join(projectRoot, 'database', 'migrations'),
        tableName: 'knex_migrations',
    },
    seeds: {
        directory: path.join(projectRoot, 'database', 'seeds'),
    },
};
