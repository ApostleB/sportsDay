const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const teams = require('../src/services/teams');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

function form(list, overrides = {}) {
  const input = {};
  list.forEach((t, i) => {
    input[`name${i}`] = t.name;
    input[`color${i}`] = t.color;
    input[`leader${i}`] = t.leader_participant_id ?? '';
  });
  return { ...input, ...overrides };
}

test('운동회를 만들면 기본 4팀이 생긴다', async () => {
  const { event } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => [t.name, t.color, t.palette.mark]), [
    ['레드', 'red', '●'], ['블루', 'blue', '▲'], ['그린', 'green', '■'], ['옐로우', 'yellow', '★'],
  ]);
});

test('팀이 없는 운동회는 ensureDefaultTeams가 기본 4팀을 한 번만 만든다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query('DELETE FROM teams WHERE event_id = $1', [event.id]);
  await teams.ensureDefaultTeams(event.id);
  await teams.ensureDefaultTeams(event.id);
  assert.equal((await teams.listTeams(event.id)).length, 4);
});

test('팀 수를 늘리면 안 쓴 색으로 추가하고, 줄이면 뒤에서부터 지운다', async () => {
  const { event } = await H.makeEvent();
  await teams.setTeamCount(event.id, '6');
  let list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => t.color), ['red', 'blue', 'green', 'yellow', 'purple', 'orange']);
  assert.deepEqual(list.slice(4).map((t) => t.name), ['퍼플', '오렌지']);
  await teams.setTeamCount(event.id, '3');
  list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => t.name), ['레드', '블루', '그린']);
  for (const bad of ['1', '9', 'abc', '']) {
    await assert.rejects(teams.setTeamCount(event.id, bad), ValidationError);
  }
});

test('새 팀의 기본 이름이 이미 쓰이고 있으면 번호를 붙인다', async () => {
  const { event } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  await teams.saveTeams(event.id, form(list, { name0: '퍼플' }));
  await teams.setTeamCount(event.id, '5');
  const after = await teams.listTeams(event.id);
  assert.equal(after[4].name, '퍼플 5');
});

test('팀 이름·색·팀장을 저장한다', async () => {
  const { event, participant } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  await teams.saveTeams(event.id, form(list, { name0: '  불꽃   팀 ', color0: 'purple', leader0: participant.id }));
  const saved = await teams.listTeams(event.id);
  assert.equal(saved[0].name, '불꽃 팀');
  assert.equal(saved[0].color, 'purple');
  assert.equal(String(saved[0].leader_participant_id), String(participant.id));
  assert.equal(saved[0].leader_name, '생성자');
  assert.equal(saved[0].palette.mark, '◆');
});

test('팀 설정 검증', async () => {
  const { event, participant } = await H.makeEvent();
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  const { event: other } = await H.makeEvent();
  const outsider = await H.addParticipant(other.id, '남의사람');
  const list = await teams.listTeams(event.id);
  const cases = [
    [{ name1: '레드' }, /중복/],
    [{ name0: '   ' }, /1~20자/],
    [{ name0: 'ㄱ'.repeat(21) }, /1~20자/],
    [{ color1: 'red' }, /다른 색/],
    [{ color0: 'gold' }, /색 값/],
    [{ leader0: absent.id }, /결석/],
    [{ leader0: participant.id, leader1: participant.id }, /두 팀/],
    [{ leader0: outsider.id }, /팀장 값/],
    [{ leader0: '01' }, /팀장 값/],
  ];
  for (const [overrides, message] of cases) {
    await assert.rejects(teams.saveTeams(event.id, form(list, overrides)), message);
  }
  assert.deepEqual((await teams.listTeams(event.id)).map((t) => t.name), ['레드', '블루', '그린', '옐로우']);
});

test('뽑기 진행 중에는 팀 수와 팀 설정을 바꿀 수 없다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query('UPDATE events SET draw_open = true WHERE id = $1', [event.id]);
  const list = await teams.listTeams(event.id);
  await assert.rejects(teams.setTeamCount(event.id, '5'), /진행 중/);
  await assert.rejects(teams.saveTeams(event.id, form(list, { name0: '새이름' })), /진행 중/);
});
