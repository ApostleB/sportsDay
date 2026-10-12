const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEditable } = require('./event-lock');

const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

function cleanGroupName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < 1 || length > 20) throw new ValidationError('그룹 이름은 1~20자로 입력해 주세요');
  return name;
}

async function listGroups(eventId) {
  const { rows } = await db.query(
    `SELECT g.*, (SELECT count(*)::int FROM participants p WHERE p.group_id = g.id) AS member_count
     FROM groups g WHERE g.event_id = $1 ORDER BY g.sort_order, g.id`,
    [eventId],
  );
  return rows;
}

async function assertNameFree(client, eventId, name, exceptId = null) {
  const { rows } = await client.query(
    'SELECT id FROM groups WHERE event_id = $1 AND name = $2 AND ($3::bigint IS NULL OR id <> $3::bigint)',
    [eventId, name, exceptId],
  );
  if (rows[0]) throw new ValidationError(`그룹 이름 "${name}"이(가) 이미 있습니다`);
}

async function createGroup(eventId, value) {
  const name = cleanGroupName(value);
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    await assertNameFree(client, eventId, name);
    const { rows } = await client.query(
      `INSERT INTO groups (event_id, name, sort_order)
       VALUES ($1, $2, (SELECT coalesce(max(sort_order), -1) + 1 FROM groups WHERE event_id = $1))
       RETURNING *`,
      [eventId, name],
    );
    return rows[0];
  });
}

async function renameGroup(eventId, id, value) {
  const name = cleanGroupName(value);
  if (!isId(id)) return null;
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    await assertNameFree(client, eventId, name, id);
    const { rows } = await client.query(
      'UPDATE groups SET name = $3 WHERE event_id = $1 AND id = $2 RETURNING *',
      [eventId, id, name],
    );
    return rows[0] || null;
  });
}

async function deleteGroup(eventId, id) {
  if (!isId(id)) return false;
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const { rowCount } = await client.query('DELETE FROM groups WHERE event_id = $1 AND id = $2', [eventId, id]);
    return rowCount > 0;
  });
}

// 폼 필드 g<참가자 id>의 값으로 소속을 바꾼다. 빈 값은 그룹 없음, 필드가 없으면 그대로 둔다
async function saveMembership(eventId, input) {
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const { rows: groupRows } = await client.query('SELECT id FROM groups WHERE event_id = $1', [eventId]);
    const groupIds = new Set(groupRows.map((g) => String(g.id)));
    const { rows: people } = await client.query('SELECT id, group_id FROM participants WHERE event_id = $1', [eventId]);
    const changes = [];
    for (const p of people) {
      const key = `g${p.id}`;
      if (!Object.hasOwn(input, key)) continue;
      const value = String(input[key] ?? '');
      if (value && !groupIds.has(value)) throw new ValidationError('그룹 값이 올바르지 않습니다');
      if (String(p.group_id ?? '') !== value) changes.push([p.id, value || null]);
    }
    for (const [pid, groupId] of changes) {
      await client.query('UPDATE participants SET group_id = $3 WHERE event_id = $1 AND id = $2', [eventId, pid, groupId]);
    }
  });
}

module.exports = { listGroups, createGroup, renameGroup, deleteGroup, saveMembership };
