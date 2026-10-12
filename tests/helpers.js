const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.ADMIN_PASSWORD = 'admin-test-pw';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'sportsday-test-uploads');
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

const { after } = require('node:test');
const request = require('supertest');
const db = require('../src/db');

after(() => db.pool.end());

let app;
function getApp() {
  if (!app) app = require('../src/app').createApp();
  return app;
}

async function resetDb() {
  const { migrate } = require('../db/migrate');
  await migrate();
  await db.query('TRUNCATE events, session RESTART IDENTITY CASCADE');
  require('../src/middleware/attempt-limit').resetAllLimiters();
}

const EVENT_INPUT = {
  roundNo: '3',
  title: '',
  eventDate: '2026-10-10',
  meetInfo: '이촌동 한강맨션 앞',
  creatorPin: '123456',
  creatorPinConfirm: '123456',
  creatorName: '생성자',
  creatorPersonalPin: '1111',
};

function makeEvent(overrides = {}) {
  return require('../src/services/events').createEvent({ ...EVENT_INPUT, ...overrides });
}

async function joinAgent(event, { name, pin }) {
  const agent = request.agent(getApp());
  await agent.post(`/e/${event.slug}/join`).type('form')
    .send({ name, pin, authCode: event.auth_code }).expect(302);
  return agent;
}

async function creatorAgent(event) {
  const agent = await joinAgent(event, { name: EVENT_INPUT.creatorName, pin: EVENT_INPUT.creatorPersonalPin });
  await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: EVENT_INPUT.creatorPin }).expect(302);
  return agent;
}

async function adminAgent() {
  const agent = request.agent(getApp());
  await agent.post('/admin/login').type('form').send({ password: 'admin-test-pw' }).expect(302);
  return agent;
}

// 세션 없이 참가자 행만 만든다(입장 화면을 거치지 않는 서비스 테스트용)
async function addParticipant(eventId, name, { attendance = 'present', groupId = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO participants (event_id, name, pin_hash, attendance, group_id)
     VALUES ($1, $2, 'unused-hash', $3, $4) RETURNING *`,
    [eventId, name, attendance, groupId],
  );
  return rows[0];
}

async function manitoLinks(eventId) {
  const { rows } = await db.query(
    `SELECT giver_id::text AS giver, receiver_id::text AS receiver, acknowledged_at
     FROM manito_links WHERE event_id = $1 ORDER BY giver_id`,
    [eventId],
  );
  return rows;
}

// 마니또 불변식: 출석자가 2명 이상이면 출석자 전원이 하나의 고리, 아니면 빈 순환
async function assertManitoCycle(eventId) {
  const assert = require('node:assert/strict');
  const { cycleOrder } = require('../src/services/manito-cycle');
  const links = await manitoLinks(eventId);
  const { rows } = await db.query(
    "SELECT id::text AS id FROM participants WHERE event_id = $1 AND attendance = 'present'",
    [eventId],
  );
  const ids = rows.map((r) => r.id).sort();
  if (ids.length < 2) {
    assert.deepEqual(links, [], '출석자가 2명 미만이면 순환이 비어 있어야 한다');
    return links;
  }
  assert.deepEqual(links.map((l) => l.giver).sort(), ids, 'giver가 출석자 전원과 다르다');
  assert.deepEqual(links.map((l) => l.receiver).sort(), ids, 'receiver가 출석자 전원과 다르다');
  for (const l of links) assert.notEqual(l.giver, l.receiver);
  assert.equal(cycleOrder(links).length, links.length, '하나의 고리가 아니다');
  return links;
}

module.exports = {
  getApp, resetDb, makeEvent, joinAgent, creatorAgent, adminAgent, addParticipant, manitoLinks, assertManitoCycle, request, EVENT_INPUT, db,
};
