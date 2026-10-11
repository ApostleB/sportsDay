const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const participants = require('../src/services/participants');

test.beforeEach(H.resetDb);

const app = () => H.request(H.getApp());

test('메인 페이지가 열린다', async () => {
  const res = await app().get('/').expect(200);
  assert.match(res.text, /운동회 만들기/);
});

test('운동회를 만들면 생성자로 입장된 상태로 생성 완료 화면으로 이동한다', async () => {
  const agent = H.request.agent(H.getApp());
  const res = await agent.post('/events').type('form').send(H.EVENT_INPUT).expect(302);
  const match = res.headers.location.match(/^\/e\/([a-z0-9]{8})\/manage\/created$/);
  assert.ok(match, res.headers.location);
  const home = await agent.get(`/e/${match[1]}/home`).expect(200);
  assert.match(home.text, /제 3회 명량운동회/);
  assert.match(home.text, /생성자/);
  assert.match(home.text, /관리 페이지/);
});

test('생성 폼 검증에 실패하면 400과 메시지를 보여주고 PIN 외 입력값을 유지한다', async () => {
  const res = await app().post('/events').type('form')
    .send({ ...H.EVENT_INPUT, creatorPinConfirm: '654321', meetInfo: '한강 둔치' }).expect(400);
  assert.match(res.text, /생성자 PIN 확인이 일치하지 않습니다/);
  assert.match(res.text, /한강 둔치/);
  assert.doesNotMatch(res.text, /123456/);
});

test('/go는 초대 링크나 코드로 운동회 입장 화면에 보낸다', async () => {
  let res = await app().get('/go').query({ target: 'https://example.com/e/abcd2345?code=XY12ZZ&x=1' }).expect(302);
  assert.equal(res.headers.location, '/e/abcd2345?code=XY12ZZ');
  res = await app().get('/go').query({ target: ' abcd2345 ' }).expect(302);
  assert.equal(res.headers.location, '/e/abcd2345');
  await app().get('/go').query({ target: '!!' }).expect(400);
});

test('초대 링크의 인증코드가 입장 폼에 미리 채워진다', async () => {
  const { event } = await H.makeEvent();
  const res = await app().get(`/e/${event.slug}?code=${event.auth_code}`).expect(200);
  assert.match(res.text, new RegExp(`value="${event.auth_code}"`));
});

test('없는 운동회는 404', async () => {
  await app().get('/e/zzzzzzzz').expect(404);
});

test('신규 입장하면 홈에서 이름이 보이고 같은 이름과 PIN으로 다시 입장할 수 있다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '홍길동', pin: '4321' });
  const home = await agent.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, /홍길동/);
  assert.doesNotMatch(home.text, /관리 페이지/);
  await H.joinAgent(event, { name: '홍길동', pin: '4321' });
});

test('이미 있는 이름에 PIN이 틀리면 400', async () => {
  const { event } = await H.makeEvent();
  await H.joinAgent(event, { name: '홍길동', pin: '4321' });
  const res = await app().post(`/e/${event.slug}/join`).type('form')
    .send({ name: '홍길동', pin: '0000', authCode: event.auth_code }).expect(400);
  assert.match(res.text, /이미 사용 중인 이름이거나 PIN이 틀렸습니다/);
  assert.match(res.text, /홍길동/);
});

test('인증코드가 틀리면 400', async () => {
  const { event } = await H.makeEvent();
  const res = await app().post(`/e/${event.slug}/join`).type('form')
    .send({ name: '홍길동', pin: '4321', authCode: 'WRONG9' }).expect(400);
  assert.match(res.text, /인증코드가 올바르지 않습니다/);
});

test('입장하지 않은 사용자가 홈에 오면 입장 폼으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const res = await app().get(`/e/${event.slug}/home`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
});

test('한 브라우저로 두 운동회에 동시에 입장할 수 있다', async () => {
  const { event: e1 } = await H.makeEvent();
  const { event: e2 } = await H.makeEvent({ roundNo: '4' });
  const agent = await H.joinAgent(e1, { name: '철수', pin: '1234' });
  await agent.post(`/e/${e2.slug}/join`).type('form').send({ name: '철수', pin: '1234', authCode: e2.auth_code }).expect(302);
  await agent.get(`/e/${e1.slug}/home`).expect(200);
  await agent.get(`/e/${e2.slug}/home`).expect(200);
});

test('나가기를 하면 그 운동회의 홈에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '철수', pin: '1234' });
  await agent.post(`/e/${event.slug}/logout`).expect(302);
  await agent.get(`/e/${event.slug}/home`).expect(302);
});

test('입장 중에 삭제된 참가자는 입장 폼으로 돌아간다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '영희', pin: '1234' });
  const { rows } = await H.db.query("SELECT id FROM participants WHERE name = '영희'");
  await participants.deleteParticipant(event.id, rows[0].id);
  const res = await agent.get(`/e/${event.slug}/home`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
  await agent.get(`/e/${event.slug}`).expect(200);
});
