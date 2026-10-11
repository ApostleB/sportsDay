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
  await admin.post(`/admin/events/${event.id}/delete`).type('form').send({ confirm: event.slug }).expect(302);
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
