const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const draw = require('../src/services/draw');
const teams = require('../src/services/teams');
const groups = require('../src/services/groups');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

async function setup(count = 7) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  return { event, creator, people };
}

const envelope = async (pid) => (await H.db.query('SELECT team_id FROM participants WHERE id = $1', [pid])).rows[0].team_id;
const resultsOf = async (eventId) => (await H.db.query('SELECT * FROM draw_results WHERE event_id = $1', [eventId])).rows;
async function teamSizes(eventId) {
  const { rows } = await H.db.query(
    'SELECT count(*)::int AS n FROM participants WHERE event_id = $1 AND team_id IS NOT NULL GROUP BY team_id',
    [eventId],
  );
  return rows.map((r) => r.n).sort((a, b) => a - b);
}

// 모든 공개 기록의 팀은 그 사람의 봉투와 같아야 한다
async function assertConsistent(eventId) {
  const { rows } = await H.db.query(
    `SELECT d.participant_id FROM draw_results d JOIN participants p ON p.id = d.participant_id
     WHERE d.event_id = $1 AND p.team_id IS DISTINCT FROM d.team_id`,
    [eventId],
  );
  assert.deepEqual(rows, [], '공개 기록과 봉투가 다르다');
}

test('시작 전 점검: 출석 인원, 팀장 결석', async () => {
  const { event } = await H.makeEvent();
  assert.match((await draw.startProblems(event.id)).join(), /출석한 참가자\(1명\)가 팀 수\(4개\)보다 적습니다/);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  for (let i = 1; i <= 4; i++) await H.addParticipant(event.id, `참가자${i}`);
  const [first] = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [first.id, absent.id]);
  assert.deepEqual(await draw.startProblems(event.id), ['레드 팀장 결석자님이 결석으로 되어 있습니다']);
  await assert.rejects(draw.start(event.id), /결석/);
  const after = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(after.rows[0].draw_open, false);
});

test('시작하면 출석자 전원이 봉투를 받고, 팀장만 공개되며, 같은 그룹은 흩어진다', async () => {
  const { event, creator, people } = await setup(7);
  const group = await groups.createGroup(event.id, '축구부');
  const grouped = people.slice(1, 5);
  for (const p of grouped) await H.db.query('UPDATE participants SET group_id = $2 WHERE id = $1', [p.id, group.id]);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  const [first] = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [first.id, creator.id]);

  await draw.start(event.id, mulberry32(1));

  const opened = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(opened.rows[0].draw_open, true);
  assert.equal(String(await envelope(creator.id)), String(first.id));
  for (const p of people) assert.ok(await envelope(p.id), `${p.name} 봉투 없음`);
  assert.equal(await envelope(absent.id), null);
  assert.deepEqual(await teamSizes(event.id), [2, 2, 2, 2]);
  const groupTeams = await Promise.all(grouped.map((p) => envelope(p.id)));
  assert.equal(new Set(groupTeams.map(String)).size, 4);
  const results = await resultsOf(event.id);
  assert.deepEqual(results.map((r) => [String(r.participant_id), r.method]), [[String(creator.id), 'leader']]);
  await assertConsistent(event.id);
  await assert.rejects(draw.start(event.id), /이미/);
});

test('봉투를 열면 봉투의 팀이 공개되고, 다시 열어도 같다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(2));
  const target = people[3];
  const first = await draw.open(event.id, target.id);
  assert.equal(String(first.team.id), String(await envelope(target.id)));
  assert.equal(first.method, 'self');
  assert.ok(first.team.mark);
  const again = await draw.open(event.id, target.id, 'proxy');
  assert.deepEqual(again, first);
  assert.equal((await resultsOf(event.id)).length, 1);
  await assertConsistent(event.id);
  assert.deepEqual(await draw.myResult(event.id, target.id), first);
  assert.equal(await draw.myResult(event.id, people[4].id), null);
  assert.equal(await draw.open(event.id, '999999'), null);
});

test('같은 사람이 동시에 두 번 열어도 결과 행은 하나다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(3));
  const [a, b] = await Promise.all([draw.open(event.id, people[2].id), draw.open(event.id, people[2].id)]);
  assert.deepEqual(a.team, b.team);
  assert.equal((await resultsOf(event.id)).length, 1);
});

test('준비 상태에서는 열 수 없고, 봉투 없는 결석자도 열 수 없다', async () => {
  const { event } = await setup(7);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await assert.rejects(draw.open(event.id, absent.id), new RegExp(draw.NOT_OPEN));
  await draw.start(event.id, mulberry32(4));
  await assert.rejects(draw.open(event.id, absent.id), /결석으로 표시/);
});

test('시작 뒤에 온 사람들이 동시에 뽑아도 팀 인원이 고르다', async () => {
  const { event } = await setup(7);
  await draw.start(event.id, mulberry32(5));
  const late = [];
  for (let i = 1; i <= 4; i++) late.push(await H.addParticipant(event.id, `늦은사람${i}`));
  const results = await Promise.all(late.map((p) => draw.open(event.id, p.id, 'proxy')));
  assert.ok(results.every((r) => r && r.method === 'proxy'));
  assert.deepEqual(await teamSizes(event.id), [3, 3, 3, 3]);
  await assertConsistent(event.id);
});

test('늦게 온 사람은 그 그룹이 적은 팀으로 간다', async () => {
  const { event, people } = await setup(7);
  const group = await groups.createGroup(event.id, '동창');
  await H.db.query('UPDATE participants SET group_id = $2 WHERE id = $1', [people[1].id, group.id]);
  await draw.start(event.id, mulberry32(6));
  const groupTeam = String(await envelope(people[1].id));
  for (let seed = 1; seed <= 3; seed++) {
    await H.db.query("DELETE FROM participants WHERE event_id = $1 AND name LIKE '늦은%'", [event.id]);
    const late = await H.addParticipant(event.id, `늦은${seed}`, { groupId: group.id });
    const r = await draw.open(event.id, late.id, 'self', mulberry32(seed));
    assert.notEqual(String(r.team.id), groupTeam);
    await assertConsistent(event.id);
  }
});

test('팀 옮기기는 공개 처리하고 팀장은 옮길 수 없다', async () => {
  const { event, creator, people } = await setup(7);
  const list = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [list[0].id, creator.id]);
  await assert.rejects(draw.move(event.id, people[2].id, list[1].id), new RegExp(draw.NOT_OPEN));
  await draw.start(event.id, mulberry32(7));
  const moved = await draw.move(event.id, people[2].id, list[3].id);
  assert.equal(moved.method, 'manual');
  assert.equal(String(moved.team.id), String(list[3].id));
  assert.equal(String(await envelope(people[2].id)), String(list[3].id));
  await assertConsistent(event.id);
  await draw.open(event.id, people[4].id);
  const removed = await draw.move(event.id, people[4].id, list[2].id);
  assert.equal(String(removed.team.id), String(list[2].id));
  assert.equal((await resultsOf(event.id)).filter((r) => String(r.participant_id) === String(people[4].id)).length, 1);
  await assert.rejects(draw.move(event.id, creator.id, list[1].id), /팀장은 옮길 수 없습니다/);
  await assert.rejects(draw.move(event.id, people[2].id, ''), /옮길 팀/);
  const { event: other } = await H.makeEvent();
  const [foreignTeam] = await teams.listTeams(other.id);
  assert.equal(await draw.move(event.id, people[2].id, foreignTeam.id), null);
  assert.equal(await draw.move(event.id, '999999', list[1].id), null);
});

test('초기화는 확인 문구가 맞을 때만 모두 되돌린다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(8));
  await draw.open(event.id, people[1].id);
  await assert.rejects(draw.reset(event.id, '초기 화'), /초기화/);
  await draw.reset(event.id, '  초기화 ');
  const e = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(e.rows[0].draw_open, false);
  assert.equal((await resultsOf(event.id)).length, 0);
  assert.deepEqual(await teamSizes(event.id), []);
});

test('현황판과 진행표는 공개된 결과만 보여 준다', async () => {
  const { event, creator, people } = await setup(7);
  const list = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [list[0].id, creator.id]);
  await draw.start(event.id, mulberry32(9));
  await draw.open(event.id, people[1].id);

  const b = await draw.board(event.id);
  const shown = b.teams.flatMap((t) => t.members.map((m) => m.name)).sort();
  assert.deepEqual(shown, ['생성자', '참가자1'].sort());
  assert.equal(b.teams[0].members[0].is_leader, true);
  assert.equal(b.pending, 6);

  const rows = await draw.progress(event.id);
  for (const row of rows) assert.ok(!('team_id' in row), 'progress가 봉투를 읽으면 안 된다');
  const hidden = rows.find((r) => r.name === '참가자2');
  assert.equal(hidden.method, null);
  assert.equal(hidden.shown_team_id, null);
  assert.equal(rows.find((r) => r.name === '생성자').is_leader, true);
});

test('시작 뒤 결석으로 바뀐 사람도 봉투가 있으면 열 수 있고, 봉투 없는 결석자는 옮겨 줄 수 있다', async () => {
  const { event, people } = await setup(7);
  const [late] = [await H.addParticipant(event.id, '결석자', { attendance: 'absent' })];
  await draw.start(event.id, mulberry32(10));
  await H.db.query("UPDATE participants SET attendance = 'absent' WHERE id = $1", [people[3].id]);
  const r = await draw.open(event.id, people[3].id);
  assert.equal(String(r.team.id), String(await envelope(people[3].id)));
  const [t] = await teams.listTeams(event.id);
  const moved = await draw.move(event.id, late.id, t.id);
  assert.equal(moved.method, 'manual');
  assert.equal(String(await envelope(late.id)), String(t.id));
  await assertConsistent(event.id);
});

test('잘못된 운동회 id와 뽑기 방식은 거절한다', async () => {
  for (const bad of ['abc', '01']) {
    assert.deepEqual(await draw.startProblems(bad), ['운동회를 찾을 수 없습니다']);
    assert.equal(await draw.myResult(bad, '1'), null);
    assert.deepEqual(await draw.progress(bad), []);
    assert.deepEqual(await draw.board(bad), { teams: [], pending: 0 });
  }
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(11));
  for (const m of ['manual', 'leader', 'x']) {
    await assert.rejects(draw.open(event.id, people[2].id, m), /뽑기 방식/);
  }
  assert.equal((await resultsOf(event.id)).length, 0);
});

test('다른 운동회 참가자가 팀장으로 걸려 있어도 시작과 현황에 새지 않는다', async () => {
  const { event, people } = await setup(7);
  const { event: other, participant: foreign } = await H.makeEvent();
  const [first] = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [first.id, foreign.id]);
  await draw.start(event.id, mulberry32(12));
  const rows = await resultsOf(event.id);
  assert.equal(rows.filter((r) => String(r.participant_id) === String(foreign.id)).length, 0);
  assert.equal((await resultsOf(other.id)).length, 0);
  assert.equal(await envelope(foreign.id), null);
  const b = await draw.board(event.id);
  assert.ok(!b.teams.flatMap((t) => t.members.map((m) => m.name)).includes(foreign.name));
  const p = await draw.progress(event.id);
  assert.ok(p.every((x) => String(x.id) !== String(foreign.id)));
  assert.ok(p.every((x) => !x.is_leader));
  await assertConsistent(event.id);
  assert.ok(people.length);
});
