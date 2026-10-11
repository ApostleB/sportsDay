const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db');
const config = require('../config');
const { ValidationError } = require('./errors');

const isId = (value) => /^\d{1,18}$/.test(String(value));

function cleanCaption(value) {
  const caption = String(value ?? '').trim();
  if (Array.from(caption).length > 100) throw new ValidationError('설명은 100자 이하로 입력해 주세요');
  return caption;
}

async function removeFile(fileName) {
  if (!/^[\w-]+\.[a-z]+$/i.test(String(fileName))) return;
  await fs.rm(path.join(config.uploadDir, fileName), { force: true });
}

async function list(eventId) {
  const { rows } = await db.query(
    'SELECT * FROM schedule_images WHERE event_id = $1 ORDER BY sort_order, id',
    [eventId],
  );
  return rows;
}

async function add(eventId, { fileName, caption }) {
  const cleaned = cleanCaption(caption);
  const { rows } = await db.query(
    `INSERT INTO schedule_images (event_id, file_name, caption, sort_order)
     VALUES ($1, $2, $3, COALESCE((SELECT max(sort_order) + 1 FROM schedule_images WHERE event_id = $1), 0))
     RETURNING *`,
    [eventId, fileName, cleaned],
  );
  return rows[0];
}

async function updateCaption(eventId, id, caption) {
  const cleaned = cleanCaption(caption);
  if (!isId(id)) return false;
  const { rowCount } = await db.query(
    'UPDATE schedule_images SET caption = $3 WHERE event_id = $1 AND id = $2',
    [eventId, id, cleaned],
  );
  return rowCount > 0;
}

async function move(eventId, id, direction) {
  if (!isId(id)) return false;
  return db.tx(async (client) => {
    const { rows } = await client.query(
      'SELECT id FROM schedule_images WHERE event_id = $1 ORDER BY sort_order, id FOR UPDATE',
      [eventId],
    );
    const ids = rows.map((r) => r.id);
    const index = ids.indexOf(String(id));
    if (index < 0) return false;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= ids.length) return true;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    for (let i = 0; i < ids.length; i++) {
      await client.query('UPDATE schedule_images SET sort_order = $2 WHERE id = $1', [ids[i], i]);
    }
    return true;
  });
}

async function remove(eventId, id) {
  if (!isId(id)) return false;
  const { rows } = await db.query(
    'DELETE FROM schedule_images WHERE event_id = $1 AND id = $2 RETURNING file_name',
    [eventId, id],
  );
  if (!rows[0]) return false;
  try {
    await removeFile(rows[0].file_name);
  } catch (err) {
    console.error(`Failed to delete file "${rows[0].file_name}":`, err.message);
  }
  return true;
}

module.exports = { cleanCaption, removeFile, list, add, updateCaption, move, remove };
