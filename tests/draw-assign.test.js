const test = require('node:test');
const assert = require('node:assert/strict');
const { assignAll, assignLate, mulberry32 } = require('../src/services/draw-assign');

function scenario(random, withLeaders) {
  const k = 2 + Math.floor(random() * 7);
  const n = k + Math.floor(random() * (40 - k + 1));
  const people = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    groupKey: random() < 0.3 ? `solo:p${i}` : `g${Math.floor(random() * 6)}`,
  }));
  const teams = Array.from({ length: k }, (_, i) => ({
    id: `t${i}`,
    leader: withLeaders && random() < 0.5 ? people[i] : null,
  }));
  const leaderIds = new Set(teams.filter((t) => t.leader).map((t) => t.leader.id));
  return { teams, people, members: people.filter((p) => !leaderIds.has(p.id)) };
}

test('팀 인원은 항상 floor(N/k) 또는 ceil(N/k)이고 모두 정확히 한 번 배정된다', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = mulberry32(seed);
    const { teams, people, members } = scenario(random, seed % 2 === 0);
    const { assignment } = assignAll({ teams, members, random });
    assert.equal(assignment.size, members.length);
    const sizes = new Map(teams.map((t) => [t.id, t.leader ? 1 : 0]));
    for (const t of teams) if (t.leader) assert.ok(!assignment.has(t.leader.id), `seed ${seed}: 팀장이 다시 배정됨`);
    for (const m of members) {
      const teamId = assignment.get(m.id);
      assert.ok(sizes.has(teamId), `seed ${seed}: 알 수 없는 팀 ${teamId}`);
      sizes.set(teamId, sizes.get(teamId) + 1);
    }
    const lo = Math.floor(people.length / teams.length);
    for (const size of sizes.values()) {
      assert.ok(size === lo || size === lo + 1, `seed ${seed}: 팀 인원 ${[...sizes.values()]}`);
    }
  }
});

test('그룹이 팀 수 이하이고 팀장이 없으면 같은 그룹은 항상 다른 팀이다', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = mulberry32(seed);
    const k = 2 + (seed % 7);
    const members = [];
    let id = 0;
    const groupCount = 1 + Math.floor(random() * 8);
    for (let g = 0; g < groupCount; g++) {
      const size = 1 + Math.floor(random() * k);
      for (let i = 0; i < size; i++) members.push({ id: `p${id++}`, groupKey: `g${g}` });
    }
    while (members.length < k) { members.push({ id: `p${id}`, groupKey: `solo:p${id}` }); id++; }
    const teams = Array.from({ length: k }, (_, i) => ({ id: `t${i}`, leader: null }));
    const { assignment, penalty } = assignAll({ teams, members, random });
    assert.equal(penalty, 0, `seed ${seed}`);
    const seen = new Set();
    for (const m of members) {
      const key = `${m.groupKey}|${assignment.get(m.id)}`;
      assert.ok(!seen.has(key), `seed ${seed}: ${key} 중복`);
      seen.add(key);
    }
  }
});

test('팀장은 자기 팀의 한 자리와 그룹 인원으로 센다', () => {
  const teams = [{ id: 't0', leader: { id: 'L', groupKey: 'A' } }, { id: 't1', leader: null }];
  const members = [{ id: 'a', groupKey: 'A' }, { id: 'x', groupKey: 'solo:x' }, { id: 'y', groupKey: 'solo:y' }];
  for (let seed = 1; seed <= 50; seed++) {
    const { assignment, penalty } = assignAll({ teams, members, random: mulberry32(seed) });
    assert.equal(assignment.get('a'), 't1');
    assert.equal(penalty, 0);
    assert.equal([...assignment.values()].filter((t) => t === 't0').length, 1);
  }
});

test('같은 시드면 같은 결과다', () => {
  const { teams, members } = scenario(mulberry32(99), true);
  const a = assignAll({ teams, members, random: mulberry32(7) });
  const b = assignAll({ teams, members, random: mulberry32(7) });
  assert.deepEqual([...a.assignment], [...b.assignment]);
});

test('사람이 팀 수보다 적으면 오류', () => {
  const teams = [{ id: 't0', leader: null }, { id: 't1', leader: null }, { id: 't2', leader: null }];
  assert.throws(() => assignAll({ teams, members: [{ id: 'a', groupKey: 'solo:a' }] }), /팀 수/);
});

test('늦은 배정은 인원이 가장 적은 팀, 그중 그 그룹이 가장 적은 팀으로 간다', () => {
  const teams = [
    { id: 't0', size: 3, groupCount: 0 },
    { id: 't1', size: 2, groupCount: 1 },
    { id: 't2', size: 2, groupCount: 0 },
  ];
  for (let seed = 1; seed <= 20; seed++) assert.equal(assignLate({ teams, random: mulberry32(seed) }), 't2');
  const tie = [{ id: 'a', size: 1, groupCount: 0 }, { id: 'b', size: 1, groupCount: 0 }];
  const picked = new Set(Array.from({ length: 40 }, (_, i) => assignLate({ teams: tie, random: mulberry32(i + 1) })));
  assert.deepEqual([...picked].sort(), ['a', 'b']);
});

test('팀장 둘이 있어 남은 자리가 같아도 팀장의 그룹이 인원으로 세어진다', () => {
  const teams = [
    { id: 't0', leader: { id: 'L', groupKey: 'A' } },
    { id: 't1', leader: { id: 'M', groupKey: 'solo:M' } },
  ];
  const members = [{ id: 'a', groupKey: 'A' }, { id: 'x', groupKey: 'solo:x' }];
  for (let seed = 1; seed <= 50; seed++) {
    const { assignment, penalty } = assignAll({ teams, members, random: mulberry32(seed) });
    assert.equal(assignment.get('a'), 't1', `seed ${seed}`);
    assert.equal(penalty, 0, `seed ${seed}`);
  }
});

test('여러 번 시도하면 첫 시도보다 나쁘지 않고, 더 나아지는 경우가 있다', () => {
  let improved = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { teams, members } = scenario(mulberry32(seed), true);
    // 같은 시드의 첫 시도는 attempts: 1 결과와 같으므로 최선은 그보다 나쁠 수 없다
    const first = assignAll({ teams, members, random: mulberry32(seed + 1000), attempts: 1 });
    const best = assignAll({ teams, members, random: mulberry32(seed + 1000), attempts: 200 });
    assert.ok(best.penalty <= first.penalty, `seed ${seed}`);
    if (best.penalty < first.penalty) improved++;
  }
  assert.ok(improved > 0, '재시도로 나아지는 경우가 한 번도 없음');
});
