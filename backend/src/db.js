require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in backend/.env');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
pool.on('error', () => console.error('Unexpected PostgreSQL connection error'));
module.exports = pool;
