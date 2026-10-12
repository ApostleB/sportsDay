const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');
const events = require('../src/services/events');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

async function setup(count = 5) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  await manito.assign(event.id, mulberry32(1));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  return { event, creator, people };
}

const unackedGivers = async (eventId) => (await H.manitoLinks(eventId))
  .filter((l) => !l.acknowledged_at).map((l) => l.giver).sort();
const giverTo = async (eventId, id) => (await H.manitoLinks(eventId)).find((l) => l.receiver === String(id)).giver;

test('결석·출석 복귀: 한 고리를 유지하고 바뀐 사람만 확인 전', async () => {
  const { event, people } = await setup();
  const x = people[3];
  const a = await giverTo(event.id, x.id);
  await participants.setAttendance(event.id, x.id, 'absent');
  await H.assertManitoCycle(event.id);
  assert.deepEqual(await unackedGivers(event.id), [a]);
  await participants.setAttendance(event.id, x.id, 'present');
  const links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(x.id)));
  const before = await giverTo(event.id, x.id);
  assert.ok((await unackedGivers(event.id)).includes(before));
  assert.ok((await unackedGivers(event.id)).includes(String(x.id)));
});

test('삭제: 순환에 있던 사람을 지워도 앞사람이 다음 사람으로 이어진다', async () => {
  const { event, people } = await setup();
  const x = people[4];
  const a = await giverTo(event.id, x.id);
  const b = (await H.manitoLinks(event.id)).find((l) => l.giver === String(x.id)).receiver;
  assert.equal(await participants.deleteParticipant(event.id, x.id), true);
  const links = await H.assertManitoCycle(event.id);
  assert.equal(links.find((l) => l.giver === a).receiver, b);
  assert.deepEqual(await unackedGivers(event.id), [a]);
  assert.equal(await participants.deleteParticipant(event.id, '999999'), false);
});

test('생성자 직접 추가와 새 이름 입장은 순환에 끼어든다', async () => {
  const { event } = await setup();
  const added = await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  let links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(added.id)));
  const joined = await participants.join(event, { name: '새입장', pin: '1234', authCode: event.auth_code });
  links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(joined.id)));
});

test('배정 전 변동은 순환을 만들지 않는다', async () => {
  const { event } = await H.makeEvent();
  const p = await H.addParticipant(event.id, '참가자1');
  await participants.setAttendance(event.id, p.id, 'absent');
  await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('2명까지 줄었다가 다시 늘어나도 불변식 유지', async () => {
  const { event, people } = await setup(3);
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  assert.deepEqual(await H.assertManitoCycle(event.id), []);
  await participants.setAttendance(event.id, people[1].id, 'present');
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
  await participants.setAttendance(event.id, people[2].id, 'present');
  assert.equal((await H.assertManitoCycle(event.id)).length, 3);
});

test('동시 출석 변경·추가·삭제 후에도 한 고리', async () => {
  const { event, people } = await setup(8);
  await Promise.all([
    participants.setAttendance(event.id, people[1].id, 'absent'),
    participants.setAttendance(event.id, people[2].id, 'absent'),
    participants.setAttendance(event.id, people[3].id, 'absent'),
    participants.deleteParticipant(event.id, people[4].id),
    participants.createParticipant(event.id, { name: '동시1', pin: '1234' }),
    participants.createParticipant(event.id, { name: '동시2', pin: '1234' }),
    participants.setAttendance(event.id, people[1].id, 'present'),
  ]);
  await H.assertManitoCycle(event.id);
});

test('참가 마감: 새 이름 거부(마감 전에 읽은 행으로 와도), 재입장·직접 추가는 허용', async () => {
  const { event, creator } = await setup(3);
  assert.equal(await events.setJoinClosed(event.id, true), true);
  const fresh = await events.getEventById(event.id);
  assert.equal(fresh.join_closed, true);
  await assert.rejects(
    participants.join(fresh, { name: '늦은사람', pin: '1234', authCode: fresh.auth_code }),
    /참가가 마감되었습니다/,
  );
  // event는 마감 전에 읽은 행(join_closed=false)이다
  await assert.rejects(
    participants.join(event, { name: '늦은사람', pin: '1234', authCode: event.auth_code }),
    /참가가 마감되었습니다/,
  );
  const again = await participants.join(fresh, { name: '생성자', pin: '1111', authCode: fresh.auth_code });
  assert.equal(String(again.id), String(creator.id));
  await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  await H.assertManitoCycle(event.id);
  await events.setJoinClosed(event.id, false);
  await participants.join(await events.getEventById(event.id), { name: '늦은사람', pin: '1234', authCode: event.auth_code });
  assert.equal(await events.setJoinClosed('abc', true), false);
});

test('참가 마감: 이미 있는 이름에 틀린 PIN은 기존 문구, 같은 이름 동시 입장은 하나만', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(
    participants.join(event, { name: '생성자', pin: '9999', authCode: event.auth_code }),
    /이미 사용 중인 이름이거나 PIN이 틀렸습니다/,
  );
  const results = await Promise.allSettled([
    participants.join(event, { name: '동명', pin: '1234', authCode: event.auth_code }),
    participants.join(event, { name: '동명', pin: '1234', authCode: event.auth_code }),
  ]);
  const { rows } = await H.db.query("SELECT count(*)::int AS n FROM participants WHERE event_id = $1 AND name = '동명'", [event.id]);
  assert.equal(rows[0].n, 1);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
});

test('입장 라우트: 마감 중 새 이름은 400과 안내', async () => {
  const { event } = await H.makeEvent();
  await events.setJoinClosed(event.id, true);
  const res = await H.request(H.getApp()).post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(400);
  assert.match(res.text, /참가가 마감되었습니다/);
});
