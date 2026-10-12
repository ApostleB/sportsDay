const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');

test.beforeEach(H.resetDb);

const NAMES = ['가람', '나래', '다솜', '라온'];

async function setup() {
  const { event } = await H.makeEvent();
  const people = [];
  for (const name of NAMES) people.push(await H.addParticipant(event.id, name));
  const creator = await H.creatorAgent(event);
  return { event, people, creator, manage: `/e/${event.slug}/manage` };
}
const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const leaked = (html) => NAMES.filter((n) => html.includes(n));

test('일반 참가자는 마니또 관리와 참가 마감에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  for (const name of ['가람', '나래']) await H.addParticipant(event.id, name);
  const agent = await H.joinAgent(event, { name: '다솜', pin: '1234' });
  const manage = `/e/${event.slug}/manage`;
  for (const [method, path] of [['get', '/manito'], ['post', '/manito/assign'], ['post', '/manito/open'], ['post', '/join-closed']]) {
    const url = `${manage}${path}`;
    const req = method === 'get' ? agent.get(url) : agent.post(url).type('form').send({ closed: '1' });
    const res = await req.expect(302);
    assert.equal(res.headers.location, `${manage}/unlock`);
  }
  const row = await eventRow(event.id);
  assert.equal(row.manito_stage, 'none');
  assert.equal(row.join_closed, false);
});

test('배정 → 공개: 단계별 버튼, 공개 전후 모두 짝을 렌더링하지 않는다', async () => {
  const { event, creator, manage } = await setup();
  let res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /마니또 배정/);
  assert.match(res.text, new RegExp(`href="${manage}/manito" aria-current="page"`));
  await creator.post(`${manage}/manito/assign`).expect(302);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /배정됨/);
  assert.match(res.text, /마니또 공개/);
  assert.match(res.text, /다시 배정/);
  assert.deepEqual(leaked(res.text), [], '공개 전 생성자 화면에 참가자 이름이 나오면 안 된다');
  await creator.post(`${manage}/manito/open`).expect(302);
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /공개됨/);
  assert.match(res.text, new RegExp(`href="/e/${event.slug}/manito/map"`));
  await manito.setLocked(event.id, true);
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /관리자가 맵을 잠갔습니다/);
});

test('배정 거부와 다시 배정 확인 문구는 같은 화면 400', async () => {
  const { event, people, creator, manage } = await setup();
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  let res = await creator.post(`${manage}/manito/assign`).expect(400);
  assert.match(res.text, /출석한 참가자가 3명 이상이어야/);
  for (const p of people) await participants.setAttendance(event.id, p.id, 'present');
  await creator.post(`${manage}/manito/assign`).expect(302);
  await manito.acknowledge(event.id, people[0].id);
  res = await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시' }).expect(400);
  assert.match(res.text, /확인 문구/);
  await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시 배정' }).expect(302);
  const { rows } = await H.db.query('SELECT count(*)::int AS n FROM manito_links WHERE event_id = $1 AND acknowledged_at IS NOT NULL', [event.id]);
  assert.equal(rows[0].n, 0);
  await creator.post(`${manage}/manito/open`).expect(302);
  res = await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시 배정' }).expect(400);
  assert.match(res.text, /공개한 뒤에는 다시 배정할 수 없습니다/);
});

test('순환 인원 3명 미만 경고와 집계', async () => {
  const { event, people, creator, manage } = await setup();
  await creator.post(`${manage}/manito/assign`).expect(302);
  await manito.acknowledge(event.id, people[0].id);
  let res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /<strong class="tnum">5<\/strong>순환 인원/);
  assert.match(res.text, /<strong class="tnum">1<\/strong>확인함/);
  assert.doesNotMatch(res.text, /순환 인원이 3명보다 적습니다/);
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /순환 인원이 3명보다 적습니다/);
});

test('대시보드 참가 마감: 켜면 새 이름 입장 거부, 직접 추가는 허용, 끄면 다시 입장', async () => {
  const { event, creator, manage } = await setup();
  let res = await creator.get(manage).expect(200);
  assert.match(res.text, /참가 받는 중/);
  res = await creator.post(`${manage}/join-closed`).type('form').send({ closed: '1' }).expect(302);
  assert.equal(res.headers.location, manage);
  assert.equal((await eventRow(event.id)).join_closed, true);
  res = await creator.get(manage).expect(200);
  assert.match(res.text, /참가 마감됨/);
  const app = H.request(H.getApp());
  await app.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(400);
  await creator.post(`${manage}/participants`).type('form').send({ name: '직접추가', pin: '1234' }).expect(302);
  const { rows } = await H.db.query("SELECT 1 FROM participants WHERE event_id = $1 AND name = '직접추가'", [event.id]);
  assert.equal(rows.length, 1);
  await creator.post(`${manage}/join-closed`).type('form').send({ closed: '0' }).expect(302);
  assert.equal((await eventRow(event.id)).join_closed, false);
  await app.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(302);
});
