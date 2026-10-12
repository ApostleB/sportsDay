const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../src/services/events');

test.beforeEach(H.resetDb);

async function participantId(eventId, name) {
  const { rows } = await H.db.query('SELECT id FROM participants WHERE event_id = $1 AND name = $2', [eventId, name]);
  return rows[0].id;
}

test('입장하지 않은 사용자가 관리 페이지에 오면 입장 폼으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const res = await H.request(H.getApp()).get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
});

test('일반 참가자는 생성자 PIN 확인 화면으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}/manage/unlock`);
  await agent.get(`/e/${event.slug}/manage/unlock`).expect(200);
});

test('틀린 생성자 PIN은 400, 맞으면 대시보드가 열린다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  const bad = await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).expect(400);
  assert.match(bad.text, /정보가 일치하지 않습니다/);
  const ok = await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(302);
  assert.equal(ok.headers.location, `/e/${event.slug}/manage`);
  const dash = await agent.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(dash.text, /초대 링크/);
});

test('생성 완료 화면에 초대 링크와 인증코드가 있다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const res = await agent.get(`/e/${event.slug}/manage/created`).expect(200);
  assert.match(res.text, new RegExp(`/e/${event.slug}\\?code=${event.auth_code}`));
  assert.match(res.text, /다시 확인할 수 없습니다/);
});

test('운동회 정보를 수정하면 새 인증코드만 통한다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/manage/event`).type('form').send({
    roundNo: '3', title: '제 3회 명량운동회', eventDate: '2026-10-10', meetInfo: '변경된 장소', authCode: 'newcode1', status: 'live',
  }).expect(302);
  const updated = await events.getEventById(event.id);
  assert.equal(updated.auth_code, 'NEWCODE1');
  assert.equal(updated.status, 'live');
  await H.request(H.getApp()).post(`/e/${event.slug}/join`).type('form')
    .send({ name: '새사람', pin: '1234', authCode: event.auth_code }).expect(400);
});

test('운동회 정보가 잘못되면 400과 입력값 유지', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const res = await agent.post(`/e/${event.slug}/manage/event`).type('form').send({
    roundNo: '3', title: '', eventDate: '', meetInfo: '바뀐 안내', authCode: 'ABCD12', status: 'nope',
  }).expect(400);
  assert.match(res.text, /상태 값이 올바르지 않습니다/);
  assert.match(res.text, /바뀐 안내/);
});

test('참가자 출석 상태를 바꾸고 잘못된 값은 400', async () => {
  const { event } = await H.makeEvent();
  await H.joinAgent(event, { name: '철수', pin: '2222' });
  const agent = await H.creatorAgent(event);
  const id = await participantId(event.id, '철수');
  await agent.post(`/e/${event.slug}/manage/participants/${id}`).type('form')
    .send({ attendance: 'absent' }).expect(302);
  const { rows } = await H.db.query('SELECT attendance FROM participants WHERE id = $1', [id]);
  assert.equal(rows[0].attendance, 'absent');
  const page = await agent.get(`/e/${event.slug}/manage/participants`).expect(200);
  assert.match(page.text, /철수/);
  assert.doesNotMatch(page.text, /덩치|운동능력|성별/);
  const bad = await agent.post(`/e/${event.slug}/manage/participants/${id}`).type('form')
    .send({ attendance: 'gone' }).expect(400);
  assert.match(bad.text, /출석 상태 값이 올바르지 않습니다/);
});

test('참가자를 삭제할 수 있지만 본인은 삭제할 수 없다', async () => {
  const { event, participant: creator } = await H.makeEvent();
  await H.joinAgent(event, { name: '철수', pin: '2222' });
  const agent = await H.creatorAgent(event);
  const id = await participantId(event.id, '철수');
  await agent.post(`/e/${event.slug}/manage/participants/${id}/delete`).expect(302);
  const self = await agent.post(`/e/${event.slug}/manage/participants/${creator.id}/delete`).expect(400);
  assert.match(self.text, /본인은 삭제할 수 없습니다/);
  const { rows } = await H.db.query('SELECT name FROM participants WHERE event_id = $1', [event.id]);
  assert.deepEqual(rows.map((r) => r.name), ['생성자']);
});

test('다른 운동회의 참가자는 수정되지 않는다', async () => {
  const { event } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/manage/participants/${other.id}`).type('form')
    .send({ attendance: 'absent' }).expect(302);
  await agent.post(`/e/${event.slug}/manage/participants/${other.id}/delete`).expect(302);
  const { rows } = await H.db.query('SELECT attendance FROM participants WHERE id = $1', [other.id]);
  assert.equal(rows[0].attendance, 'present');
});

test('생성자 권한은 다시 입장해도 유지되지만 다른 이름으로 입장하면 사라진다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/join`).type('form').send({ name: '생성자', pin: '1111', authCode: event.auth_code }).expect(302);
  await agent.get(`/e/${event.slug}/manage`).expect(200);
  await agent.post(`/e/${event.slug}/join`).type('form').send({ name: '다른사람', pin: '3333', authCode: event.auth_code }).expect(302);
  await agent.get(`/e/${event.slug}/manage`).expect(302);
});

test('앞자리 0을 붙인 본인 id로 삭제를 우회할 수 없다', async () => {
  const { event, participant: creator } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/manage/participants/0${creator.id}/delete`);
  const { rows } = await H.db.query('SELECT id FROM participants WHERE id = $1', [creator.id]);
  assert.equal(rows.length, 1);
});

test('다시 입장한 생성자는 홈에서 생성자 입장 링크로 관리 페이지에 들어간다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: H.EVENT_INPUT.creatorName, pin: H.EVENT_INPUT.creatorPersonalPin });
  const home = await agent.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, new RegExp(`/e/${event.slug}/manage/unlock`));
  assert.match(home.text, /생성자 입장/);
  await agent.get(`/e/${event.slug}/manage/unlock`).expect(200);
  await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: H.EVENT_INPUT.creatorPin }).expect(302);
  await agent.get(`/e/${event.slug}/manage`).expect(200);
});

test('생성자 PIN을 5번 틀리면 맞는 PIN도 429, 초기화 후에는 성공한다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  for (let i = 0; i < 5; i++) {
    await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).expect(400);
  }
  const res = await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(429);
  assert.match(res.text, /시도가 너무 많습니다. 잠시 후 다시 시도해 주세요./);
  require('../src/middleware/attempt-limit').resetAllLimiters();
  await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(302);
});

test('동시에 보낸 잘못된 PIN은 400이 최대 5개이고 나머지는 429다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  const results = await Promise.all(Array.from({ length: 10 }, () => (
    agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).then((r) => r.status)
  )));
  assert.ok(results.filter((s) => s === 400).length <= 5, `400이 너무 많음: ${results}`);
  assert.equal(results.filter((s) => s === 429).length, 10 - results.filter((s) => s === 400).length);
  assert.equal(results.filter((s) => s === 429).length >= 5, true);
});

test('생성자 PIN 시도는 참가자별로 센다', async () => {
  const { event } = await H.makeEvent();
  const a = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  const b = await H.joinAgent(event, { name: '철수', pin: '1234' });
  for (let i = 0; i < 5; i++) await a.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).expect(400);
  await a.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(429);
  await b.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).expect(400);
});
