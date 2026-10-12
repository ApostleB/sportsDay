const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEvent } = require('./event-lock');
const { listTeams, paletteOf } = require('./teams');
const { assignAll, assignLate } = require('./draw-assign');

const NOT_OPEN = '팀 뽑기가 아직 열리지 않았습니다';
const ABSENT = '결석으로 표시되어 있어요. 생성자에게 알려 주세요';
const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

// 그룹이 없는 사람은 혼자인 그룹으로 친다
const groupKeyOf = (p) => (p.group_id ? `g:${p.group_id}` : `solo:${p.id}`);

function findStartProblems(teamList, people) {
  const problems = [];
  if (teamList.length < 2) problems.push('팀이 2개 이상 있어야 합니다');
  const present = people.filter((p) => p.attendance === 'present');
  if (present.length < teamList.length) {
    problems.push(`출석한 참가자(${present.length}명)가 팀 수(${teamList.length}개)보다 적습니다`);
  }
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const seen = new Set();
  for (const team of teamList) {
    const leader = team.leader_participant_id ? byId.get(String(team.leader_participant_id)) : null;
    if (!leader) continue;
    if (leader.attendance !== 'present') problems.push(`${team.name} 팀장 ${leader.name}님이 결석으로 되어 있습니다`);
    if (seen.has(String(leader.id))) problems.push(`${leader.name}님이 두 팀의 팀장으로 지정되어 있습니다`);
    seen.add(String(leader.id));
  }
  return problems;
}

async function loadPeople(client, eventId) {
  const { rows } = await client.query(
    'SELECT id, name, attendance, group_id FROM participants WHERE event_id = $1 ORDER BY id',
    [eventId],
  );
  return rows;
}

async function startProblems(eventId) {
  if (!isId(eventId)) return ['운동회를 찾을 수 없습니다'];
  const [teamList, people] = await Promise.all([listTeams(eventId), loadPeople(db, eventId)]);
  return findStartProblems(teamList, people);
}

async function start(eventId, random = Math.random) {
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (event.draw_open) throw new ValidationError('이미 팀 뽑기가 시작되었습니다');
    const teamList = await listTeams(eventId, client);
    const people = await loadPeople(client, eventId);
    const problems = findStartProblems(teamList, people);
    if (problems.length) throw new ValidationError(problems.join(' / '));

    const byId = new Map(people.map((p) => [String(p.id), p]));
    const leaderIds = new Set(teamList.filter((t) => t.leader_participant_id).map((t) => String(t.leader_participant_id)));
    const { assignment } = assignAll({
      teams: teamList.map((t) => {
        const leader = t.leader_participant_id ? byId.get(String(t.leader_participant_id)) : null;
        return { id: String(t.id), leader: leader ? { id: String(leader.id), groupKey: groupKeyOf(leader) } : null };
      }),
      members: people
        .filter((p) => p.attendance === 'present' && !leaderIds.has(String(p.id)))
        .map((p) => ({ id: String(p.id), groupKey: groupKeyOf(p) })),
      random,
    });

    const pids = [];
    const tids = [];
    for (const t of teamList) {
      if (t.leader_participant_id && byId.has(String(t.leader_participant_id))) { pids.push(String(t.leader_participant_id)); tids.push(String(t.id)); }
    }
    for (const [pid, tid] of assignment) { pids.push(pid); tids.push(tid); }

    await client.query('DELETE FROM draw_results WHERE event_id = $1', [eventId]);
    await client.query('UPDATE participants SET team_id = NULL WHERE event_id = $1', [eventId]);
    await client.query(
      `UPDATE participants p SET team_id = v.team_id
       FROM unnest($2::bigint[], $3::bigint[]) AS v(pid, team_id)
       WHERE p.event_id = $1 AND p.id = v.pid`,
      [eventId, pids, tids],
    );
    // 팀장은 시작과 동시에 공개된다
    await client.query(
      `INSERT INTO draw_results (event_id, participant_id, team_id, method)
       SELECT $1, t.leader_participant_id, t.id, 'leader' FROM teams t
       JOIN participants p ON p.id = t.leader_participant_id AND p.event_id = t.event_id
       WHERE t.event_id = $1 AND t.leader_participant_id IS NOT NULL`,
      [eventId],
    );
    await client.query('UPDATE events SET draw_open = true WHERE id = $1', [eventId]);
  });
}

async function reset(eventId, confirm) {
  if (String(confirm ?? '').trim() !== '초기화') throw new ValidationError('확인 문구로 "초기화"를 입력해 주세요');
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    await client.query('DELETE FROM draw_results WHERE event_id = $1', [eventId]);
    await client.query('UPDATE participants SET team_id = NULL WHERE event_id = $1', [eventId]);
    await client.query('UPDATE events SET draw_open = false WHERE id = $1', [eventId]);
  });
}

// 공개 기록만 읽는다. 봉투(participants.team_id)를 밖으로 내보내는 유일한 통로다
async function revealOf(client, eventId, participantId) {
  const { rows } = await client.query(
    `SELECT d.method, t.id AS team_id, t.name AS team_name, t.color, l.name AS leader_name
     FROM draw_results d
     JOIN teams t ON t.id = d.team_id AND t.event_id = d.event_id
     LEFT JOIN participants l ON l.id = t.leader_participant_id AND l.event_id = t.event_id
     WHERE d.event_id = $1 AND d.participant_id = $2`,
    [eventId, participantId],
  );
  const r = rows[0];
  if (!r) return null;
  const palette = paletteOf(r.color);
  return {
    method: r.method,
    leaderName: r.leader_name,
    team: { id: r.team_id, name: r.team_name, color: r.color, mark: palette ? palette.mark : '' },
  };
}

async function myResult(eventId, participantId) {
  if (!isId(eventId)) return null;
  if (!isId(participantId)) return null;
  return revealOf(db, eventId, participantId);
}

async function lateTeam(client, eventId, person, random) {
  const { rows } = await client.query(
    `SELECT t.id,
       (SELECT count(*)::int FROM participants p WHERE p.team_id = t.id AND p.event_id = t.event_id) AS size,
       (SELECT count(*)::int FROM participants p WHERE p.team_id = t.id AND p.event_id = t.event_id AND p.group_id = $2::bigint) AS group_count
     FROM teams t WHERE t.event_id = $1 ORDER BY t.sort_order, t.id`,
    [eventId, person.group_id],
  );
  return assignLate({ teams: rows.map((r) => ({ id: String(r.id), size: r.size, groupCount: r.group_count })), random });
}

async function open(eventId, participantId, method = 'self', random = Math.random) {
  if (method !== 'self' && method !== 'proxy') throw new ValidationError('뽑기 방식 값이 올바르지 않습니다');
  if (!isId(participantId)) return null;
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (!event.draw_open) throw new ValidationError(NOT_OPEN);
    const { rows } = await client.query('SELECT * FROM participants WHERE event_id = $1 AND id = $2', [eventId, participantId]);
    const person = rows[0];
    if (!person) return null;
    const existing = await revealOf(client, eventId, person.id);
    if (existing) return existing;
    let teamId = person.team_id;
    if (!teamId) {
      if (person.attendance !== 'present') throw new ValidationError(ABSENT);
      teamId = await lateTeam(client, eventId, person, random);
      await client.query('UPDATE participants SET team_id = $3 WHERE event_id = $1 AND id = $2', [eventId, person.id, teamId]);
    }
    await client.query(
      'INSERT INTO draw_results (event_id, participant_id, team_id, method) VALUES ($1, $2, $3, $4)',
      [eventId, person.id, teamId, method],
    );
    return revealOf(client, eventId, person.id);
  });
}

async function move(eventId, participantId, teamId) {
  if (!String(teamId ?? '').trim()) throw new ValidationError('옮길 팀을 골라 주세요');
  if (!isId(participantId) || !isId(teamId)) return null;
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (!event.draw_open) throw new ValidationError(NOT_OPEN);
    const person = (await client.query('SELECT id FROM participants WHERE event_id = $1 AND id = $2', [eventId, participantId])).rows[0];
    const team = (await client.query('SELECT id FROM teams WHERE event_id = $1 AND id = $2', [eventId, teamId])).rows[0];
    if (!person || !team) return null;
    const led = await client.query('SELECT 1 FROM teams WHERE event_id = $1 AND leader_participant_id = $2', [eventId, person.id]);
    if (led.rows[0]) throw new ValidationError('팀장은 옮길 수 없습니다. 팀장을 바꾸려면 초기화한 뒤 팀 설정에서 바꿔 주세요');
    await client.query('UPDATE participants SET team_id = $3 WHERE event_id = $1 AND id = $2', [eventId, person.id, team.id]);
    await client.query(
      `INSERT INTO draw_results (event_id, participant_id, team_id, method) VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (participant_id) DO UPDATE SET team_id = EXCLUDED.team_id, method = 'manual', drawn_at = now()
       WHERE draw_results.event_id = EXCLUDED.event_id`,
      [eventId, person.id, team.id],
    );
    return revealOf(client, eventId, person.id);
  });
}

// 생성자 진행표. 봉투는 읽지 않고 공개 기록만 읽는다
async function progress(eventId) {
  if (!isId(eventId)) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.attendance, g.name AS group_name, d.method, d.team_id AS shown_team_id,
       EXISTS (SELECT 1 FROM teams t WHERE t.event_id = p.event_id AND t.leader_participant_id = p.id) AS is_leader
     FROM participants p
     LEFT JOIN groups g ON g.id = p.group_id AND g.event_id = p.event_id
     LEFT JOIN draw_results d ON d.participant_id = p.id AND d.event_id = p.event_id
     WHERE p.event_id = $1
     ORDER BY p.created_at, p.id`,
    [eventId],
  );
  return rows;
}

async function board(eventId) {
  if (!isId(eventId)) return { teams: [], pending: 0 };
  const teamList = await listTeams(eventId);
  const { rows } = await db.query(
    `SELECT d.team_id, p.name, coalesce(t.leader_participant_id = p.id AND p.event_id = t.event_id, false) AS is_leader
     FROM draw_results d
     JOIN participants p ON p.id = d.participant_id AND p.event_id = d.event_id
     JOIN teams t ON t.id = d.team_id AND t.event_id = d.event_id
     WHERE d.event_id = $1
     ORDER BY is_leader DESC, d.drawn_at, d.id`,
    [eventId],
  );
  const { rows: pending } = await db.query(
    `SELECT count(*)::int AS n FROM participants p
     WHERE p.event_id = $1 AND p.attendance = 'present'
       AND NOT EXISTS (SELECT 1 FROM draw_results d WHERE d.participant_id = p.id)`,
    [eventId],
  );
  return {
    teams: teamList.map((t) => ({
      ...t,
      members: rows.filter((r) => String(r.team_id) === String(t.id)).map((r) => ({ name: r.name, is_leader: r.is_leader })),
    })),
    pending: pending[0].n,
  };
}

module.exports = {
  NOT_OPEN, ABSENT, findStartProblems, startProblems, start, reset, open, move, myResult, progress, board,
};
