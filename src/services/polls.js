const db = require('../db');
const { ValidationError } = require('./errors');
const { tally } = require('./poll-tally');

const STATUSES = ['open', 'closed', 'revealed'];
const TRANSITIONS = { open: ['closed'], closed: ['open', 'revealed'], revealed: [] };
const CLOSED = '마감된 투표입니다';
const CONFIRM = '삭제';
const OTHER = 'other';
const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));
const length = (text) => Array.from(text).length;
const asList = (value) => (value === undefined || value === null ? [] : [].concat(value)).map(String);

function cleanPoll(input) {
  const title = String(input.title ?? '').trim();
  if (length(title) < 1 || length(title) > 50) throw new ValidationError('제목은 1~50자로 입력해 주세요');
  const labels = String(input.options ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (labels.length < 2 || labels.length > 20) throw new ValidationError('항목은 2~20개로 입력해 주세요');
  if (labels.some((label) => length(label) > 50)) throw new ValidationError('항목은 50자 이하로 입력해 주세요');
  if (new Set(labels).size !== labels.length) throw new ValidationError('같은 항목이 두 번 있습니다');
  const raw = input.maxChoices;
  const maxChoices = raw === undefined || raw === null || String(raw).trim() === '' ? 1 : Number(raw);
  if (!Number.isInteger(maxChoices) || maxChoices < 1 || maxChoices > labels.length) {
    throw new ValidationError(`최대 선택 수는 1~${labels.length} 사이로 입력해 주세요`);
  }
  const allowOther = input.allowOther === true || input.allowOther === 'on' || input.allowOther === '1';
  return { title, labels, maxChoices, anonymous: String(input.anonymous ?? '1') !== '0', allowOther };
}

async function insertOptions(client, pollId, labels) {
  for (const [i, label] of labels.entries()) {
    await client.query('INSERT INTO poll_options (poll_id, label, sort_order) VALUES ($1, $2, $3)', [pollId, label, i]);
  }
}

// 투표 행을 잠그고 그 운동회 소속인지 함께 확인한다
async function lockPoll(client, eventId, pollId) {
  const { rows } = await client.query('SELECT * FROM polls WHERE id = $1 AND event_id = $2 FOR UPDATE', [pollId, eventId]);
  return rows[0] || null;
}

async function createPoll(eventId, input) {
  if (!isId(eventId)) throw new ValidationError('운동회를 찾을 수 없습니다');
  const p = cleanPoll(input);
  return db.tx(async (client) => {
    const { rows: found } = await client.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
    if (!found.length) throw new ValidationError('운동회를 찾을 수 없습니다');
    const { rows } = await client.query(
      `INSERT INTO polls (event_id, title, anonymous, max_choices, allow_other)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [eventId, p.title, p.anonymous, p.maxChoices, p.allowOther],
    );
    await insertOptions(client, rows[0].id, p.labels);
    return rows[0];
  });
}

async function updatePoll(eventId, pollId, input) {
  if (!isId(eventId) || !isId(pollId)) return null;
  return db.tx(async (client) => {
    const poll = await lockPoll(client, eventId, pollId);
    if (!poll) return null;
    const p = cleanPoll(input);
    if (poll.status === 'revealed') throw new ValidationError('결과를 공개한 투표는 수정할 수 없습니다');
    const { rows: voters } = await client.query('SELECT 1 FROM poll_voters WHERE poll_id = $1 LIMIT 1', [pollId]);
    if (voters.length) throw new ValidationError('이미 투표한 사람이 있어 수정할 수 없습니다');
    const { rows } = await client.query(
      `UPDATE polls SET title = $2, anonymous = $3, max_choices = $4, allow_other = $5
       WHERE id = $1 RETURNING *`,
      [pollId, p.title, p.anonymous, p.maxChoices, p.allowOther],
    );
    await client.query('DELETE FROM poll_options WHERE poll_id = $1', [pollId]);
    await insertOptions(client, pollId, p.labels);
    return rows[0];
  });
}

async function deletePoll(eventId, pollId, confirm) {
  if (String(confirm ?? '').trim() !== CONFIRM) throw new ValidationError(`확인 문구 "${CONFIRM}"를 정확히 입력해 주세요`);
  if (!isId(eventId) || !isId(pollId)) return false;
  return db.tx(async (client) => {
    if (!(await lockPoll(client, eventId, pollId))) return false;
    await client.query('DELETE FROM polls WHERE id = $1', [pollId]);
    return true;
  });
}

async function setStatus(eventId, pollId, status) {
  const next = String(status ?? '');
  if (!isId(eventId) || !isId(pollId)) return null;
  return db.tx(async (client) => {
    const poll = await lockPoll(client, eventId, pollId);
    if (!poll) return null;
    if (!STATUSES.includes(next)) throw new ValidationError('상태 값이 올바르지 않습니다');
    if (!TRANSITIONS[poll.status].includes(next)) {
      if (poll.status === 'revealed') throw new ValidationError('결과를 공개한 투표는 바꿀 수 없습니다');
      if (next === 'revealed') throw new ValidationError('결과 공개는 마감한 뒤에 할 수 있습니다');
      throw new ValidationError('이미 그 상태입니다');
    }
    const { rows } = await client.query('UPDATE polls SET status = $2 WHERE id = $1 RETURNING *', [pollId, next]);
    return rows[0];
  });
}

function selectionFromInput(input) {
  const picked = asList(input.option);
  return {
    optionIds: [...new Set(picked.filter((v) => v !== OTHER))],
    other: picked.includes(OTHER) ? String(input.other ?? '') : null,
  };
}

async function vote(eventId, pollId, participantId, input) {
  if (!isId(eventId) || !isId(pollId) || !isId(participantId)) return null;
  const { optionIds, other: rawOther } = selectionFromInput(input);
  return db.tx(async (client) => {
    const poll = await lockPoll(client, eventId, pollId);
    if (!poll) return null;
    const { rows: member } = await client.query(
      'SELECT 1 FROM participants WHERE id = $1 AND event_id = $2', [participantId, eventId],
    );
    if (!member.length) return null;
    if (poll.status !== 'open') throw new ValidationError(CLOSED);
    const { rows: options } = await client.query('SELECT id::text AS id FROM poll_options WHERE poll_id = $1', [pollId]);
    const valid = new Set(options.map((o) => o.id));
    if (optionIds.some((id) => !valid.has(id))) throw new ValidationError('투표 항목이 올바르지 않습니다');
    let other = null;
    if (rawOther !== null) {
      if (!poll.allow_other) throw new ValidationError('이 투표는 기타 입력을 받지 않습니다');
      other = rawOther.trim();
      if (!other) throw new ValidationError('기타 내용을 입력해 주세요');
      if (length(other) > 50) throw new ValidationError('기타 내용은 50자 이하로 입력해 주세요');
    }
    const total = optionIds.length + (other ? 1 : 0);
    if (total < 1) throw new ValidationError('하나 이상 골라 주세요');
    if (total > poll.max_choices) throw new ValidationError(`최대 ${poll.max_choices}개까지 고를 수 있습니다`);

    await client.query('DELETE FROM poll_answers WHERE poll_id = $1 AND participant_id = $2', [pollId, participantId]);
    for (const optionId of optionIds) {
      await client.query(
        'INSERT INTO poll_answers (poll_id, option_id, participant_id) VALUES ($1, $2, $3)',
        [pollId, optionId, participantId],
      );
    }
    if (other) {
      await client.query(
        'INSERT INTO poll_answers (poll_id, other_text, participant_id) VALUES ($1, $2, $3)',
        [pollId, other, participantId],
      );
    }
    await client.query(
      `INSERT INTO poll_voters (poll_id, participant_id) VALUES ($1, $2)
       ON CONFLICT (poll_id, participant_id) DO UPDATE SET voted_at = now()`,
      [pollId, participantId],
    );
    return true;
  });
}

async function getPoll(eventId, pollId) {
  if (!isId(eventId) || !isId(pollId)) return null;
  const { rows } = await db.query('SELECT * FROM polls WHERE event_id = $1 AND id = $2', [eventId, pollId]);
  return rows[0] || null;
}

async function loadOptions(pollId) {
  const { rows } = await db.query(
    'SELECT id::text AS id, label FROM poll_options WHERE poll_id = $1 ORDER BY sort_order, id', [pollId],
  );
  return rows;
}

async function countVoters(pollId) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM poll_voters WHERE poll_id = $1', [pollId]);
  return rows[0].n;
}

// 공개된 투표만 결과를 계산한다. 이름은 비익명일 때만 쿼리에서 가져온다
async function resultsOf(poll, options) {
  if (poll.status !== 'revealed') return null;
  const { rows: answers } = await db.query(
    poll.anonymous
      ? 'SELECT option_id::text AS option_id, other_text FROM poll_answers WHERE poll_id = $1'
      : `SELECT a.option_id::text AS option_id, a.other_text, p.name
         FROM poll_answers a JOIN participants p ON p.id = a.participant_id
         WHERE a.poll_id = $1`,
    [poll.id],
  );
  return tally({ anonymous: poll.anonymous, options, answers, voterCount: await countVoters(poll.id) });
}

async function mineOf(pollId, participantId) {
  const { rows } = await db.query(
    `SELECT a.option_id::text AS option_id, a.other_text
     FROM poll_voters v
     LEFT JOIN poll_answers a ON a.poll_id = v.poll_id AND a.participant_id = v.participant_id
     LEFT JOIN poll_options o ON o.id = a.option_id
     WHERE v.poll_id = $1 AND v.participant_id = $2
     ORDER BY o.sort_order NULLS LAST, o.id`,
    [pollId, participantId],
  );
  if (!rows.length) return { voted: false, optionIds: [], other: null };
  const otherRow = rows.find((r) => r.other_text != null);
  return {
    voted: true,
    optionIds: rows.filter((r) => r.option_id != null).map((r) => r.option_id),
    other: otherRow ? otherRow.other_text : null,
  };
}

async function isMember(eventId, participantId) {
  if (!isId(eventId) || !isId(participantId)) return false;
  const { rows } = await db.query('SELECT 1 FROM participants WHERE id = $1 AND event_id = $2', [participantId, eventId]);
  return rows.length > 0;
}

async function getForParticipant(eventId, pollId, participantId) {
  if (!(await isMember(eventId, participantId))) return null;
  const poll = await getPoll(eventId, pollId);
  if (!poll) return null;
  const options = await loadOptions(poll.id);
  return { poll, options, mine: await mineOf(poll.id, participantId), results: await resultsOf(poll, options) };
}

async function getForCreator(eventId, pollId) {
  const poll = await getPoll(eventId, pollId);
  if (!poll) return null;
  const options = await loadOptions(poll.id);
  const { rows: people } = await db.query(
    `SELECT p.name, p.attendance,
       EXISTS (SELECT 1 FROM poll_voters v WHERE v.poll_id = $2 AND v.participant_id = p.id) AS voted
     FROM participants p WHERE p.event_id = $1
     ORDER BY (p.attendance = 'absent'), p.name`,
    [eventId, poll.id],
  );
  const revealed = poll.status === 'revealed';
  return {
    poll,
    options,
    voterCount: people.filter((p) => p.voted).length,
    participantCount: people.length,
    nonVoters: revealed ? null : people.filter((p) => !p.voted).map(({ name, attendance }) => ({ name, attendance })),
    results: await resultsOf(poll, options),
  };
}

function formValues(poll, options) {
  return {
    title: poll.title,
    options: options.map((o) => o.label).join('\n'),
    maxChoices: poll.max_choices,
    anonymous: poll.anonymous ? '1' : '0',
    allowOther: poll.allow_other ? 'on' : '',
  };
}

async function listForParticipant(eventId, participantId) {
  if (!(await isMember(eventId, participantId))) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.status,
       EXISTS (SELECT 1 FROM poll_voters v WHERE v.poll_id = p.id AND v.participant_id = $2) AS voted
     FROM polls p WHERE p.event_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
    [eventId, participantId],
  );
  return rows;
}

async function listWithCounts(eventId) {
  if (!isId(eventId)) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.status,
       (SELECT count(*)::int FROM poll_voters v WHERE v.poll_id = p.id) AS voter_count,
       (SELECT count(*)::int FROM participants x WHERE x.event_id = p.event_id) AS participant_count
     FROM polls p WHERE p.event_id = $1 ORDER BY p.created_at DESC, p.id DESC`,
    [eventId],
  );
  return rows;
}

async function homeSummary(eventId, participantId) {
  const list = await listForParticipant(eventId, participantId);
  const open = list.filter((p) => p.status === 'open');
  return { total: list.length, open: open.length, pending: open.filter((p) => !p.voted).length };
}

module.exports = {
  CLOSED, CONFIRM, createPoll, updatePoll, deletePoll, setStatus, vote, selectionFromInput,
  getForParticipant, getForCreator, formValues, listForParticipant, listWithCounts, homeSummary,
};
