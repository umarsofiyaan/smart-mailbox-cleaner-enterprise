// src/config/database.js
// PostgreSQL connection pool via Supabase
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Execute a parameterized query
 * @param {string} text - SQL query with $1, $2 placeholders
 * @param {Array} params - Query parameters
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('query executed', { text: text.substring(0, 80), duration, rows: result.rowCount });
    }
    return result;
  } catch (err) {
    console.error('Database query error:', { text: text.substring(0, 80), error: err.message });
    throw err;
  }
}

/**
 * Get a client for transaction support
 */
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  // Timeout clients that hold connections too long
  const timeout = setTimeout(() => {
    console.error('A client has been checked out from the pool for more than 30 seconds.');
    client.release();
  }, 30000);

  client.release = () => {
    clearTimeout(timeout);
    release();
  };

  return client;
}

module.exports = { query, getClient, pool };
