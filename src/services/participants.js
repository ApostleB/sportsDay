const db = require('../db');
const codes = require('./codes');
const { hashPin, comparePin } = require('./pins');
const { ValidationError } = require('./errors');

const MISMATCH = '이미 사용 중인 이름이거나 PIN이 틀렸습니다';
const ATTENDANCE = ['present', 'absent'];

const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

function cleanName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < 1 || length > 20) throw new ValidationError('이름은 1~20자로 입력해 주세요');
  return name;
}

async function findByName(eventId, name) {
  const { rows } = await db.query('SELECT * FROM participants WHERE event_id = $1 AND name = $2', [eventId, name]);
  return rows[0] || null;
}

async function join(event, input) {
  if (codes.normalizeAuthCode(input.authCode) !== event.auth_code) {
    throw new ValidationError('인증코드가 올바르지 않습니다');
  }
  const name = cleanName(input.name);
  const pin = String(input.pin ?? '');
  if (!codes.isPin4(pin)) throw new ValidationError('PIN은 숫자 4자리여야 합니다');

  const existing = await findByName(event.id, name);
  if (existing) {
    if (await comparePin(pin, existing.pin_hash)) return existing;
    throw new ValidationError(MISMATCH);
  }
  if (event.status === 'closed') throw new ValidationError('종료된 운동회에는 새로 입장할 수 없습니다');

  try {
    const { rows } = await db.query(
      'INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, $2, $3) RETURNING *',
      [event.id, name, await hashPin(pin)],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new ValidationError(MISMATCH);
    throw err;
  }
}

async function listParticipants(eventId) {
  const { rows } = await db.query('SELECT * FROM participants WHERE event_id = $1 ORDER BY created_at, id', [eventId]);
  return rows;
}

async function getParticipant(eventId, id) {
  if (!isId(id)) return null;
  const { rows } = await db.query('SELECT * FROM participants WHERE event_id = $1 AND id = $2', [eventId, id]);
  return rows[0] || null;
}

async function setAttendance(eventId, id, attendance) {
  const value = String(attendance ?? '');
  if (!ATTENDANCE.includes(value)) throw new ValidationError('출석 상태 값이 올바르지 않습니다');
  if (!isId(id)) return null;
  const { rows } = await db.query(
    'UPDATE participants SET attendance = $3 WHERE event_id = $1 AND id = $2 RETURNING *',
    [eventId, id, value],
  );
  return rows[0] || null;
}

async function deleteParticipant(eventId, id) {
  if (!isId(id)) return false;
  const { rowCount } = await db.query('DELETE FROM participants WHERE event_id = $1 AND id = $2', [eventId, id]);
  return rowCount > 0;
}

async function resetPin(eventId, id, pin) {
  if (!codes.isPin4(pin)) throw new ValidationError('PIN은 숫자 4자리여야 합니다');
  if (!isId(id)) return false;
  const { rowCount } = await db.query(
    'UPDATE participants SET pin_hash = $3, pin_version = pin_version + 1 WHERE event_id = $1 AND id = $2',
    [eventId, id, await hashPin(pin)],
  );
  return rowCount > 0;
}

const duplicateName = (name) => new ValidationError(`이름 "${name}"이(가) 이미 있습니다`);

// 생성자가 직접 추가하는 참가자. 인증코드 확인 없이 이름과 개인 PIN으로 만든다
async function createParticipant(eventId, input) {
  const name = cleanName(input.name);
  const pin = String(input.pin ?? '');
  if (!codes.isPin4(pin)) throw new ValidationError('PIN은 숫자 4자리여야 합니다');
  try {
    const { rows } = await db.query(
      'INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, $2, $3) RETURNING *',
      [eventId, name, await hashPin(pin)],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw duplicateName(name);
    throw err;
  }
}

// 이름을 바꾸고, PIN을 입력했으면 PIN도 바꾼다. PIN이 바뀌면 pin_version을 올려 기존 세션을 끊는다
async function updateParticipant(eventId, id, input) {
  const name = cleanName(input.name);
  const pin = String(input.pin ?? '').trim();
  if (pin && !codes.isPin4(pin)) throw new ValidationError('PIN은 숫자 4자리여야 합니다');
  if (!isId(id)) return null;
  try {
    const { rows } = pin
      ? await db.query(
        `UPDATE participants SET name = $3, pin_hash = $4, pin_version = pin_version + 1
         WHERE event_id = $1 AND id = $2 RETURNING *`,
        [eventId, id, name, await hashPin(pin)],
      )
      : await db.query(
        'UPDATE participants SET name = $3 WHERE event_id = $1 AND id = $2 RETURNING *',
        [eventId, id, name],
      );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '23505') throw duplicateName(name);
    throw err;
  }
}

module.exports = {
  MISMATCH, cleanName, join, listParticipants, getParticipant, setAttendance, deleteParticipant, resetPin,
  createParticipant, updateParticipant,
};
