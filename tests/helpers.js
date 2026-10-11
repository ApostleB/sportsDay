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

module.exports = { getApp, resetDb, makeEvent, joinAgent, creatorAgent, adminAgent, request, EVENT_INPUT, db };
