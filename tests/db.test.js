require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

test('DB 풀에 error 리스너가 있어 유휴 연결 오류로 프로세스가 죽지 않는다', () => {
  assert.ok(db.pool.listenerCount('error') >= 1);
});

test('tx는 ROLLBACK이 실패해도 원래 오류를 던지고 연결을 폐기한다', async () => {
  const original = db.pool.connect;
  let releasedWith;
  db.pool.connect = async () => ({
    query: async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
    },
    release: (arg) => { releasedWith = arg; },
  });
  try {
    await assert.rejects(db.tx(async () => { throw new Error('original'); }), /original/);
    assert.ok(releasedWith, '깨진 연결은 release(err)로 폐기해야 합니다');
  } finally {
    db.pool.connect = original;
  }
});
