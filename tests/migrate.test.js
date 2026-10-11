require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { migrate } = require('../db/migrate');

test('마이그레이션은 모든 테이블을 만들고 다시 실행해도 안전하다', async () => {
  await migrate();
  assert.deepEqual(await migrate(), []);
  const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const names = rows.map((r) => r.table_name);
  for (const t of ['events', 'participants', 'groups', 'teams', 'draw_results', 'announcements',
    'schedule_images', 'manito_links', 'polls', 'poll_options', 'poll_voters', 'poll_answers',
    'session', 'schema_migrations']) {
    assert.ok(names.includes(t), `${t} 테이블이 없습니다`);
  }
});

test('date 컬럼은 문자열로 읽힌다', async () => {
  const { rows } = await db.query("SELECT '2026-10-10'::date AS d");
  assert.equal(rows[0].d, '2026-10-10');
});
