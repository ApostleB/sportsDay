const db = require('../db');
const codes = require('./codes');
const { hashPin, comparePin } = require('./pins');
const { ValidationError } = require('./errors');
const { cleanName } = require('./participants');

const STATUSES = ['ready', 'live', 'closed'];
const isId = (value) => /^\d+$/.test(String(value));

function parseRoundNo(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 999) throw new ValidationError('회차는 1 이상의 숫자여야 합니다');
  return n;
}

function cleanTitle(value, roundNo) {
  const title = String(value ?? '').trim() || `제 ${roundNo}회 명량운동회`;
  if (Array.from(title).length > 50) throw new ValidationError('제목은 50자 이하로 입력해 주세요');
  return title;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text)
    && !Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  if (!valid) throw new ValidationError('날짜 형식이 올바르지 않습니다');
  return text;
}

function cleanMeetInfo(value) {
  const text = String(value ?? '').trim();
  if (text.length > 500) throw new ValidationError('집합 안내는 500자 이하로 입력해 주세요');
  return text;
}

async function createEvent(input) {
  const roundNo = parseRoundNo(input.roundNo);
  const title = cleanTitle(input.title, roundNo);
  const eventDate = parseDate(input.eventDate);
  const meetInfo = cleanMeetInfo(input.meetInfo);
  if (!codes.isPin6(input.creatorPin)) throw new ValidationError('생성자 PIN은 숫자 6자리여야 합니다');
  if (String(input.creatorPin) !== String(input.creatorPinConfirm ?? '')) {
    throw new ValidationError('생성자 PIN 확인이 일치하지 않습니다');
  }
  const creatorName = cleanName(input.creatorName);
  if (!codes.isPin4(input.creatorPersonalPin)) throw new ValidationError('개인 PIN은 숫자 4자리여야 합니다');

  const creatorPinHash = await hashPin(input.creatorPin);
  const personalPinHash = await hashPin(input.creatorPersonalPin);

  return db.tx(async (client) => {
    let event;
    for (let attempt = 0; attempt < 5 && !event; attempt++) {
      const { rows } = await client.query(
        `INSERT INTO events (slug, title, round_no, event_date, meet_info, auth_code, creator_pin_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO NOTHING RETURNING *`,
        [codes.generateSlug(), title, roundNo, eventDate, meetInfo, codes.generateAuthCode(), creatorPinHash],
      );
      event = rows[0];
    }
    if (!event) throw new Error('운동회 주소를 만들지 못했습니다');
    const { rows } = await client.query(
      'INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, $2, $3) RETURNING *',
      [event.id, creatorName, personalPinHash],
    );
    return { event, participant: rows[0] };
  });
}

async function getEventBySlug(slug) {
  const { rows } = await db.query('SELECT * FROM events WHERE slug = $1', [String(slug)]);
  return rows[0] || null;
}

async function getEventById(id) {
  if (!isId(id)) return null;
  const { rows } = await db.query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listEvents() {
  const { rows } = await db.query(
    `SELECT e.*, (SELECT count(*)::int FROM participants p WHERE p.event_id = e.id) AS participant_count
     FROM events e ORDER BY e.created_at DESC, e.id DESC`,
  );
  return rows;
}

async function updateEvent(id, input) {
  const roundNo = parseRoundNo(input.roundNo);
  const title = cleanTitle(input.title, roundNo);
  const eventDate = parseDate(input.eventDate);
  const meetInfo = cleanMeetInfo(input.meetInfo);
  const authCode = codes.normalizeAuthCode(input.authCode);
  if (!/^[A-Z0-9]{4,12}$/.test(authCode)) throw new ValidationError('인증코드는 영문·숫자 4~12자여야 합니다');
  const status = String(input.status ?? '');
  if (!STATUSES.includes(status)) throw new ValidationError('상태 값이 올바르지 않습니다');
  if (!isId(id)) return null;
  const { rows } = await db.query(
    `UPDATE events SET round_no = $2, title = $3, event_date = $4, meet_info = $5, auth_code = $6, status = $7
     WHERE id = $1 RETURNING *`,
    [id, roundNo, title, eventDate, meetInfo, authCode, status],
  );
  return rows[0] || null;
}

async function verifyCreatorPin(event, pin) {
  if (!codes.isPin6(pin)) return false;
  return comparePin(pin, event.creator_pin_hash);
}

async function setCreatorPin(id, pin) {
  if (!codes.isPin6(pin)) throw new ValidationError('생성자 PIN은 숫자 6자리여야 합니다');
  if (!isId(id)) return false;
  const { rowCount } = await db.query('UPDATE events SET creator_pin_hash = $2 WHERE id = $1', [id, await hashPin(pin)]);
  return rowCount > 0;
}

async function deleteEvent(id) {
  if (!isId(id)) return null;
  return db.tx(async (client) => {
    const { rows } = await client.query('SELECT file_name FROM schedule_images WHERE event_id = $1', [id]);
    const { rowCount } = await client.query('DELETE FROM events WHERE id = $1', [id]);
    return rowCount > 0 ? rows.map((r) => r.file_name) : null;
  });
}

module.exports = {
  createEvent, getEventBySlug, getEventById, listEvents, updateEvent, verifyCreatorPin, setCreatorPin, deleteEvent,
};
