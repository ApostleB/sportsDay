const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

function loadConfig(env) {
  return spawnSync(
    process.execPath,
    ['-e', "const c=require('./src/config');console.log(JSON.stringify({db:c.databaseUrl,rounds:c.bcryptRounds}))"],
    { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: path.join(root, 'tests', 'no-such.env'), ...env } },
  );
}

test('필수 환경변수가 없으면 변수 이름을 알려주며 실패한다', () => {
  const r = loadConfig({ NODE_ENV: 'production' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DATABASE_URL/);
});

test('테스트 환경에서는 TEST_DATABASE_URL과 낮은 bcrypt 비용을 쓴다', () => {
  const r = loadConfig({
    NODE_ENV: 'test',
    TEST_DATABASE_URL: 'postgres://t',
    DATABASE_URL: 'postgres://d',
    SESSION_SECRET: 's',
    ADMIN_PASSWORD: 'a',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { db: 'postgres://t', rounds: 4 });
});

test('테스트 환경에서 TEST_DATABASE_URL이 DATABASE_URL과 같으면 실패한다', () => {
  const r = loadConfig({
    NODE_ENV: 'test',
    TEST_DATABASE_URL: 'postgres://same',
    DATABASE_URL: 'postgres://same',
    SESSION_SECRET: 's',
    ADMIN_PASSWORD: 'a',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /TEST_DATABASE_URL이 DATABASE_URL과 같습니다/);
});
