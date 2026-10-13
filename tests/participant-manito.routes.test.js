const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

const NAMES = ['가람', '나래', '다솜', '라온'];
// 생성자 이름은 화면 문구("생성자에게 알려 주세요" 등)와 겹치지 않게 따로 정한다
const ALL = [...NAMES, '마루'];

async function setup() {
  const { event } = await H.makeEvent({ creatorName: '마루' });
  const agents = {};
  for (const name of NAMES) agents[name] = await H.joinAgent(event, { name, pin: '1234' });
  return { event, agents, base: `/e/${event.slug}` };
}

async function receiverOf(eventId, name) {
  const { rows } = await H.db.query(
    `SELECT r.name FROM manito_links l
     JOIN participants g ON g.id = l.giver_id JOIN participants r ON r.id = l.receiver_id
     WHERE l.event_id = $1 AND g.name = $2`,
    [eventId, name],
  );
  return rows[0]?.name ?? null;
}

// 허용한 이름 말고 다른 참가자 이름이 HTML에 있으면 돌려준다
const leaked = (html, allowed) => ALL.filter((n) => !allowed.includes(n) && html.includes(n));

test('홈 카드: 준비 중 → 봉투 도착 → 내 마니또 보기, 결석자는 마니또 없음', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /마니또 준비 중/);
  await manito.assign(event.id, mulberry32(1));
  res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /봉투가 도착했어요/);
  assert.match(res.text, new RegExp(`href="${base}/manito"`));
  assert.deepEqual(leaked(res.text, ['가람']), []);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /내 마니또 보기/);
  assert.deepEqual(leaked(res.text, ['가람']), [], '홈에는 마니또 이름이 나오지 않는다');
  assert.doesNotMatch(res.text, /마니또 맵 보기/);
  const nare = (await H.db.query("SELECT id FROM participants WHERE event_id = $1 AND name = '나래'", [event.id])).rows[0];
  await participants.setAttendance(event.id, nare.id, 'absent');
  res = await agents['나래'].get(`${base}/home`).expect(200);
  assert.match(res.text, /지금은 마니또가 없어요/);
});

test('봉투: 열기 전에는 이름이 없고, 열면 내 마니또만 보인다', async () => {
  const { event, agents, base } = await setup();
  await manito.assign(event.id, mulberry32(2));
  let res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, new RegExp(`action="${base}/manito/open"`));
  assert.deepEqual(leaked(res.text, ['가람']), []);
  res = await agents['가람'].post(`${base}/manito/open`).expect(303);
  assert.equal(res.headers.location, `${base}/manito?opened=1`);
  const receiver = await receiverOf(event.id, '가람');
  res = await agents['가람'].get(`${base}/manito?opened=1`).expect(200);
  assert.match(res.text, /<details class="envelope" open>/);
  assert.ok(res.text.includes(receiver));
  assert.deepEqual(leaked(res.text, ['가람', receiver]), []);
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /<details class="envelope">/);
  res = await agents['나래'].get(`${base}/manito`).expect(200);
  assert.deepEqual(leaked(res.text, ['나래']), [], '다른 사람이 연 봉투는 내 화면에 영향이 없다');
});

test('봉투: 배정 전과 순환 밖에서는 안내만', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /아직 마니또가 배정되지 않았어요/);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  await manito.assign(event.id, mulberry32(3));
  const gr = (await H.db.query("SELECT id FROM participants WHERE event_id = $1 AND name = '가람'", [event.id])).rows[0];
  await participants.setAttendance(event.id, gr.id, 'absent');
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /지금은 마니또가 없어요/);
});

test('맵: 공개 전 안내, 공개 후 전체 고리, 잠그면 숨기고 개인 확인은 유지', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  await manito.assign(event.id, mulberry32(4));
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  assert.deepEqual(leaked(res.text, ['가람']), []);
  await manito.open(event.id);
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  for (const name of ALL) {
    const to = await receiverOf(event.id, name);
    assert.ok(res.text.includes(`<span class="manito-from">${name}</span><span class="manito-to">→ ${to}</span>`), `${name} → ${to}`);
  }
  assert.match((await agents['가람'].get(`${base}/home`)).text, /마니또 맵 보기/);
  await manito.setLocked(event.id, true);
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  assert.deepEqual(leaked(res.text, ['가람']), []);
  assert.doesNotMatch((await agents['가람'].get(`${base}/home`)).text, /마니또 맵 보기/);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.ok(res.text.includes(await receiverOf(event.id, '가람')), '잠겨도 개인 확인은 된다');
});

test('맵: 이름의 HTML은 이스케이프된다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '<b>굵게</b>', pin: '1234' });
  await H.addParticipant(event.id, '참가자1');
  await manito.assign(event.id, mulberry32(5));
  await manito.open(event.id);
  const res = await agent.get(`/e/${event.slug}/manito/map`).expect(200);
  assert.ok(res.text.includes('&lt;b&gt;굵게&lt;/b&gt;'));
  assert.ok(!res.text.includes('<b>굵게'));
});

test('입장하지 않은 사람은 마니또 화면에 들어올 수 없다', async () => {
  const { event } = await H.makeEvent();
  const app = H.request(H.getApp());
  for (const path of ['/manito', '/manito/map']) {
    const res = await app.get(`/e/${event.slug}${path}`).expect(302);
    assert.equal(res.headers.location, `/e/${event.slug}`);
  }
  const post = await app.post(`/e/${event.slug}/manito/open`).expect(302);
  assert.equal(post.headers.location, `/e/${event.slug}`);
});

test('맵: 10명 이하는 원형, 11명 이상은 목록', async () => {
  const small = await setup();
  await manito.assign(small.event.id, mulberry32(6));
  await manito.open(small.event.id);
  let res = await small.agents['가람'].get(`${small.base}/manito/map`).expect(200);
  assert.match(res.text, /class="manito-map circle"/);
  const { event, agents, base } = await setup();
  for (let i = 1; i <= 6; i++) await H.addParticipant(event.id, `추가${i}`);
  await manito.assign(event.id, mulberry32(7));
  await manito.open(event.id);
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /class="manito-map"/);
  assert.doesNotMatch(res.text, /manito-map circle/);
});

test('맵: 이름이 11자 이상이면 4명이어도 목록, 짧으면 원형', async () => {
  for (const [third, circle] of [['열한글자이름입니다요요', false], ['열글자이름입니다', true]]) {
    const { event } = await H.makeEvent();
    const agent = await H.joinAgent(event, { name: '가람', pin: '1234' });
    await H.addParticipant(event.id, '나래');
    await H.addParticipant(event.id, '다솜');
    await H.addParticipant(event.id, third);
    await manito.assign(event.id, mulberry32(9));
    await manito.open(event.id);
    const res = await agent.get(`/e/${event.slug}/manito/map`).expect(200);
    assert.equal(/manito-map circle/.test(res.text), circle, third);
    assert.equal(/시계 방향으로 이어져요/.test(res.text), circle, third);
  }
});

test('맵: 순환이 비면 안내만', async () => {
  const { event, agents, base } = await setup();
  await manito.assign(event.id, mulberry32(8));
  await manito.open(event.id);
  const { rows } = await H.db.query("SELECT id FROM participants WHERE event_id = $1 AND name IN ('나래', '다솜', '라온', '마루')", [event.id]);
  for (const r of rows) await participants.setAttendance(event.id, r.id, 'absent');
  const res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /지금은 이어진 마니또가 없어요/);
});
