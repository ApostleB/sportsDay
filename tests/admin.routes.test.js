const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkAdminPassword } = require('../src/middleware/auth');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

test('checkAdminPassword는 정확히 일치할 때만 참이다', () => {
  assert.equal(checkAdminPassword('admin-test-pw'), true);
  assert.equal(checkAdminPassword('admin-test-p'), false);
  assert.equal(checkAdminPassword(undefined), false);
});

test('관리자가 아니면 로그인 화면으로 보낸다', async () => {
  const res = await H.request(H.getApp()).get('/admin').expect(302);
  assert.equal(res.headers.location, '/admin/login');
});

test('틀린 비밀번호는 401', async () => {
  const res = await H.request(H.getApp()).post('/admin/login').type('form').send({ password: 'nope' }).expect(401);
  assert.match(res.text, /정보가 일치하지 않습니다/);
});

test('로그인하면 운동회 목록과 상세가 보이고 로그아웃할 수 있다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const list = await admin.get('/admin').expect(200);
  assert.match(list.text, /제 3회 명량운동회/);
  const detail = await admin.get(`/admin/events/${event.id}`).expect(200);
  assert.match(detail.text, /생성자/);
  assert.match(detail.text, new RegExp(event.auth_code));
  await admin.get('/admin/events/999999').expect(404);
  await admin.post('/admin/logout').expect(302);
  await admin.get('/admin').expect(302);
});

test('참가자 PIN을 재설정하면 새 PIN으로 입장한다', async () => {
  const { event, participant } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.post(`/admin/events/${event.id}/participants/${participant.id}/pin`).type('form')
    .send({ pin: '7777' }).expect(302);
  const done = await admin.get(res.headers.location).expect(200);
  assert.match(done.text, /참가자 PIN을 재설정했습니다/);
  await H.joinAgent(event, { name: '생성자', pin: '7777' });
  const bad = await admin.post(`/admin/events/${event.id}/participants/${participant.id}/pin`).type('form')
    .send({ pin: '77' }).expect(400);
  assert.match(bad.text, /4자리/);
});

test('다른 운동회의 참가자 PIN은 재설정할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/participants/${other.id}/pin`).type('form').send({ pin: '7777' }).expect(404);
});

test('생성자 PIN을 재설정하면 새 PIN으로 관리 페이지가 열린다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/creator-pin`).type('form').send({ pin: '654321' }).expect(302);
  const member = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  await member.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(400);
  await member.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '654321' }).expect(302);
});

test('관리자는 입장하지 않고도 생성자 화면에 들어갈 수 있다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(res.text, /플랫폼 관리/);
  await admin.get(`/e/${event.slug}/manage/participants`).expect(200);
});

test('삭제 확인 문구가 틀리면 400, 맞으면 운동회와 시간표 파일이 지워진다', async () => {
  const { event } = await H.makeEvent();
  const file = path.join(process.env.UPLOAD_DIR, 'admin-del.png');
  fs.writeFileSync(file, 'x');
  await schedules.add(event.id, { fileName: 'admin-del.png', caption: '' });
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/delete`).type('form').send({ confirm: 'wrong' }).expect(400);
  await admin.post(`/admin/events/${event.id}/delete`).type('form').send({ confirm: ` ${event.slug.toUpperCase()} ` }).expect(302);
  await admin.get(`/admin/events/${event.id}`).expect(404);
  assert.equal(fs.existsSync(file), false);
});

test('관리자 로그인 후에도 기존 운동회 입장 정보가 유지된다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '철수', pin: '1234' });
  await agent.post('/admin/login').type('form').send({ password: 'admin-test-pw' }).expect(302);
  await agent.get(`/e/${event.slug}/home`).expect(200);
  await agent.get('/admin').expect(200);
});

test('상세 화면 렌더링 중 오류가 나면 500으로 응답한다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const participants = require('../src/services/participants');
  const original = participants.listParticipants;
  const origError = console.error;
  participants.listParticipants = async () => { throw new Error('boom'); };
  console.error = () => {};
  try {
    await admin.get(`/admin/events/${event.id}`).expect(500);
  } finally {
    participants.listParticipants = original;
    console.error = origError;
  }
});

test('참가자 PIN을 재설정하면 그 참가자의 기존 세션은 끊기고 다른 운동회 세션은 유지된다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const agent = await H.joinAgent(event, { name: '철수', pin: '1234' });
  await agent.post(`/e/${other.slug}/join`).type('form').send({ name: '철수', pin: '1234', authCode: other.auth_code }).expect(302);
  const { rows } = await H.db.query('SELECT id FROM participants WHERE event_id = $1 AND name = $2', [event.id, '철수']);
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/participants/${rows[0].id}/pin`).type('form').send({ pin: '7777' }).expect(302);
  const res = await agent.get(`/e/${event.slug}/home`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
  await agent.get(`/e/${other.slug}/home`).expect(200);
});

test('생성자 PIN을 재설정하면 기존 생성자 권한은 사라지지만 참가는 유지된다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  await creator.get(`/e/${event.slug}/manage`).expect(200);
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/creator-pin`).type('form').send({ pin: '654321' }).expect(302);
  const res = await creator.get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}/manage/unlock`);
  await creator.get(`/e/${event.slug}/home`).expect(200);
});

test('알 수 없는 done 값은 메시지를 보이지 않는다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.get(`/admin/events/${event.id}?done=constructor`).expect(200);
  assert.doesNotMatch(res.text, /function Object/);
  assert.doesNotMatch(res.text, /class="alert/);
});

test('관리자 비밀번호를 5번 틀리면 맞는 비밀번호도 429, 초기화 후에는 성공한다', async () => {
  const agent = H.request.agent(H.getApp());
  for (let i = 0; i < 5; i++) {
    await agent.post('/admin/login').type('form').send({ password: 'wrong' }).expect(401);
  }
  const res = await agent.post('/admin/login').type('form').send({ password: 'admin-test-pw' }).expect(429);
  assert.match(res.text, /시도가 너무 많습니다. 잠시 후 다시 시도해 주세요./);
  await H.resetDb();
  await agent.post('/admin/login').type('form').send({ password: 'admin-test-pw' }).expect(302);
});

test('관리자는 참가자 세션 없이 생성자 화면에서 참가자 화면 링크를 보지 않는다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.get(`/e/${event.slug}/manage`).expect(200);
  assert.doesNotMatch(res.text, /참가자 화면/);
});

test('생성자 PIN 재설정 후 다시 입장해도 생성자 권한은 돌아오지 않는다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/creator-pin`).type('form').send({ pin: '654321' }).expect(302);
  await creator.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '생성자', pin: '1111', authCode: event.auth_code }).expect(302);
  const res = await creator.get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}/manage/unlock`);
});

test('개인 PIN 재설정 후 같은 세션으로 재입장하면 생성자 권한이 없다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const { rows } = await H.db.query('SELECT id FROM participants WHERE event_id = $1 AND name = $2', [event.id, '생성자']);
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/participants/${rows[0].id}/pin`).type('form').send({ pin: '7777' }).expect(302);
  await creator.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '생성자', pin: '7777', authCode: event.auth_code }).expect(302);
  const res = await creator.get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}/manage/unlock`);
});
