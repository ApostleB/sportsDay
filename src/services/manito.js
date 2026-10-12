const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEvent } = require('./event-lock');
const { maskName } = require('./mask');
const { buildCycle, removeFromCycle, insertIntoCycle, cycleOrder } = require('./manito-cycle');

const CONFIRM = '다시 배정';
const MIN_ASSIGN = 3;
const TOO_FEW = `출석한 참가자가 ${MIN_ASSIGN}명 이상이어야 마니또를 배정할 수 있습니다`;
const NOT_ASSIGNED = '마니또를 먼저 배정해 주세요';
const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

async function loadLinks(client, eventId) {
  const { rows } = await client.query(
    'SELECT giver_id::text AS giver, receiver_id::text AS receiver FROM manito_links WHERE event_id = $1 ORDER BY giver_id',
    [eventId],
  );
  return rows;
}

async function presentIds(client, eventId) {
  const { rows } = await client.query(
    "SELECT id::text AS id FROM participants WHERE event_id = $1 AND attendance = 'present' ORDER BY id",
    [eventId],
  );
  return rows.map((r) => r.id);
}

// 바뀐 연결만 고친다. receiver가 바뀐 giver와 새 giver는 확인 전 상태가 된다
// 유일 제약은 트랜잭션 끝에 검사하므로 고치는 순서는 상관없다
async function applyLinks(client, eventId, before, after) {
  const prev = new Map(before.map((l) => [l.giver, l.receiver]));
  const next = new Map(after.map((l) => [l.giver, l.receiver]));
  for (const giver of prev.keys()) {
    if (!next.has(giver)) {
      await client.query('DELETE FROM manito_links WHERE event_id = $1 AND giver_id = $2', [eventId, giver]);
    }
  }
  for (const [giver, receiver] of next) {
    if (!prev.has(giver)) {
      await client.query(
        'INSERT INTO manito_links (event_id, giver_id, receiver_id) VALUES ($1, $2, $3)',
        [eventId, giver, receiver],
      );
    } else if (prev.get(giver) !== receiver) {
      await client.query(
        `UPDATE manito_links SET receiver_id = $3, updated_at = now(), acknowledged_at = NULL
         WHERE event_id = $1 AND giver_id = $2`,
        [eventId, giver, receiver],
      );
    }
  }
}

// 지금 출석한 사람 전원으로 순환을 새로 만든다. 확인 기록은 모두 사라진다
async function rebuild(client, eventId, random) {
  const ids = await presentIds(client, eventId);
  if (ids.length < MIN_ASSIGN) throw new ValidationError(TOO_FEW);
  await client.query('DELETE FROM manito_links WHERE event_id = $1', [eventId]);
  await applyLinks(client, eventId, [], buildCycle(ids, random));
}

async function assign(eventId, random = Math.random) {
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (event.manito_stage !== 'none') throw new ValidationError('이미 마니또가 배정되었습니다');
    await rebuild(client, eventId, random);
    await client.query("UPDATE events SET manito_stage = 'assigned' WHERE id = $1", [eventId]);
    return true;
  });
}

async function reassign(eventId, confirm, random = Math.random) {
  if (String(confirm ?? '').trim() !== CONFIRM) {
    throw new ValidationError(`확인 문구 "${CONFIRM}"을(를) 정확히 입력해 주세요`);
  }
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (event.manito_stage === 'opened') throw new ValidationError('공개한 뒤에는 다시 배정할 수 없습니다');
    if (event.manito_stage !== 'assigned') throw new ValidationError(NOT_ASSIGNED);
    await rebuild(client, eventId, random);
    return true;
  });
}

async function open(eventId) {
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (event.manito_stage === 'opened') throw new ValidationError('이미 공개되었습니다');
    if (event.manito_stage !== 'assigned') throw new ValidationError(NOT_ASSIGNED);
    await client.query("UPDATE events SET manito_stage = 'opened' WHERE id = $1", [eventId]);
    return true;
  });
}

async function setLocked(eventId, locked) {
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    await client.query('UPDATE events SET manito_locked = $2 WHERE id = $1', [eventId, Boolean(locked)]);
    return true;
  });
}

// 자기 giver 행만 읽는다. 받는 사람 이름은 봉투를 연 뒤에만 돌려준다
async function mine(eventId, participantId) {
  if (!isId(eventId) || !isId(participantId)) return null;
  const { rows } = await db.query(
    `SELECT e.manito_stage AS stage, l.id AS link_id, l.acknowledged_at, r.name AS receiver_name
     FROM events e
     LEFT JOIN manito_links l ON l.event_id = e.id AND l.giver_id = $2
     LEFT JOIN participants r ON r.id = l.receiver_id AND r.event_id = e.id
     WHERE e.id = $1`,
    [eventId, participantId],
  );
  const row = rows[0];
  if (!row) return null;
  const acknowledged = Boolean(row.acknowledged_at);
  return {
    stage: row.stage,
    inCycle: Boolean(row.link_id),
    acknowledged,
    receiverName: acknowledged ? row.receiver_name : null,
  };
}

async function acknowledge(eventId, participantId) {
  if (!isId(participantId)) return false;
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    const { rowCount } = await client.query(
      `UPDATE manito_links SET acknowledged_at = COALESCE(acknowledged_at, now())
       WHERE event_id = $1 AND giver_id = $2`,
      [eventId, participantId],
    );
    return rowCount > 0;
  });
}

// 운동회 상태와 연결을 한 문장으로 읽어 같은 시점의 모습을 얻는다
async function snapshot(eventId) {
  if (!isId(eventId)) return null;
  const { rows } = await db.query(
    `SELECT e.manito_stage, e.manito_locked,
       (SELECT count(*)::int FROM participants p WHERE p.event_id = e.id AND p.attendance = 'present') AS present_count,
       l.giver_id::text AS giver, l.receiver_id::text AS receiver, l.acknowledged_at, g.name AS giver_name
     FROM events e
     LEFT JOIN manito_links l ON l.event_id = e.id
     LEFT JOIN participants g ON g.id = l.giver_id AND g.event_id = e.id
     WHERE e.id = $1`,
    [eventId],
  );
  if (!rows[0]) return null;
  const links = rows.filter((r) => r.giver);
  const names = new Map(links.map((r) => [r.giver, r.giver_name]));
  return {
    stage: rows[0].manito_stage,
    locked: rows[0].manito_locked,
    presentCount: rows[0].present_count,
    size: links.length,
    acknowledgedCount: links.filter((r) => r.acknowledged_at).length,
    orderedNames: () => cycleOrder(links).map((id) => names.get(id)),
  };
}

async function map(eventId) {
  const snap = await snapshot(eventId);
  if (!snap || snap.stage !== 'opened' || snap.locked) return null;
  return snap.orderedNames();
}

// 생성자 화면용 집계. 짝이나 이름은 돌려주지 않는다
async function summary(eventId) {
  const snap = await snapshot(eventId);
  if (!snap) return null;
  const { stage, locked, size, acknowledgedCount, presentCount } = snap;
  return { stage, locked, size, acknowledgedCount, presentCount };
}

// 관리자 화면용. 이름은 여기서 마스킹해 원래 이름이 뷰에 넘어가지 않게 한다
async function adminView(eventId) {
  const snap = await snapshot(eventId);
  if (!snap) return null;
  const { stage, locked, size, acknowledgedCount, presentCount } = snap;
  return { stage, locked, size, acknowledgedCount, presentCount, cycle: snap.orderedNames().map(maskName) };
}

// 출석 변경·삭제·생성 직후 같은 트랜잭션에서 부른다. 호출자가 운동회 행을 이미 잠갔어야 한다
async function syncPresence(client, eventId, participantId, { leaving = false, random = Math.random } = {}) {
  const { rows: eventRows } = await client.query('SELECT manito_stage FROM events WHERE id = $1', [eventId]);
  if (!eventRows[0] || eventRows[0].manito_stage === 'none') return;
  const id = String(participantId);
  const { rows } = await client.query(
    'SELECT attendance FROM participants WHERE event_id = $1 AND id = $2',
    [eventId, id],
  );
  const shouldBeIn = !leaving && rows[0]?.attendance === 'present';
  const before = await loadLinks(client, eventId);
  const isIn = before.some((l) => l.giver === id);
  let after = null;
  if (isIn && !shouldBeIn) {
    after = removeFromCycle(before, id);
  } else if (!isIn && shouldBeIn) {
    if (before.length > 0) {
      after = insertIntoCycle(before, id, random);
    } else {
      // 빈 순환이면 이전에 남아 있던 사람까지 포함해 출석자가 2명 이상일 때 새로 만든다
      const ids = await presentIds(client, eventId);
      if (ids.length >= 2) after = buildCycle(ids, random);
    }
  }
  if (after) await applyLinks(client, eventId, before, after);
}

module.exports = {
  CONFIRM, MIN_ASSIGN, assign, reassign, open, setLocked, mine, acknowledge, map, summary, adminView, syncPresence,
};
