const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

const REAL = ['홍길동', '남궁민원', '이순신'];
const MASKED = ['홍*동', '남**원', '이*신'];

async function setup() {
  const { event } = await H.makeEvent({ creatorName: '홍길동' });
  await H.addParticipant(event.id, '남궁민원');
  await H.addParticipant(event.id, '이순신');
  return { event, admin: await H.adminAgent(), path: `/admin/events/${event.id}` };
}
const sectionOf = (html, id) => {
  const m = html.match(new RegExp(`<section class="card stack" id="${id}">([\\s\\S]*?)</section>`));
  assert.ok(m, `${id} 칸이 없다`);
  return m[1];
};
const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];

test('관리자 상세: 마니또 칸은 공개 전에도 마스킹된 고리만 보인다', async () => {
  const { event, admin, path } = await setup();
  let section = sectionOf((await admin.get(path).expect(200)).text, 'manito');
  assert.match(section, /준비/);
  await manito.assign(event.id, mulberry32(1));
  const html = (await admin.get(path).expect(200)).text;
  section = sectionOf(html, 'manito');
  assert.match(section, /배정됨/);
  for (const name of MASKED) assert.ok(section.includes(name), `${name}이 없다`);
  for (const name of REAL) assert.ok(!section.includes(name), `${name}이 마니또 칸에 노출됨`);
  for (const a of REAL) for (const b of REAL) assert.ok(!html.includes(`${a} → ${b}`), '원래 이름 쌍이 노출됨');
});

test('관리자 맵 잠금: 잠그면 참가자 맵이 숨겨지고 풀면 다시 보인다', async () => {
  const { event, admin, path } = await setup();
  await manito.assign(event.id, mulberry32(2));
  await manito.open(event.id);
  let res = await admin.post(`${path}/manito-lock`).type('form').send({ locked: '1' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=manitoLock`);
  assert.equal((await eventRow(event.id)).manito_locked, true);
  assert.equal(await manito.map(event.id), null);
  res = await admin.get(`${path}?done=manitoLock`).expect(200);
  assert.match(res.text, /마니또 맵을 잠갔습니다/);
  assert.match(sectionOf(res.text, 'manito'), /잠금 해제/);
  res = await admin.post(`${path}/manito-lock`).type('form').send({ locked: '0' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=manitoUnlock`);
  assert.equal((await eventRow(event.id)).manito_locked, false);
  assert.ok(await manito.map(event.id));
});

test('관리자 참가 마감 켜기·끄기', async () => {
  const { event, admin, path } = await setup();
  assert.match(sectionOf((await admin.get(path)).text, 'join'), /참가 받는 중/);
  let res = await admin.post(`${path}/join-closed`).type('form').send({ closed: '1' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=joinClosed`);
  assert.equal((await eventRow(event.id)).join_closed, true);
  res = await admin.get(`${path}?done=joinClosed`).expect(200);
  assert.match(res.text, /참가를 마감했습니다/);
  assert.match(sectionOf(res.text, 'join'), /참가 마감됨/);
  res = await admin.post(`${path}/join-closed`).type('form').send({ closed: '0' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=joinOpen`);
  assert.equal((await eventRow(event.id)).join_closed, false);
});

test('관리자가 아니면 잠금·마감을 바꿀 수 없고, 없는 운동회는 404', async () => {
  const { event, path } = await setup();
  const app = H.request(H.getApp());
  for (const [suffix, body] of [['/manito-lock', { locked: '1' }], ['/join-closed', { closed: '1' }]]) {
    const res = await app.post(`${path}${suffix}`).type('form').send(body).expect(302);
    assert.equal(res.headers.location, '/admin/login');
  }
  const row = await eventRow(event.id);
  assert.equal(row.manito_locked, false);
  assert.equal(row.join_closed, false);
  const admin = await H.adminAgent();
  await admin.post('/admin/events/999999/manito-lock').type('form').send({ locked: '1' }).expect(404);
});
