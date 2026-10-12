const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

test.beforeEach(H.resetDb);

async function setup() {
  const { event, participant } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  return { event, creator: participant, agent, base: `/e/${event.slug}/manage/participants` };
}

const byName = async (eventId, name) => (await H.db.query(
  'SELECT * FROM participants WHERE event_id = $1 AND name = $2', [eventId, name],
)).rows[0];

test('생성자가 추가한 참가자는 그 이름과 PIN으로 입장할 수 있다', async () => {
  const { event, agent, base } = await setup();
  const res = await agent.post(base).type('form').send({ name: ' 김  철수 ', pin: '4321' }).expect(302);
  assert.equal(res.headers.location, base);
  const p = await byName(event.id, '김 철수');
  assert.equal(p.attendance, 'present');
  await H.joinAgent(event, { name: '김 철수', pin: '4321' });
  const page = await agent.get(base).expect(200);
  assert.match(page.text, /김 철수/);
  assert.match(page.text, new RegExp(`href="${base}/${p.id}/edit"`));
});

test('추가 검증: 이름 중복과 PIN 형식, 입력값 유지', async () => {
  const { agent, base } = await setup();
  const dup = await agent.post(base).type('form').send({ name: '생성자', pin: '1234' }).expect(400);
  assert.match(dup.text, /이미 있습니다/);
  const bad = await agent.post(base).type('form').send({ name: '영희', pin: '12' }).expect(400);
  assert.match(bad.text, /PIN은 숫자 4자리/);
  assert.match(bad.text, /value="영희"/);
  await agent.post(base).type('form').send({ name: '', pin: '1234' }).expect(400);
});

test('이름만 바꾸면 기존 세션은 유지되고 새 이름으로 입장한다', async () => {
  const { event, agent, base } = await setup();
  const member = await H.joinAgent(event, { name: '철수', pin: '2222' });
  const p = await byName(event.id, '철수');
  const form = await agent.get(`${base}/${p.id}/edit`).expect(200);
  assert.match(form.text, /value="철수"/);
  await agent.post(`${base}/${p.id}/edit`).type('form').send({ name: '철수2', pin: '' }).expect(302);
  await member.get(`/e/${event.slug}/home`).expect(200);
  assert.equal(await byName(event.id, '철수'), undefined);
  assert.equal((await byName(event.id, '철수2')).id, p.id);
  await H.joinAgent(event, { name: '철수2', pin: '2222' });
});

test('PIN을 바꾸면 기존 세션이 끊기고 새 PIN만 통한다', async () => {
  const { event, agent, base } = await setup();
  const member = await H.joinAgent(event, { name: '철수', pin: '2222' });
  const p = await byName(event.id, '철수');
  await agent.post(`${base}/${p.id}/edit`).type('form').send({ name: '철수', pin: '9999' }).expect(302);
  const kicked = await member.get(`/e/${event.slug}/home`).expect(302);
  assert.equal(kicked.headers.location, `/e/${event.slug}`);
  await H.request(H.getApp()).post(`/e/${event.slug}/join`).type('form')
    .send({ name: '철수', pin: '2222', authCode: event.auth_code }).expect(400);
  await H.joinAgent(event, { name: '철수', pin: '9999' });
});

test('수정 검증, 본인 PIN 제한, 없는 참가자', async () => {
  const { event, creator, agent, base } = await setup();
  const p = await H.addParticipant(event.id, '철수');
  const dup = await agent.post(`${base}/${p.id}/edit`).type('form').send({ name: '생성자', pin: '' }).expect(400);
  assert.match(dup.text, /이미 있습니다/);
  assert.match(dup.text, /value="생성자"/);
  await agent.post(`${base}/${p.id}/edit`).type('form').send({ name: '철수', pin: 'abcd' }).expect(400);
  const self = await agent.post(`${base}/${creator.id}/edit`).type('form').send({ name: '생성자', pin: '5555' }).expect(400);
  assert.match(self.text, /본인 PIN/);
  assert.equal((await byName(event.id, '생성자')).pin_version, creator.pin_version);
  await agent.get(`/e/${event.slug}/manage`).expect(200);
  await agent.post(`${base}/${creator.id}/edit`).type('form').send({ name: '총무', pin: '' }).expect(302);
  assert.ok(await byName(event.id, '총무'));
  await agent.get(`${base}/999999/edit`).expect(404);
  await agent.post(`${base}/999999/edit`).type('form').send({ name: '아무개', pin: '' }).expect(404);
});

test('일반 참가자는 추가·수정할 수 없고 관리자는 할 수 있다', async () => {
  const { event, base } = await setup();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await member.post(base).type('form').send({ name: '몰래', pin: '1234' }).expect(302);
  assert.equal(await byName(event.id, '몰래'), undefined);
  const admin = await H.adminAgent();
  await admin.post(base).type('form').send({ name: '관리자추가', pin: '1234' }).expect(302);
  const added = await byName(event.id, '관리자추가');
  await admin.post(`${base}/${added.id}/edit`).type('form').send({ name: '관리자추가', pin: '7777' }).expect(302);
  assert.ok((await byName(event.id, '관리자추가')).pin_version > added.pin_version);
});

test('다른 운동회 생성자는 남의 참가자를 수정할 수 없다', async () => {
  const { agent, base } = await setup();
  const other = await H.makeEvent();
  const target = await H.addParticipant(other.event.id, '남의참가자');
  await agent.get(`${base}/${target.id}/edit`).expect(404);
  await agent.post(`${base}/${target.id}/edit`).type('form').send({ name: '탈취', pin: '' }).expect(404);
  assert.equal((await H.db.query('SELECT name FROM participants WHERE id = $1', [target.id])).rows[0].name, '남의참가자');
});
