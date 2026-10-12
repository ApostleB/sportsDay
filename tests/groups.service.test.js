const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../src/services/groups');

test.beforeEach(H.resetDb);

const groupOf = async (pid) => (await H.db.query('SELECT group_id FROM participants WHERE id = $1', [pid])).rows[0].group_id;

test('그룹을 만들고 이름 중복과 길이를 검사한다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, ' 축구부 ');
  const b = await groups.createGroup(event.id, '동창');
  assert.equal(a.name, '축구부');
  assert.equal(a.sort_order, 0);
  assert.equal(b.sort_order, 1);
  await assert.rejects(groups.createGroup(event.id, '축구부'), /이미 있습니다/);
  await assert.rejects(groups.createGroup(event.id, ''), /1~20자/);
  const { event: other } = await H.makeEvent();
  await groups.createGroup(other.id, '축구부');
});

test('그룹 이름을 바꾸고, 없는 그룹은 null', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  await groups.createGroup(event.id, '동창');
  assert.equal((await groups.renameGroup(event.id, a.id, '농구부')).name, '농구부');
  assert.equal((await groups.renameGroup(event.id, a.id, '농구부')).name, '농구부');
  await assert.rejects(groups.renameGroup(event.id, a.id, '동창'), /이미 있습니다/);
  assert.equal(await groups.renameGroup(event.id, '999999', '새이름'), null);
  assert.equal(await groups.renameGroup(event.id, 'abc', '새이름'), null);
  const { event: other } = await H.makeEvent();
  assert.equal(await groups.renameGroup(other.id, a.id, '남의것'), null);
});

test('그룹을 지우면 소속 참가자는 그룹 없음이 된다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const p = await H.addParticipant(event.id, '철수', { groupId: a.id });
  assert.equal(await groups.deleteGroup(event.id, a.id), true);
  assert.equal(await groupOf(p.id), null);
  assert.equal(await groups.deleteGroup(event.id, a.id), false);
  assert.equal(await groups.deleteGroup(event.id, '01'), false);
});

test('참가자 소속을 한 번에 저장하고 목록에 인원수를 보여 준다', async () => {
  const { event, participant: creator } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const b = await groups.createGroup(event.id, '동창');
  const p1 = await H.addParticipant(event.id, '철수');
  const p2 = await H.addParticipant(event.id, '영희', { groupId: b.id });
  await groups.saveMembership(event.id, { [`g${p1.id}`]: String(a.id), [`g${p2.id}`]: '' });
  assert.equal(String(await groupOf(p1.id)), String(a.id));
  assert.equal(await groupOf(p2.id), null);
  assert.equal(await groupOf(creator.id), null);
  const list = await groups.listGroups(event.id);
  assert.deepEqual(list.map((g) => [g.name, g.member_count]), [['축구부', 1], ['동창', 0]]);
});

test('다른 운동회의 그룹이나 잘못된 값은 거부하고 아무것도 바꾸지 않는다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent();
  const foreign = await groups.createGroup(other.id, '남의그룹');
  const mine = await groups.createGroup(event.id, '축구부');
  const p1 = await H.addParticipant(event.id, '철수');
  const p2 = await H.addParticipant(event.id, '영희');
  await assert.rejects(
    groups.saveMembership(event.id, { [`g${p1.id}`]: String(mine.id), [`g${p2.id}`]: String(foreign.id) }),
    /그룹 값/,
  );
  assert.equal(await groupOf(p1.id), null);
  await assert.rejects(groups.saveMembership(event.id, { [`g${p1.id}`]: 'abc' }), /그룹 값/);
});

test('뽑기 진행 중에는 그룹을 바꿀 수 없다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const p = await H.addParticipant(event.id, '철수');
  await H.db.query('UPDATE events SET draw_open = true WHERE id = $1', [event.id]);
  await assert.rejects(groups.createGroup(event.id, '새그룹'), /진행 중/);
  await assert.rejects(groups.renameGroup(event.id, a.id, '새이름'), /진행 중/);
  await assert.rejects(groups.deleteGroup(event.id, a.id), /진행 중/);
  await assert.rejects(groups.saveMembership(event.id, { [`g${p.id}`]: String(a.id) }), /진행 중/);
});
