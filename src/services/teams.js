const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEditable } = require('./event-lock');

const PALETTE = [
  { key: 'red', name: '레드', mark: '●' },
  { key: 'blue', name: '블루', mark: '▲' },
  { key: 'green', name: '그린', mark: '■' },
  { key: 'yellow', name: '옐로우', mark: '★' },
  { key: 'purple', name: '퍼플', mark: '◆' },
  { key: 'orange', name: '오렌지', mark: '♥' },
  { key: 'pink', name: '핑크', mark: '♣' },
  { key: 'black', name: '블랙', mark: '✚' },
];
const MIN_TEAMS = 2;
const MAX_TEAMS = 8;
const DEFAULT_COUNT = 4;

const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));
const paletteOf = (key) => PALETTE.find((c) => c.key === key) || null;

function cleanTeamName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < 1 || length > 20) throw new ValidationError('팀 이름은 1~20자로 입력해 주세요');
  return name;
}

async function insertTeam(client, eventId, name, color, sortOrder) {
  await client.query(
    'INSERT INTO teams (event_id, name, color, sort_order) VALUES ($1, $2, $3, $4)',
    [eventId, name, color, sortOrder],
  );
}

// 운동회를 만들 때 같은 트랜잭션에서 기본 4팀을 만든다
async function insertDefaultTeams(client, eventId) {
  for (let i = 0; i < DEFAULT_COUNT; i++) await insertTeam(client, eventId, PALETTE[i].name, PALETTE[i].key, i);
}

async function listTeams(eventId, client = db) {
  const { rows } = await client.query(
    `SELECT t.*, p.name AS leader_name
     FROM teams t LEFT JOIN participants p ON p.id = t.leader_participant_id
     WHERE t.event_id = $1 ORDER BY t.sort_order, t.id`,
    [eventId],
  );
  return rows.map((t) => ({ ...t, palette: paletteOf(t.color) }));
}

// 1단계에서 만든 운동회처럼 팀이 하나도 없으면 기본 4팀을 만든다
async function ensureDefaultTeams(eventId) {
  return db.tx(async (client) => {
    const { rows } = await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    if (!rows[0]) return;
    const count = await client.query('SELECT count(*)::int AS n FROM teams WHERE event_id = $1', [eventId]);
    if (count.rows[0].n === 0) await insertDefaultTeams(client, eventId);
  });
}

async function setTeamCount(eventId, value) {
  const count = Number(value);
  if (!String(value ?? '').trim() || !Number.isInteger(count) || count < MIN_TEAMS || count > MAX_TEAMS) {
    throw new ValidationError(`팀 수는 ${MIN_TEAMS}~${MAX_TEAMS}개로 정해 주세요`);
  }
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const current = await listTeams(eventId, client);
    if (count < current.length) {
      const removeIds = current.slice(count).map((t) => t.id);
      await client.query('DELETE FROM teams WHERE event_id = $1 AND id = ANY($2::bigint[])', [eventId, removeIds]);
    }
    const kept = current.slice(0, count);
    const usedColors = new Set(kept.map((t) => t.color));
    const usedNames = new Set(kept.map((t) => t.name));
    const free = PALETTE.filter((c) => !usedColors.has(c.key));
    for (let i = current.length; i < count; i++) {
      const color = free.shift() || PALETTE[i];
      const name = usedNames.has(color.name) ? `${color.name} ${i + 1}` : color.name;
      usedNames.add(name);
      await insertTeam(client, eventId, name, color.key, i);
    }
  });
}

async function saveTeams(eventId, input) {
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const current = await listTeams(eventId, client);
    const { rows: people } = await client.query(
      'SELECT id, name, attendance FROM participants WHERE event_id = $1',
      [eventId],
    );
    const byId = new Map(people.map((p) => [String(p.id), p]));
    const names = new Set();
    const colors = new Set();
    const leaders = new Set();
    const updates = current.map((team, i) => {
      const name = cleanTeamName(input[`name${i}`]);
      if (names.has(name)) throw new ValidationError(`팀 이름 "${name}"이(가) 중복됩니다`);
      names.add(name);

      const color = String(input[`color${i}`] ?? '');
      if (!paletteOf(color)) throw new ValidationError('팀 색 값이 올바르지 않습니다');
      if (colors.has(color)) throw new ValidationError('팀마다 다른 색을 골라 주세요');
      colors.add(color);

      const leaderValue = String(input[`leader${i}`] ?? '');
      let leaderId = null;
      if (leaderValue) {
        const person = isId(leaderValue) ? byId.get(leaderValue) : null;
        if (!person) throw new ValidationError('팀장 값이 올바르지 않습니다');
        if (person.attendance !== 'present') {
          throw new ValidationError(`${person.name}님은 결석으로 되어 있어 팀장이 될 수 없습니다`);
        }
        if (leaders.has(leaderValue)) throw new ValidationError(`${person.name}님이 두 팀의 팀장으로 지정되었습니다`);
        leaders.add(leaderValue);
        leaderId = person.id;
      }
      return { id: team.id, name, color, leaderId };
    });
    for (const u of updates) {
      await client.query(
        'UPDATE teams SET name = $3, color = $4, leader_participant_id = $5 WHERE event_id = $1 AND id = $2',
        [eventId, u.id, u.name, u.color, u.leaderId],
      );
    }
  });
}

module.exports = {
  PALETTE, MIN_TEAMS, MAX_TEAMS, paletteOf, insertDefaultTeams, listTeams, ensureDefaultTeams, setTeamCount, saveTeams,
};
