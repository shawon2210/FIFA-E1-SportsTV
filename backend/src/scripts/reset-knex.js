require('dotenv').config();
const knex = require('knex')(require('../config/knexfile.js'));

(async () => {
  try {
    const hasTable = await knex.schema.hasTable('knex_migrations');
    if (hasTable) {
      const rows = await knex('knex_migrations').select('name');
      console.log('Current tracked migrations:', rows.map(r => r.name));
      await knex('knex_migrations').del();
      console.log('Cleared knex_migrations tracking.');
    } else {
      console.log('No knex_migrations table found.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
})();
