const db = require('../db');
const { ValidationError } = require('./errors');

const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

function clean(input) {
  const title = String(input.title ?? '').trim();
  const length = Array.from(title).length;
  if (length < 1 || length > 100) throw new ValidationError('제목은 1~100자로 입력해 주세요');
  const body = String(input.body ?? '').trim();
  if (body.length > 5000) throw new ValidationError('내용은 5000자 이하로 입력해 주세요');
  const pinned = input.pinned === true || input.pinned === 'on' || input.pinned === 'true';
  return { title, body, pinned };
}

async function list(eventId) {
  const { rows } = await db.query(
    'SELECT * FROM announcements WHERE event_id = $1 ORDER BY pinned DESC, created_at DESC, id DESC',
    [eventId],
  );
  return rows;
}

async function get(eventId, id) {
  if (!isId(id)) return null;
  const { rows } = await db.query('SELECT * FROM announcements WHERE event_id = $1 AND id = $2', [eventId, id]);
  return rows[0] || null;
}

async function create(eventId, input) {
  const { title, body, pinned } = clean(input);
  const { rows } = await db.query(
    'INSERT INTO announcements (event_id, title, body, pinned) VALUES ($1, $2, $3, $4) RETURNING *',
    [eventId, title, body, pinned],
  );
  return rows[0];
}

async function update(eventId, id, input) {
  const { title, body, pinned } = clean(input);
  if (!isId(id)) return null;
  const { rows } = await db.query(
    `UPDATE announcements SET title = $3, body = $4, pinned = $5, updated_at = now()
     WHERE event_id = $1 AND id = $2 RETURNING *`,
    [eventId, id, title, body, pinned],
  );
  return rows[0] || null;
}

async function remove(eventId, id) {
  if (!isId(id)) return false;
  const { rowCount } = await db.query('DELETE FROM announcements WHERE event_id = $1 AND id = $2', [eventId, id]);
  return rowCount > 0;
}

module.exports = { list, get, create, update, remove };
