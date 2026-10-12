const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const { lockEvent } = require('../src/services/event-lock');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

// 생성자 + count명, 모두 출석
async function setup(count = 4) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  return { event, creator, people };
}

const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const ackedGivers = async (eventId) => (await H.manitoLinks(eventId)).filter((l) => l.acknowledged_at).map((l) => l.giver);
const unackedGivers = async (eventId) => (await H.manitoLinks(eventId)).filter((l) => !l.acknowledged_at).map((l) => l.giver).sort();

async function sync(eventId, participantId, options) {
  await H.db.tx(async (client) => {
    await lockEvent(client, eventId);
    await manito.syncPresence(client, eventId, participantId, options);
  });
}
const setAbsent = (id) => H.db.query("UPDATE participants SET attendance = 'absent' WHERE id = $1", [id]);
const setPresent = (id) => H.db.query("UPDATE participants SET attendance = 'present' WHERE id = $1", [id]);

test('마이그레이션: 참가 마감 컬럼과 트랜잭션 끝에 검사하는 유일 제약', async () => {
  const { rows } = await H.db.query(
    `SELECT conname, condeferrable, condeferred FROM pg_constraint
     WHERE conrelid = 'manito_links'::regclass AND contype = 'u' ORDER BY conname`,
  );
  assert.deepEqual(rows.map((r) => [r.conname, r.condeferrable, r.condeferred]), [
    ['manito_links_giver_unique', true, true],
    ['manito_links_receiver_unique', true, true],
  ]);
  const { event } = await H.makeEvent();
  assert.equal(event.join_closed, false);
});

test('배정: 출석 3명 미만이면 거부하고 아무것도 바꾸지 않는다', async () => {
  const { event } = await setup(1);
  await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await assert.rejects(manito.assign(event.id), /출석한 참가자가 3명 이상이어야/);
  assert.equal((await eventRow(event.id)).manito_stage, 'none');
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('배정: 출석자 전원이 하나의 고리가 되고 결석자는 빠지며, 두 번은 안 된다', async () => {
  const { event, people } = await setup(5);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  assert.equal(await manito.assign(event.id, mulberry32(1)), true);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  const links = await H.assertManitoCycle(event.id);
  assert.equal(links.length, people.length);
  assert.ok(!links.some((l) => l.giver === String(absent.id) || l.receiver === String(absent.id)));
  await assert.rejects(manito.assign(event.id), /이미 마니또가 배정되었습니다/);
});

test('개인 조회와 확인: 확인 전에는 이름이 없고, 첫 확인 시각만 기록된다', async () => {
  const { event, people } = await setup(3);
  assert.deepEqual(await manito.mine(event.id, people[0].id),
    { stage: 'none', inCycle: false, acknowledged: false, receiverName: null });
  await manito.assign(event.id, mulberry32(2));
  const me = people[1];
  const link = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id));
  const receiver = people.find((p) => String(p.id) === link.receiver);
  assert.deepEqual(await manito.mine(event.id, me.id),
    { stage: 'assigned', inCycle: true, acknowledged: false, receiverName: null });
  assert.equal(await manito.acknowledge(event.id, me.id), true);
  const first = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id)).acknowledged_at;
  assert.ok(first);
  await manito.acknowledge(event.id, me.id);
  const second = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id)).acknowledged_at;
  assert.equal(second.getTime(), first.getTime());
  assert.deepEqual(await manito.mine(event.id, me.id),
    { stage: 'assigned', inCycle: true, acknowledged: true, receiverName: receiver.name });
  assert.deepEqual(await ackedGivers(event.id), [String(me.id)]);
  assert.equal(await manito.mine(event.id, 'abc'), null);
  assert.equal(await manito.acknowledge(event.id, 'abc'), false);
});

test('개인 확인: 순환에 없는 사람은 false', async () => {
  const { event } = await setup(3);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await manito.assign(event.id, mulberry32(3));
  assert.equal(await manito.acknowledge(event.id, absent.id), false);
  assert.deepEqual(await manito.mine(event.id, absent.id),
    { stage: 'assigned', inCycle: false, acknowledged: false, receiverName: null });
});

test('다시 배정: 배정 전·확인 문구 불일치·공개 후 거부, 성공하면 확인 기록이 모두 지워진다', async () => {
  const { event, people } = await setup(4);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /마니또를 먼저 배정해 주세요/);
  await manito.assign(event.id, mulberry32(4));
  await manito.acknowledge(event.id, people[0].id);
  await assert.rejects(manito.reassign(event.id, '다시'), /확인 문구/);
  assert.equal(await manito.reassign(event.id, '  다시 배정 ', mulberry32(5)), true);
  await H.assertManitoCycle(event.id);
  assert.deepEqual(await ackedGivers(event.id), []);
  await manito.open(event.id);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /공개한 뒤에는 다시 배정할 수 없습니다/);
});

test('다시 배정: 그사이 출석이 3명 미만이 되면 거부', async () => {
  const { event, people } = await setup(2);
  await manito.assign(event.id, mulberry32(6));
  await setAbsent(people[2].id);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /출석한 참가자가 3명 이상이어야/);
});

test('공개: 배정 전 거부, 두 번째 거부', async () => {
  const { event } = await setup(3);
  await assert.rejects(manito.open(event.id), /마니또를 먼저 배정해 주세요/);
  await manito.assign(event.id, mulberry32(7));
  assert.equal(await manito.open(event.id), true);
  assert.equal((await eventRow(event.id)).manito_stage, 'opened');
  await assert.rejects(manito.open(event.id), /이미 공개되었습니다/);
});

test('맵: 공개 전·잠금 중에는 null, 공개 후 고리 순서의 이름, 개인 확인은 잠금과 무관', async () => {
  const { event, people } = await setup(3);
  assert.equal(await manito.map(event.id), null);
  await manito.assign(event.id, mulberry32(8));
  assert.equal(await manito.map(event.id), null);
  await manito.open(event.id);
  const cycle = await manito.map(event.id);
  assert.deepEqual([...cycle].sort(), people.map((p) => p.name).sort());
  const { rows } = await H.db.query(
    `SELECT g.name AS giver, r.name AS receiver FROM manito_links l
     JOIN participants g ON g.id = l.giver_id JOIN participants r ON r.id = l.receiver_id
     WHERE l.event_id = $1`,
    [event.id],
  );
  const next = new Map(rows.map((r) => [r.giver, r.receiver]));
  cycle.forEach((name, i) => assert.equal(next.get(name), cycle[(i + 1) % cycle.length]));
  assert.equal(await manito.setLocked(event.id, true), true);
  assert.equal(await manito.map(event.id), null);
  assert.equal((await manito.mine(event.id, people[0].id)).inCycle, true);
  assert.equal(await manito.acknowledge(event.id, people[0].id), true);
  await manito.setLocked(event.id, false);
  assert.ok(Array.isArray(await manito.map(event.id)));
  assert.equal(await manito.map('abc'), null);
});

test('생성자 요약은 집계만, 관리자 조회는 서비스에서 마스킹한 이름만', async () => {
  const { event } = await H.makeEvent({ creatorName: '홍길동' });
  await H.addParticipant(event.id, '남궁민원');
  await H.addParticipant(event.id, '이순신');
  await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  assert.deepEqual(await manito.summary(event.id),
    { stage: 'none', locked: false, size: 0, acknowledgedCount: 0, presentCount: 3 });
  await manito.assign(event.id, mulberry32(9));
  const [first] = await H.manitoLinks(event.id);
  await manito.acknowledge(event.id, first.giver);
  const summary = await manito.summary(event.id);
  assert.deepEqual(summary, { stage: 'assigned', locked: false, size: 3, acknowledgedCount: 1, presentCount: 3 });
  const admin = await manito.adminView(event.id);
  assert.deepEqual({ ...admin, cycle: undefined },
    { stage: 'assigned', locked: false, size: 3, acknowledgedCount: 1, presentCount: 3, cycle: undefined });
  assert.deepEqual([...admin.cycle].sort(), ['남**원', '이*신', '홍*동'].sort());
  const text = JSON.stringify([summary, admin]);
  for (const name of ['홍길동', '남궁민원', '이순신']) assert.ok(!text.includes(name), `${name}이 노출됨`);
  assert.equal(await manito.summary('abc'), null);
  assert.equal(await manito.adminView('abc'), null);
});

test('자동 반영: 배정 전에는 아무것도 하지 않는다', async () => {
  const { event, people } = await setup(3);
  await setAbsent(people[1].id);
  await sync(event.id, people[1].id);
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('자동 반영: 빠짐은 앞사람만 다음 사람으로 잇고 그 사람의 확인을 비운다', async () => {
  const { event, people } = await setup(4);
  await manito.assign(event.id, mulberry32(10));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  const x = people[2];
  const before = await H.manitoLinks(event.id);
  const a = before.find((l) => l.receiver === String(x.id)).giver;
  const b = before.find((l) => l.giver === String(x.id)).receiver;
  await setAbsent(x.id);
  await sync(event.id, x.id);
  const after = await H.assertManitoCycle(event.id);
  assert.equal(after.find((l) => l.giver === a).receiver, b);
  assert.deepEqual(await unackedGivers(event.id), [a]);
});

test('자동 반영: 합류는 한 연결 사이에 끼우고, 앞사람과 새 사람만 확인 전', async () => {
  const { event, people } = await setup(3);
  await manito.assign(event.id, mulberry32(11));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  const newcomer = await H.addParticipant(event.id, '새사람');
  await sync(event.id, newcomer.id);
  const after = await H.assertManitoCycle(event.id);
  const a = after.find((l) => l.receiver === String(newcomer.id)).giver;
  assert.deepEqual(await unackedGivers(event.id), [a, String(newcomer.id)].sort());
});

test('자동 반영: 3→2명은 서로, 2→1명은 빈 순환, 다시 2명이 되면 새 고리', async () => {
  const { event, people } = await setup(2);
  await manito.assign(event.id, mulberry32(12));
  await setAbsent(people[2].id);
  await sync(event.id, people[2].id);
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
  await setAbsent(people[1].id);
  await sync(event.id, people[1].id);
  assert.deepEqual(await H.assertManitoCycle(event.id), []);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  assert.deepEqual(await manito.mine(event.id, people[0].id),
    { stage: 'assigned', inCycle: false, acknowledged: false, receiverName: null });
  await setPresent(people[1].id);
  await sync(event.id, people[1].id);
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
});

test('자동 반영: 곧 삭제될 참가자는 leaving으로 먼저 이어 붙인다', async () => {
  const { event, people } = await setup(4);
  await manito.assign(event.id, mulberry32(13));
  const x = people[3];
  await H.db.tx(async (client) => {
    await lockEvent(client, event.id);
    await manito.syncPresence(client, event.id, x.id, { leaving: true });
    await client.query('DELETE FROM participants WHERE id = $1', [x.id]);
  });
  assert.equal((await H.assertManitoCycle(event.id)).length, 4);
});

test('자동 반영: 이미 맞는 상태면 연결을 건드리지 않는다', async () => {
  const { event, people } = await setup(3);
  await manito.assign(event.id, mulberry32(14));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  await sync(event.id, people[1].id);
  await sync(event.id, '999999');
  assert.deepEqual(await unackedGivers(event.id), []);
});
