const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/services/polls');

test.beforeEach(H.resetDb);

const FORM = { title: '점심 메뉴', options: '짜장면\n짬뽕\n볶음밥', maxChoices: '1', anonymous: '1' };

async function setup() {
  const { event } = await H.makeEvent();
  const a = await H.addParticipant(event.id, '가람');
  await H.addParticipant(event.id, '나래', { attendance: 'absent' });
  const creator = await H.creatorAgent(event);
  return { event, a, creator, manage: `/e/${event.slug}/manage` };
}
const firstOption = async (pollId) => (await H.db.query(
  'SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order LIMIT 1', [pollId],
)).rows[0].id;
const pollRow = async (id) => (await H.db.query('SELECT * FROM polls WHERE id = $1', [id])).rows[0];

test('일반 참가자는 투표 관리에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const poll = await polls.createPoll(event.id, FORM);
  const agent = await H.joinAgent(event, { name: '가람', pin: '1234' });
  const manage = `/e/${event.slug}/manage`;
  for (const [method, path] of [['get', '/polls'], ['post', '/polls'], ['get', `/polls/${poll.id}`],
    ['post', `/polls/${poll.id}/status`], ['post', `/polls/${poll.id}/delete`], ['post', `/polls/${poll.id}/edit`]]) {
    const url = `${manage}${path}`;
    const req = method === 'get' ? agent.get(url) : agent.post(url).type('form').send({ ...FORM, status: 'closed', confirm: '삭제' });
    const res = await req.expect(302);
    assert.equal(res.headers.location, `${manage}/unlock`);
  }
  assert.equal((await pollRow(poll.id)).status, 'open');
});

test('만들기: 성공하면 상세로, 실패하면 400과 입력 유지', async () => {
  const { creator, manage } = await setup();
  let res = await creator.get(`${manage}/polls`).expect(200);
  assert.match(res.text, /아직 투표가 없습니다/);
  assert.match(res.text, new RegExp(`href="${manage}/polls" aria-current="page"`));
  res = await creator.post(`${manage}/polls`).type('form').send({ ...FORM, options: '하나만' }).expect(400);
  assert.match(res.text, /항목은 2~20개/);
  assert.match(res.text, /점심 메뉴/);
  res = await creator.post(`${manage}/polls`).type('form').send(FORM).expect(302);
  const { rows } = await H.db.query('SELECT id FROM polls');
  assert.equal(res.headers.location, `${manage}/polls/${rows[0].id}`);
  res = await creator.get(`${manage}/polls`).expect(200);
  assert.match(res.text, /점심 메뉴/);
  assert.match(res.text, /0\/3명 투표/);
});

test('상세: 공개 전에는 인원과 안 한 사람만, 득표는 없다', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  const res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, new RegExp(`href="${manage}/polls" aria-current="page"`));
  assert.match(res.text, /<strong class="tnum">1\/3<\/strong>투표/);
  assert.match(res.text, /아직 안 한 사람 \(2명\)/);
  assert.match(res.text, /나래 <span class="muted">결석<\/span>/);
  assert.doesNotMatch(res.text, /poll-results/);
  assert.doesNotMatch(res.text, /\d+표 ·/);
});

test('상태 전환: 마감 → 다시 열기 → 마감 → 결과 공개, 잘못된 전환은 400', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  let res = await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'revealed' }).expect(400);
  assert.match(res.text, /결과 공개는 마감한 뒤에/);
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'closed' }).expect(302);
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /결과 공개/);
  assert.match(res.text, /다시 열기/);
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'open' }).expect(302);
  assert.equal((await pollRow(poll.id)).status, 'open');
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'closed' }).expect(302);
  res = await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'revealed' }).expect(302);
  assert.equal(res.headers.location, `${manage}/polls/${poll.id}`);
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /poll-results/);
  assert.match(res.text, /1표 · 100%/);
  assert.doesNotMatch(res.text, /아직 안 한 사람/);
});

test('수정: 투표자 0명이면 폼이 있고 저장되며, 투표가 생기면 폼이 사라지고 400', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  let res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, new RegExp(`action="${manage}/polls/${poll.id}/edit"`));
  await creator.post(`${manage}/polls/${poll.id}/edit`).type('form').send({ ...FORM, title: '저녁 메뉴' }).expect(302);
  assert.equal((await pollRow(poll.id)).title, '저녁 메뉴');
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.doesNotMatch(res.text, new RegExp(`action="${manage}/polls/${poll.id}/edit"`));
  res = await creator.post(`${manage}/polls/${poll.id}/edit`).type('form').send(FORM).expect(400);
  assert.match(res.text, /이미 투표한 사람이 있어 수정할 수 없습니다/);
});

test('삭제: 확인 문구가 틀리면 400, 맞으면 목록으로', async () => {
  const { event, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  let res = await creator.post(`${manage}/polls/${poll.id}/delete`).type('form').send({ confirm: '지워' }).expect(400);
  assert.match(res.text, /확인 문구 (?:"|&#34;)삭제/);
  res = await creator.post(`${manage}/polls/${poll.id}/delete`).type('form').send({ confirm: '삭제' }).expect(302);
  assert.equal(res.headers.location, `${manage}/polls`);
  assert.equal(await pollRow(poll.id), undefined);
});

test('다른 운동회 투표와 잘못된 id는 404', async () => {
  const { creator, manage } = await setup();
  const { event: other } = await H.makeEvent();
  const foreign = await polls.createPoll(other.id, FORM);
  await creator.get(`${manage}/polls/${foreign.id}`).expect(404);
  await creator.get(`${manage}/polls/abc`).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/status`).type('form').send({ status: 'closed' }).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/edit`).type('form').send(FORM).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/delete`).type('form').send({ confirm: '삭제' }).expect(404);
  assert.equal((await pollRow(foreign.id)).status, 'open');
});

test('마감된 투표 상세: 득표는 없고, 결과 공개는 확인을 거치며 다시 열기가 먼저', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  await polls.setStatus(event.id, poll.id, 'closed');
  const res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.doesNotMatch(res.text, /poll-results/);
  assert.doesNotMatch(res.text, /\d+표 ·/);
  assert.match(res.text, /data-msg="결과를 공개할까요\? 모두에게 보이고 되돌릴 수 없어요\." onsubmit="return confirm\(this\.dataset\.msg\)"/);
  assert.ok(res.text.indexOf('다시 열기') < res.text.indexOf('>결과 공개<'), '다시 열기가 먼저');
  assert.match(res.text, /<strong class="stat-text">마감<\/strong>상태/);
});
