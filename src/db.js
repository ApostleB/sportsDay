const { Pool, types } = require('pg');
const config = require('./config');

// date 컬럼을 시간대 변환 없이 'YYYY-MM-DD' 문자열로 받는다
types.setTypeParser(1082, (value) => value);

const pool = new Pool({ connectionString: config.databaseUrl });

function query(text, params) {
  return pool.query(text, params);
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
