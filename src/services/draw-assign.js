// 팀 뽑기 배정 계산. DB와 무관한 순수 함수이며 난수 함수를 받아 시드 고정 테스트를 할 수 있다

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 한 번의 시도: 팀별 정원을 정하고, 큰 그룹부터 그 그룹이 가장 적은 팀 → 남은 자리가 가장 많은 팀 순으로 채운다
function attemptOnce(teams, members, groupSize, random) {
  const k = teams.length;
  const total = members.length + teams.filter((t) => t.leader).length;
  const base = Math.floor(total / k);
  const bigger = new Set(shuffle(teams.map((t) => t.id), random).slice(0, total % k));
  const state = teams.map((t) => ({
    id: t.id,
    cap: base + (bigger.has(t.id) ? 1 : 0),
    size: t.leader ? 1 : 0,
    groups: new Map(t.leader ? [[t.leader.groupKey, 1]] : []),
  }));

  const byGroup = new Map();
  for (const m of members) {
    if (!byGroup.has(m.groupKey)) byGroup.set(m.groupKey, []);
    byGroup.get(m.groupKey).push(m);
  }
  // 섞은 뒤 안정 정렬하므로 크기가 같은 그룹끼리는 무작위 순서가 된다
  const order = shuffle([...byGroup.keys()], random).sort((a, b) => groupSize.get(b) - groupSize.get(a));

  const assignment = new Map();
  for (const key of order) {
    for (const member of shuffle(byGroup.get(key), random)) {
      const open = state.filter((s) => s.size < s.cap);
      const fewest = Math.min(...open.map((s) => s.groups.get(key) || 0));
      const spread = open.filter((s) => (s.groups.get(key) || 0) === fewest);
      const most = Math.max(...spread.map((s) => s.cap - s.size));
      const target = pick(spread.filter((s) => s.cap - s.size === most), random);
      target.size += 1;
      target.groups.set(key, (target.groups.get(key) || 0) + 1);
      assignment.set(member.id, target.id);
    }
  }

  let penalty = 0;
  for (const s of state) {
    for (const [key, n] of s.groups) penalty += Math.max(0, n - Math.ceil(groupSize.get(key) / k));
  }
  return { assignment, penalty };
}

function assignAll({ teams, members, random = Math.random, attempts = 200 }) {
  const leaders = teams.filter((t) => t.leader).map((t) => t.leader);
  if (members.length + leaders.length < teams.length) throw new Error('배정할 사람이 팀 수보다 적습니다');
  const groupSize = new Map();
  for (const person of [...members, ...leaders]) groupSize.set(person.groupKey, (groupSize.get(person.groupKey) || 0) + 1);

  let best = null;
  for (let i = 0; i < attempts; i++) {
    const result = attemptOnce(teams, members, groupSize, random);
    if (!best || result.penalty < best.penalty) best = result;
    if (best.penalty === 0) break;
  }
  return best;
}

// 시작 뒤에 봉투 없이 뽑는 사람: 인원이 가장 적은 팀 → 그 그룹이 가장 적은 팀 → 무작위
function assignLate({ teams, random = Math.random }) {
  const smallest = Math.min(...teams.map((t) => t.size));
  const small = teams.filter((t) => t.size === smallest);
  const fewest = Math.min(...small.map((t) => t.groupCount));
  return pick(small.filter((t) => t.groupCount === fewest), random).id;
}

module.exports = { mulberry32, assignAll, assignLate };
