const { Pool, types } = require('pg');
const config = require('./config');

// date 컬럼을 시간대 변환 없이 'YYYY-MM-DD' 문자열로 받는다
types.setTypeParser(1082, (value) => value);

const pool = new Pool({ connectionString: config.databaseUrl });
// 유휴 연결 오류가 처리되지 않은 'error' 이벤트로 프로세스를 죽이지 않게 한다
pool.on('error', (err) => console.error('PG pool error:', err));

function query(text, params) {
  return pool.query(text, params);
}

async function tx(fn) {
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // ROLLBACK마저 실패하면 원래 오류를 유지하고 깨진 연결은 풀에서 버린다
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { broken = rollbackErr; }
    throw err;
  } finally {
    client.release(broken);
  }
}

module.exports = { pool, query, tx };
