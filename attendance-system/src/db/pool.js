const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});
pool.on('error', (e) => console.error('Postgres pool error:', e.message));

module.exports = { query: (text, params) => pool.query(text, params), pool };
