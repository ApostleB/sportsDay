# 명량운동회 1단계(기반) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운동회 생성·입장, 세 역할(관리자·생성자·참가자) 인증, 참가자 관리, 공지, 시간표 이미지를 갖춘 Express + EJS + PostgreSQL 웹앱의 기반을 만든다.

**Architecture:** 단일 Express 5 앱이 EJS로 서버 렌더링한다. 라우터는 요청 파싱과 렌더링만, `src/services/`가 DB 접근과 규칙을 담당한다. 세션은 PostgreSQL에 저장하고 운동회별 입장 정보를 `req.session.events[eventId]`에 둔다. 실시간 갱신은 없다.

**Tech Stack:** Node 24(CommonJS), Express 5, EJS + express-ejs-layouts, pg, express-session + connect-pg-simple, bcrypt, multer, dotenv, node:test + supertest

**Spec:** `docs/superpowers/specs/2026-10-11-sportsday-foundation-design.md`

## Global Constraints

- Node.js 24 이상, CommonJS(`require`), TypeScript 사용 안 함
- PostgreSQL 17. 개발 DB `sportsday`, 테스트 DB `sportsday_test`, 역할 `sportsday`
- 참가자 개인 PIN은 숫자 4자리, 생성자 PIN은 숫자 6자리, bcrypt 해시 저장(운영 10라운드, 테스트 4라운드)
- 관리자는 `.env`의 `ADMIN_PASSWORD` 하나로 로그인(아이디 없음)
- slug는 8자(`abcdefghjkmnpqrstuvwxyz23456789`), 인증코드는 6자(`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`)로 자동 생성, 생성자가 바꿀 때는 영문·숫자 4~12자
- 기본 제목은 `제 {회차}회 명량운동회`
- 쿠키 `httpOnly`, `sameSite=lax`, 운영에서 `secure`, 만료 30일
- 업로드는 jpg·png·webp·gif, 최대 5MB
- 실시간 갱신(폴링, SSE, 소켓) 없음. 화면은 접속·새로고침 시점의 상태를 보여준다
- 상태 변경은 모두 POST
- 사용자에게 보이는 문구는 모두 한국어
- 디자인은 `docs/design/mockup.html`의 합의안을 따른다(제목 Jua, 본문 Noto Sans KR, 배경 `#FFF8EE`, 주황 `#FF8A3D`, 하늘 `#3FB6F0`, 형광펜 `#FFE66B`). 터치 영역 44px 이상
- 참가자 분류는 2단계에서 "그룹으로만 묶기"로 한다. 1단계에는 성별·덩치·운동능력 입력이 없다
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

- **한 브라우저로 두 운동회에 입장**: 두 운동회 세션이 모두 유지되어야 한다. Task 5에서 검증한다.
- **입장 중인 참가자가 삭제됨**: 다음 요청에서 에러 없이 입장 화면으로 돌아가야 한다. Task 5에서 검증한다.
- **인증코드를 소문자나 공백 섞어 입력, 이름 앞뒤 공백**: 같은 코드·같은 사람으로 인식해야 한다. Task 3에서 검증한다.
- **다른 운동회의 리소스 id를 URL에 넣음**: 공지·참가자·시간표 모두 다른 운동회 데이터를 보거나 바꿀 수 없어야 한다. Task 5, 6, 7에서 검증한다.
- **실패한 업로드나 삭제된 운동회의 이미지 파일**: 디스크에 고아 파일이 남지 않아야 한다. Task 8, 9에서 검증한다.

## File Structure

```
package.json, .gitignore, .env.example, README.md
db/migrate.js                     마이그레이션 실행기(require 가능, CLI 실행 가능)
db/migrations/001_init.sql        전체 스키마(2~4단계 테이블 포함)
src/config.js                     환경변수 로딩·검증
src/db.js                         pg Pool, query, tx
src/app.js                        createApp()
src/server.js                     listen
src/middleware/locals.js          뷰 기본 locals
src/middleware/auth.js            loadEvent, requireParticipant, requireCreator, requireAdmin, checkAdminPassword, notFound
src/routes/helpers.js             regenerate, setEventEntry, clearEventEntry, inviteUrl
src/routes/public.js              /, /go, /events/new, /events
src/routes/participant.js         /e/:slug 입장·참가자 화면, /manage 마운트
src/routes/creator.js             /e/:slug/manage/*
src/routes/upload.js              multer 설정
src/routes/admin.js               /admin/*
src/services/errors.js            ValidationError
src/services/codes.js             slug·인증코드 생성, PIN 형식 검사
src/services/pins.js              bcrypt 해시·비교
src/services/mask.js              이름 마스킹
src/services/format.js            날짜·상태 표시
src/services/events.js            운동회
src/services/participants.js      참가자
src/services/announcements.js     공지
src/services/schedules.js         시간표 이미지
src/views/**                      EJS
src/public/css/app.css
src/public/uploads/.gitkeep
tests/helpers.js                  테스트 공용(환경 설정, DB 초기화, 에이전트)
tests/*.test.js
```

---

### Task 1: 프로젝트 골격과 DB 마이그레이션

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `.env`(커밋 안 함), `README.md`
- Create: `src/config.js`, `src/db.js`, `db/migrate.js`, `db/migrations/001_init.sql`
- Create: `tests/helpers.js`, `tests/config.test.js`, `tests/migrate.test.js`

**Interfaces:**
- Produces: `config` 객체 `{ isTest, isProd, port, databaseUrl, sessionSecret, adminPassword, uploadDir, bcryptRounds }`
- Produces: `db.query(text, params) -> Promise<pg.Result>`, `db.tx(async (client) => T) -> Promise<T>`, `db.pool`
- Produces: `migrate() -> Promise<string[]>`(새로 적용한 파일명)
- Produces: `tests/helpers.js`의 `getApp, resetDb, makeEvent, joinAgent, creatorAgent, adminAgent, request, EVENT_INPUT, db`(앱·서비스는 함수 안에서 지연 로딩하므로 이후 Task에서 해당 모듈이 생기면 동작)

- [ ] **Step 1: npm 초기화와 의존성 설치**

```bash
cd /Users/verser/orca/projects/sportsDay
npm init -y
npm install express ejs express-ejs-layouts express-session connect-pg-simple pg bcrypt multer dotenv
npm install -D supertest
```

`package.json`을 아래 내용으로 맞춘다(의존성 버전은 설치된 값 유지).

```json
{
  "name": "sportsday",
  "version": "0.1.0",
  "private": true,
  "description": "명량운동회 운영 플랫폼",
  "main": "src/server.js",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "migrate": "node db/migrate.js",
    "pretest": "NODE_ENV=test node db/migrate.js",
    "test": "NODE_ENV=test node --test --test-concurrency=1"
  }
}
```

- [ ] **Step 2: 설정 파일 작성**

`.gitignore`
```
node_modules/
.env
src/public/uploads/*
!src/public/uploads/.gitkeep
```

`.env.example`
```
PORT=3000
DATABASE_URL=postgres://sportsday:CHANGE_ME@localhost:5432/sportsday
TEST_DATABASE_URL=postgres://sportsday:CHANGE_ME@localhost:5432/sportsday_test
SESSION_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_STRING
ADMIN_PASSWORD=CHANGE_ME
```

`.env`와 `.gitignore`는 이미 저장소 루트에 있다(원격 DB `bytebard.cloud:15432` 접속 정보 포함). `.env`는 덮어쓰거나 커밋하지 않는다. `.gitignore`가 위 내용과 같은지만 확인한다.

```bash
mkdir -p src/public/uploads && touch src/public/uploads/.gitkeep
```

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/config.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

function loadConfig(env) {
  return spawnSync(
    process.execPath,
    ['-e', "const c=require('./src/config');console.log(JSON.stringify({db:c.databaseUrl,rounds:c.bcryptRounds}))"],
    { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: path.join(root, 'tests', 'no-such.env'), ...env } },
  );
}

test('필수 환경변수가 없으면 변수 이름을 알려주며 실패한다', () => {
  const r = loadConfig({ NODE_ENV: 'production' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DATABASE_URL/);
});

test('테스트 환경에서는 TEST_DATABASE_URL과 낮은 bcrypt 비용을 쓴다', () => {
  const r = loadConfig({
    NODE_ENV: 'test',
    TEST_DATABASE_URL: 'postgres://t',
    DATABASE_URL: 'postgres://d',
    SESSION_SECRET: 's',
    ADMIN_PASSWORD: 'a',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { db: 'postgres://t', rounds: 4 });
});
```

`tests/helpers.js`
```js
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
```

`tests/migrate.test.js`
```js
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const { migrate } = require('../db/migrate');

test('마이그레이션은 모든 테이블을 만들고 다시 실행해도 안전하다', async () => {
  await migrate();
  assert.deepEqual(await migrate(), []);
  const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const names = rows.map((r) => r.table_name);
  for (const t of ['events', 'participants', 'groups', 'teams', 'draw_results', 'announcements',
    'schedule_images', 'manito_links', 'polls', 'poll_options', 'poll_voters', 'poll_answers',
    'session', 'schema_migrations']) {
    assert.ok(names.includes(t), `${t} 테이블이 없습니다`);
  }
});

test('date 컬럼은 문자열로 읽힌다', async () => {
  const { rows } = await db.query("SELECT '2026-10-10'::date AS d");
  assert.equal(rows[0].d, '2026-10-10');
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npm test`
Expected: FAIL. `Cannot find module '../src/db'` 또는 `./src/config`

- [ ] **Step 5: 구현**

`src/config.js`
```js
const path = require('node:path');

require('dotenv').config({ quiet: true, path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });

const isTest = process.env.NODE_ENV === 'test';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name}이(가) 필요합니다`);
  return value;
}

module.exports = {
  isTest,
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required(isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  adminPassword: required('ADMIN_PASSWORD'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads'),
  bcryptRounds: isTest ? 4 : 10,
};
```

`src/db.js`
```js
const { Pool, types } = require('pg');
const config = require('./config');

// date 컬럼을 시간대 변환 없이 'YYYY-MM-DD' 문자열로 받는다
types.setTypeParser(1082, (value) => value);

const pool = new Pool({ connectionString: config.databaseUrl });

function query(text, params) {
  return pool.query(text, params);
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
```

`db/migrate.js`
```js
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

module.exports = { migrate };

if (require.main === module) {
  migrate()
    .then((applied) => console.log(applied.length ? `적용: ${applied.join(', ')}` : '적용할 마이그레이션 없음'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
```

`db/migrations/001_init.sql`
```sql
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  round_no int NOT NULL CHECK (round_no > 0),
  event_date date,
  meet_info text NOT NULL DEFAULT '',
  auth_code text NOT NULL,
  creator_pin_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'live', 'closed')),
  manito_stage text NOT NULL DEFAULT 'none' CHECK (manito_stage IN ('none', 'assigned', 'opened')),
  manito_locked boolean NOT NULL DEFAULT false,
  draw_open boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE teams (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  leader_participant_id bigint,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE participants (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  pin_hash text NOT NULL,
  group_id bigint REFERENCES groups(id) ON DELETE SET NULL,
  team_id bigint REFERENCES teams(id) ON DELETE SET NULL,
  attendance text NOT NULL DEFAULT 'present' CHECK (attendance IN ('present', 'absent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

ALTER TABLE teams ADD CONSTRAINT teams_leader_fk
  FOREIGN KEY (leader_participant_id) REFERENCES participants(id) ON DELETE SET NULL;

CREATE TABLE draw_results (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  drawn_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE announcements (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schedule_images (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  caption text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manito_links (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  giver_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  receiver_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE (event_id, giver_id),
  UNIQUE (event_id, receiver_id),
  CHECK (giver_id <> receiver_id)
);

CREATE TABLE polls (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  anonymous boolean NOT NULL DEFAULT true,
  max_choices int NOT NULL DEFAULT 1 CHECK (max_choices >= 1),
  allow_other boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'revealed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE poll_voters (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  voted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, participant_id)
);

CREATE TABLE poll_answers (
  id bigserial PRIMARY KEY,
  poll_id bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id bigint REFERENCES poll_options(id) ON DELETE CASCADE,
  other_text text,
  participant_id bigint REFERENCES participants(id) ON DELETE CASCADE,
  CHECK (option_id IS NOT NULL OR other_text IS NOT NULL)
);

CREATE INDEX participants_event_idx ON participants (event_id);
CREATE INDEX announcements_event_idx ON announcements (event_id);
CREATE INDEX schedule_images_event_idx ON schedule_images (event_id);

-- connect-pg-simple 표준 스키마
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
```

`README.md`
````markdown
# 명량운동회

매년 여는 "제 n회 명량운동회"를 운영하는 웹 플랫폼입니다.

## 준비

1. PostgreSQL 17을 설치하고 `sportsday` 역할과 `sportsday`, `sportsday_test` DB를 만듭니다.
   자세한 명령어는 `docs/superpowers/specs/2026-10-11-sportsday-foundation-design.md`의 10절에 있습니다.
2. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
3. 아래 명령어를 실행합니다.

```bash
npm install
npm run migrate
npm run dev
```

## 테스트

```bash
npm test
```
````

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS(4개)

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json .gitignore .env.example README.md src db tests
git commit -m "chore: 프로젝트 골격과 DB 마이그레이션 구성

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 공용 유틸리티(코드 생성, PIN, 마스킹, 표시 형식)

**Files:**
- Create: `src/services/errors.js`, `src/services/codes.js`, `src/services/pins.js`, `src/services/mask.js`, `src/services/format.js`
- Test: `tests/codes.test.js`, `tests/pins.test.js`, `tests/mask.test.js`, `tests/format.test.js`

**Interfaces:**
- Produces: `class ValidationError extends Error`
- Produces: `codes.generateSlug() -> string`, `codes.generateAuthCode() -> string`, `codes.normalizeAuthCode(v) -> string`, `codes.isPin4(v) -> boolean`, `codes.isPin6(v) -> boolean`
- Produces: `pins.hashPin(pin) -> Promise<string>`, `pins.comparePin(pin, hash) -> Promise<boolean>`
- Produces: `mask.maskName(name) -> string`
- Produces: `format.fmtDate('YYYY-MM-DD') -> '2026년 10월 10일 (토)'`, `format.fmtDateTime(Date) -> '2026. 10. 10. 09:00'`(서울 시간), `format.statusLabel(status) -> '준비중'|'진행중'|'종료'`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/codes.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const codes = require('../src/services/codes');

test('slug는 혼동 문자를 뺀 소문자·숫자 8자다', () => {
  for (let i = 0; i < 200; i++) assert.match(codes.generateSlug(), /^[a-hj-km-np-z2-9]{8}$/);
});

test('인증코드는 혼동 문자를 뺀 대문자·숫자 6자다', () => {
  for (let i = 0; i < 200; i++) assert.match(codes.generateAuthCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('인증코드 정규화는 공백을 지우고 대문자로 바꾼다', () => {
  assert.equal(codes.normalizeAuthCode(' ab12cd '), 'AB12CD');
  assert.equal(codes.normalizeAuthCode(undefined), '');
});

test('PIN 형식 검사', () => {
  assert.equal(codes.isPin4('1234'), true);
  assert.equal(codes.isPin4('123'), false);
  assert.equal(codes.isPin4('12345'), false);
  assert.equal(codes.isPin4('12a4'), false);
  assert.equal(codes.isPin4(undefined), false);
  assert.equal(codes.isPin6('123456'), true);
  assert.equal(codes.isPin6('1234'), false);
});
```

`tests/pins.test.js`
```js
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPin, comparePin } = require('../src/services/pins');

test('PIN은 해시로 저장되고 비교할 수 있다', async () => {
  const hash = await hashPin('1234');
  assert.notEqual(hash, '1234');
  assert.equal(await comparePin('1234', hash), true);
  assert.equal(await comparePin('4321', hash), false);
});
```

`tests/mask.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskName } = require('../src/services/mask');

test('이름 마스킹 규칙', () => {
  assert.equal(maskName('홍길동'), '홍*동');
  assert.equal(maskName('남궁민원'), '남**원');
  assert.equal(maskName('홍길'), '홍*');
  assert.equal(maskName('김'), '*');
  assert.equal(maskName(''), '');
  assert.equal(maskName(null), '');
});
```

`tests/format.test.js`
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtDate, fmtDateTime, statusLabel } = require('../src/services/format');

test('날짜는 요일과 함께 한국어로 표시한다', () => {
  assert.equal(fmtDate('2026-10-10'), '2026년 10월 10일 (토)');
  assert.equal(fmtDate(null), '');
});

test('일시는 서울 시간으로 표시한다', () => {
  assert.match(fmtDateTime(new Date('2026-10-10T00:00:00Z')), /2026\. 10\. 10\. 09:00/);
  assert.equal(fmtDateTime(null), '');
});

test('상태 라벨', () => {
  assert.equal(statusLabel('ready'), '준비중');
  assert.equal(statusLabel('live'), '진행중');
  assert.equal(statusLabel('closed'), '종료');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/codes.test.js tests/pins.test.js tests/mask.test.js tests/format.test.js`
Expected: FAIL. `Cannot find module`

- [ ] **Step 3: 구현**

`src/services/errors.js`
```js
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { ValidationError };
```

`src/services/codes.js`
```js
const { randomInt } = require('node:crypto');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pick(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

const generateSlug = () => pick(SLUG_ALPHABET, 8);
const generateAuthCode = () => pick(CODE_ALPHABET, 6);
const normalizeAuthCode = (value) => String(value ?? '').trim().toUpperCase();
const isPin4 = (value) => /^\d{4}$/.test(String(value ?? ''));
const isPin6 = (value) => /^\d{6}$/.test(String(value ?? ''));

module.exports = { generateSlug, generateAuthCode, normalizeAuthCode, isPin4, isPin6 };
```

`src/services/pins.js`
```js
const bcrypt = require('bcrypt');
const config = require('../config');

const hashPin = (pin) => bcrypt.hash(String(pin), config.bcryptRounds);
const comparePin = (pin, hash) => bcrypt.compare(String(pin), hash);

module.exports = { hashPin, comparePin };
```

`src/services/mask.js`
```js
function maskName(name) {
  const chars = Array.from(String(name ?? ''));
  if (chars.length === 0) return '';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
}

module.exports = { maskName };
```

`src/services/format.js`
```js
const WEEKDAYS = '일월화수목금토';
const STATUS_LABELS = { ready: '준비중', live: '진행중', closed: '종료' };

const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function fmtDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

function fmtDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : '';
}

const statusLabel = (status) => STATUS_LABELS[status] || status;

module.exports = { fmtDate, fmtDateTime, statusLabel };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services tests
git commit -m "feat: 코드 생성, PIN 해시, 이름 마스킹, 표시 형식 유틸 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 운동회·참가자 서비스

**Files:**
- Create: `src/services/participants.js`, `src/services/events.js`
- Test: `tests/events.service.test.js`, `tests/participants.service.test.js`

**Interfaces:**
- Consumes: Task 1 `db`, Task 2 `codes`, `pins`, `ValidationError`
- Produces(`participants`): `cleanName(v) -> string`, `join(event, {name, pin, authCode}) -> Promise<row>`, `listParticipants(eventId) -> Promise<row[]>`, `getParticipant(eventId, id) -> Promise<row|null>`, `setAttendance(eventId, id, attendance: 'present'|'absent') -> Promise<row|null>`, `deleteParticipant(eventId, id) -> Promise<boolean>`, `resetPin(eventId, id, pin) -> Promise<boolean>`, 상수 `MISMATCH`
- Produces(`events`): `createEvent(input) -> Promise<{event, participant}>`, `getEventBySlug(slug)`, `getEventById(id) -> Promise<row|null>`, `listEvents() -> Promise<(row & {participant_count:number})[]>`, `updateEvent(id, input) -> Promise<row|null>`, `verifyCreatorPin(event, pin) -> Promise<boolean>`, `setCreatorPin(id, pin) -> Promise<boolean>`, `deleteEvent(id) -> Promise<string[]|null>`(삭제된 시간표 파일명, 없으면 null)
- 모든 id는 pg bigint이므로 문자열이다. 비교할 때 `String()`을 쓴다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/events.service.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../src/services/events');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

test('운동회를 만들면 기본 제목, slug, 인증코드, 생성자 참가자가 생긴다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(event.title, '제 3회 명량운동회');
  assert.match(event.slug, /^[a-hj-km-np-z2-9]{8}$/);
  assert.match(event.auth_code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(event.event_date, '2026-10-10');
  assert.equal(event.meet_info, '이촌동 한강맨션 앞');
  assert.equal(event.status, 'ready');
  assert.notEqual(event.creator_pin_hash, '123456');
  assert.equal(participant.name, '생성자');
  assert.equal(participant.event_id, event.id);
});

test('제목을 입력하면 그대로 쓴다', async () => {
  const { event } = await H.makeEvent({ title: '  가을 운동회 ' });
  assert.equal(event.title, '가을 운동회');
});

test('생성자 PIN을 검증한다', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await events.verifyCreatorPin(event, '123456'), true);
  assert.equal(await events.verifyCreatorPin(event, '000000'), false);
  assert.equal(await events.verifyCreatorPin(event, undefined), false);
});

test('생성 입력을 검증한다', async () => {
  const cases = [
    [{ creatorPin: '12345', creatorPinConfirm: '12345' }, /숫자 6자리/],
    [{ creatorPinConfirm: '654321' }, /확인이 일치/],
    [{ roundNo: '0' }, /회차/],
    [{ roundNo: 'abc' }, /회차/],
    [{ eventDate: '2026-13-01' }, /날짜/],
    [{ creatorName: '   ' }, /이름/],
    [{ creatorPersonalPin: '12' }, /개인 PIN/],
    [{ title: '가'.repeat(51) }, /제목/],
  ];
  for (const [patch, message] of cases) {
    await assert.rejects(H.makeEvent(patch), (e) => e instanceof ValidationError && message.test(e.message));
  }
});

test('updateEvent는 인증코드를 정규화하고 값을 검증한다', async () => {
  const { event } = await H.makeEvent();
  const updated = await events.updateEvent(event.id, {
    roundNo: '3', title: '', eventDate: '', meetInfo: '', authCode: ' abcd12 ', status: 'live',
  });
  assert.equal(updated.auth_code, 'ABCD12');
  assert.equal(updated.title, '제 3회 명량운동회');
  assert.equal(updated.event_date, null);
  assert.equal(updated.status, 'live');
  await assert.rejects(events.updateEvent(event.id, { roundNo: '3', authCode: 'ABCD12', status: 'done' }), ValidationError);
  await assert.rejects(events.updateEvent(event.id, { roundNo: '3', authCode: 'a!', status: 'live' }), ValidationError);
});

test('listEvents는 최신순이며 참가자 수를 포함한다', async () => {
  const { event: first } = await H.makeEvent();
  const { event: second } = await H.makeEvent({ roundNo: '4' });
  await H.db.query("INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, '추가', 'x')", [first.id]);
  const list = await events.listEvents();
  assert.deepEqual(list.map((e) => e.id), [second.id, first.id]);
  assert.equal(list[1].participant_count, 2);
});

test('setCreatorPin은 6자리만 받는다', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await events.setCreatorPin(event.id, '999999'), true);
  const reloaded = await events.getEventById(event.id);
  assert.equal(await events.verifyCreatorPin(reloaded, '999999'), true);
  await assert.rejects(events.setCreatorPin(event.id, '99'), ValidationError);
});

test('deleteEvent는 하위 데이터를 지우고 시간표 파일명을 돌려준다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query("INSERT INTO schedule_images (event_id, file_name) VALUES ($1, 'x.png')", [event.id]);
  assert.deepEqual(await events.deleteEvent(event.id), ['x.png']);
  assert.equal(await events.getEventById(event.id), null);
  const { rows } = await H.db.query('SELECT count(*)::int AS n FROM participants');
  assert.equal(rows[0].n, 0);
  assert.equal(await events.deleteEvent(event.id), null);
});

test('잘못된 id와 slug는 null', async () => {
  assert.equal(await events.getEventById('abc'), null);
  assert.equal(await events.getEventBySlug('nothere1'), null);
});
```

`tests/participants.service.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const participants = require('../src/services/participants');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

const isVE = (pattern) => (e) => e instanceof ValidationError && pattern.test(e.message);

test('신규 입장 후 같은 이름과 PIN으로 재입장하면 같은 참가자다', async () => {
  const { event } = await H.makeEvent();
  const p = await participants.join(event, { name: '홍길동', pin: '1234', authCode: event.auth_code });
  const again = await participants.join(event, {
    name: '  홍길동 ', pin: '1234', authCode: ` ${event.auth_code.toLowerCase()} `,
  });
  assert.equal(again.id, p.id);
});

test('같은 이름에 다른 PIN이면 거부한다', async () => {
  const { event } = await H.makeEvent();
  await participants.join(event, { name: '홍길동', pin: '1234', authCode: event.auth_code });
  await assert.rejects(
    participants.join(event, { name: '홍길동', pin: '0000', authCode: event.auth_code }),
    isVE(/이미 사용 중인 이름이거나 PIN이 틀렸습니다/),
  );
});

test('인증코드가 틀리면 거부한다', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(participants.join(event, { name: '홍길동', pin: '1234', authCode: 'WRONG1' }), isVE(/인증코드/));
});

test('이름과 PIN 형식을 검증한다', async () => {
  const { event } = await H.makeEvent();
  const base = { pin: '1234', authCode: event.auth_code };
  await assert.rejects(participants.join(event, { ...base, name: ' ' }), isVE(/이름/));
  await assert.rejects(participants.join(event, { ...base, name: '가'.repeat(21) }), isVE(/이름/));
  await assert.rejects(participants.join(event, { name: '홍길동', pin: '12a4', authCode: event.auth_code }), isVE(/4자리/));
});

test('종료된 운동회는 신규 입장만 막는다', async () => {
  const { event } = await H.makeEvent();
  const closed = { ...event, status: 'closed' };
  const existing = await participants.join(closed, { name: '생성자', pin: '1111', authCode: event.auth_code });
  assert.equal(existing.name, '생성자');
  await assert.rejects(participants.join(closed, { name: '새사람', pin: '1234', authCode: event.auth_code }), isVE(/종료/));
});

test('출석 상태를 바꾸고 잘못된 값은 거부한다', async () => {
  const { event, participant } = await H.makeEvent();
  const absent = await participants.setAttendance(event.id, participant.id, 'absent');
  assert.equal(absent.attendance, 'absent');
  const present = await participants.setAttendance(event.id, participant.id, 'present');
  assert.equal(present.attendance, 'present');
  await assert.rejects(participants.setAttendance(event.id, participant.id, 'gone'), ValidationError);
  await assert.rejects(participants.setAttendance(event.id, participant.id, undefined), ValidationError);
});

test('다른 운동회의 참가자는 수정·삭제·PIN 재설정되지 않는다', async () => {
  const { event: e1 } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  assert.equal(await participants.setAttendance(e1.id, other.id, 'absent'), null);
  assert.equal(await participants.deleteParticipant(e1.id, other.id), false);
  assert.equal(await participants.resetPin(e1.id, other.id, '9999'), false);
  assert.equal(await participants.getParticipant(e1.id, other.id), null);
});

test('PIN을 재설정하면 새 PIN으로 입장한다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(await participants.resetPin(event.id, participant.id, '9999'), true);
  const p = await participants.join(event, { name: '생성자', pin: '9999', authCode: event.auth_code });
  assert.equal(p.id, participant.id);
  await assert.rejects(participants.resetPin(event.id, participant.id, '99'), ValidationError);
});

test('참가자를 삭제한다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(await participants.deleteParticipant(event.id, participant.id), true);
  assert.deepEqual(await participants.listParticipants(event.id), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/events.service.test.js tests/participants.service.test.js`
Expected: FAIL. `Cannot find module '../src/services/events'`

- [ ] **Step 3: 구현**

`src/services/participants.js`
```js
const db = require('../db');
const codes = require('./codes');
const { hashPin, comparePin } = require('./pins');
const { ValidationError } = require('./errors');

const MISMATCH = '이미 사용 중인 이름이거나 PIN이 틀렸습니다';
const ATTENDANCE = ['present', 'absent'];

const isId = (value) => /^\d+$/.test(String(value));

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
    'UPDATE participants SET pin_hash = $3 WHERE event_id = $1 AND id = $2',
    [eventId, id, await hashPin(pin)],
  );
  return rowCount > 0;
}

module.exports = {
  MISMATCH, cleanName, join, listParticipants, getParticipant, setAttendance, deleteParticipant, resetPin,
};
```

`src/services/events.js`
```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services tests
git commit -m "feat: 운동회 생성과 참가자 입장 서비스 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 공지·시간표 서비스

**Files:**
- Create: `src/services/announcements.js`, `src/services/schedules.js`
- Test: `tests/announcements.service.test.js`, `tests/schedules.service.test.js`

**Interfaces:**
- Consumes: Task 1 `db`, `config.uploadDir`, Task 2 `ValidationError`
- Produces(`announcements`): `list(eventId)`(고정 먼저, 최신순), `get(eventId, id) -> row|null`, `create(eventId, {title, body, pinned})`, `update(eventId, id, input) -> row|null`, `remove(eventId, id) -> boolean`. `pinned`는 `'on'`, `'true'`, `true`일 때 참
- Produces(`schedules`): `list(eventId)`(sort_order, id 순), `add(eventId, {fileName, caption}) -> row`, `updateCaption(eventId, id, caption) -> boolean`, `move(eventId, id, 'up'|'down') -> boolean`, `remove(eventId, id) -> boolean`(파일도 삭제), `removeFile(fileName) -> Promise<void>`, `cleanCaption(v) -> string`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/announcements.service.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

test('목록은 고정 공지가 먼저, 그다음 최신순이다', async () => {
  const { event } = await H.makeEvent();
  await announcements.create(event.id, { title: '첫 공지', body: '' });
  await announcements.create(event.id, { title: '고정', body: '', pinned: 'on' });
  await announcements.create(event.id, { title: '둘째 공지', body: '' });
  const list = await announcements.list(event.id);
  assert.deepEqual(list.map((a) => a.title), ['고정', '둘째 공지', '첫 공지']);
});

test('제목과 내용을 검증한다', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(announcements.create(event.id, { title: '  ', body: '' }), ValidationError);
  await assert.rejects(announcements.create(event.id, { title: '가'.repeat(101), body: '' }), ValidationError);
  await assert.rejects(announcements.create(event.id, { title: '제목', body: 'a'.repeat(5001) }), ValidationError);
});

test('수정과 삭제는 같은 운동회의 공지에만 적용된다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(event.id, { title: '원래', body: '본문' });
  const updated = await announcements.update(event.id, a.id, { title: '바뀜', body: '새 본문' });
  assert.equal(updated.title, '바뀜');
  assert.equal(updated.pinned, false);
  assert.equal(await announcements.update(other.id, a.id, { title: 'x', body: '' }), null);
  assert.equal(await announcements.get(other.id, a.id), null);
  assert.equal(await announcements.remove(other.id, a.id), false);
  assert.equal(await announcements.remove(event.id, a.id), true);
  assert.equal(await announcements.get(event.id, a.id), null);
});
```

`tests/schedules.service.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedules = require('../src/services/schedules');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

function touch(name) {
  const file = path.join(process.env.UPLOAD_DIR, name);
  fs.writeFileSync(file, 'x');
  return file;
}

test('추가한 순서대로 정렬되고 위아래로 옮길 수 있다', async () => {
  const { event } = await H.makeEvent();
  const a = await schedules.add(event.id, { fileName: 'a.png', caption: 'A' });
  const b = await schedules.add(event.id, { fileName: 'b.png', caption: 'B' });
  const c = await schedules.add(event.id, { fileName: 'c.png', caption: '' });
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, b.id, c.id]);
  assert.equal(await schedules.move(event.id, c.id, 'up'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, c.id, b.id]);
  assert.equal(await schedules.move(event.id, a.id, 'up'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, c.id, b.id]);
  assert.equal(await schedules.move(event.id, a.id, 'down'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [c.id, a.id, b.id]);
});

test('설명을 수정하고 길이를 검증한다', async () => {
  const { event } = await H.makeEvent();
  const s = await schedules.add(event.id, { fileName: 'a.png', caption: '' });
  assert.equal(await schedules.updateCaption(event.id, s.id, ' 3회 시간표 '), true);
  assert.equal((await schedules.list(event.id))[0].caption, '3회 시간표');
  await assert.rejects(schedules.updateCaption(event.id, s.id, '가'.repeat(101)), ValidationError);
});

test('삭제하면 파일도 지워지고 다른 운동회의 시간표는 지울 수 없다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const file = touch('del-test.png');
  const s = await schedules.add(event.id, { fileName: 'del-test.png', caption: '' });
  assert.equal(await schedules.remove(other.id, s.id), false);
  assert.equal(fs.existsSync(file), true);
  assert.equal(await schedules.remove(event.id, s.id), true);
  assert.equal(fs.existsSync(file), false);
});

test('removeFile은 경로 조작 파일명을 무시한다', async () => {
  await schedules.removeFile('../escape.png');
  await schedules.removeFile('없는파일.png');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/announcements.service.test.js tests/schedules.service.test.js`
Expected: FAIL. `Cannot find module`

- [ ] **Step 3: 구현**

`src/services/announcements.js`
```js
const db = require('../db');
const { ValidationError } = require('./errors');

const isId = (value) => /^\d+$/.test(String(value));

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
```

`src/services/schedules.js`
```js
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db');
const config = require('../config');
const { ValidationError } = require('./errors');

const isId = (value) => /^\d+$/.test(String(value));

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
  await removeFile(rows[0].file_name);
  return true;
}

module.exports = { cleanCaption, removeFile, list, add, updateCaption, move, remove };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services tests
git commit -m "feat: 공지와 시간표 이미지 서비스 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 웹 앱 골격, 운동회 생성, 입장, 참가자 화면

**Files:**
- Create: `src/app.js`, `src/server.js`, `src/middleware/locals.js`, `src/middleware/auth.js`, `src/routes/helpers.js`, `src/routes/public.js`, `src/routes/participant.js`
- Create: `src/views/layout.ejs`, `src/views/error.ejs`, `src/views/partials/alert.ejs`, `src/views/partials/sticker.ejs`, `src/views/partials/topbar.ejs`, `src/views/public/home.ejs`, `src/views/public/new-event.ejs`, `src/views/public/join.ejs`, `src/views/participant/home.ejs`, `src/views/participant/announcement.ejs`, `src/public/css/app.css`
- Test: `tests/public.routes.test.js`, `tests/participant.routes.test.js`

**Interfaces:**
- Consumes: Task 3 `events`, `participants`, Task 4 `announcements`, `schedules`, Task 2 `format`
- Produces: `createApp() -> express.Application`
- Produces(`middleware/auth`): `loadEvent`(req.event, res.locals.event, res.locals.base=`/e/:slug`), `requireParticipant`(req.participant, req.isCreator), `requireCreator`(관리자면 바로 통과), `requireAdmin`, `checkAdminPassword(input) -> boolean`, `notFound(res)`
- Produces(`routes/helpers`): `regenerate(req) -> Promise<void>`(입장 정보와 admin 유지), `setEventEntry(req, eventId, {participantId, isCreator})`, `clearEventEntry(req, eventId)`, `inviteUrl(req, event) -> string`
- Produces: `src/routes/participant.js`가 내보내는 `/e/:slug` 라우터. Task 6에서 `/manage`를 여기에 마운트한다
- Produces: 뷰 locals 기본값 `title, wide, error, message, isAdmin, participant, isCreator, event, base, values, fmtDate, fmtDateTime, statusLabel`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/public.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const participants = require('../src/services/participants');

test.beforeEach(H.resetDb);

const app = () => H.request(H.getApp());

test('메인 페이지가 열린다', async () => {
  const res = await app().get('/').expect(200);
  assert.match(res.text, /운동회 만들기/);
});

test('운동회를 만들면 생성자로 입장된 상태로 생성 완료 화면으로 이동한다', async () => {
  const agent = H.request.agent(H.getApp());
  const res = await agent.post('/events').type('form').send(H.EVENT_INPUT).expect(302);
  const match = res.headers.location.match(/^\/e\/([a-z0-9]{8})\/manage\/created$/);
  assert.ok(match, res.headers.location);
  const home = await agent.get(`/e/${match[1]}/home`).expect(200);
  assert.match(home.text, /제 3회 명량운동회/);
  assert.match(home.text, /생성자/);
  assert.match(home.text, /관리 페이지/);
});

test('생성 폼 검증에 실패하면 400과 메시지를 보여주고 PIN 외 입력값을 유지한다', async () => {
  const res = await app().post('/events').type('form')
    .send({ ...H.EVENT_INPUT, creatorPinConfirm: '654321', meetInfo: '한강 둔치' }).expect(400);
  assert.match(res.text, /생성자 PIN 확인이 일치하지 않습니다/);
  assert.match(res.text, /한강 둔치/);
  assert.doesNotMatch(res.text, /123456/);
});

test('/go는 초대 링크나 코드로 운동회 입장 화면에 보낸다', async () => {
  let res = await app().get('/go').query({ target: 'https://example.com/e/abcd2345?code=XY12ZZ&x=1' }).expect(302);
  assert.equal(res.headers.location, '/e/abcd2345?code=XY12ZZ');
  res = await app().get('/go').query({ target: ' abcd2345 ' }).expect(302);
  assert.equal(res.headers.location, '/e/abcd2345');
  await app().get('/go').query({ target: '!!' }).expect(400);
});

test('초대 링크의 인증코드가 입장 폼에 미리 채워진다', async () => {
  const { event } = await H.makeEvent();
  const res = await app().get(`/e/${event.slug}?code=${event.auth_code}`).expect(200);
  assert.match(res.text, new RegExp(`value="${event.auth_code}"`));
});

test('없는 운동회는 404', async () => {
  await app().get('/e/zzzzzzzz').expect(404);
});

test('신규 입장하면 홈에서 이름이 보이고 같은 이름과 PIN으로 다시 입장할 수 있다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '홍길동', pin: '4321' });
  const home = await agent.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, /홍길동/);
  assert.doesNotMatch(home.text, /관리 페이지/);
  await H.joinAgent(event, { name: '홍길동', pin: '4321' });
});

test('이미 있는 이름에 PIN이 틀리면 400', async () => {
  const { event } = await H.makeEvent();
  await H.joinAgent(event, { name: '홍길동', pin: '4321' });
  const res = await app().post(`/e/${event.slug}/join`).type('form')
    .send({ name: '홍길동', pin: '0000', authCode: event.auth_code }).expect(400);
  assert.match(res.text, /이미 사용 중인 이름이거나 PIN이 틀렸습니다/);
  assert.match(res.text, /홍길동/);
});

test('인증코드가 틀리면 400', async () => {
  const { event } = await H.makeEvent();
  const res = await app().post(`/e/${event.slug}/join`).type('form')
    .send({ name: '홍길동', pin: '4321', authCode: 'WRONG9' }).expect(400);
  assert.match(res.text, /인증코드가 올바르지 않습니다/);
});

test('입장하지 않은 사용자가 홈에 오면 입장 폼으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const res = await app().get(`/e/${event.slug}/home`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
});

test('한 브라우저로 두 운동회에 동시에 입장할 수 있다', async () => {
  const { event: e1 } = await H.makeEvent();
  const { event: e2 } = await H.makeEvent({ roundNo: '4' });
  const agent = await H.joinAgent(e1, { name: '철수', pin: '1234' });
  await agent.post(`/e/${e2.slug}/join`).type('form').send({ name: '철수', pin: '1234', authCode: e2.auth_code }).expect(302);
  await agent.get(`/e/${e1.slug}/home`).expect(200);
  await agent.get(`/e/${e2.slug}/home`).expect(200);
});

test('나가기를 하면 그 운동회의 홈에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '철수', pin: '1234' });
  await agent.post(`/e/${event.slug}/logout`).expect(302);
  await agent.get(`/e/${event.slug}/home`).expect(302);
});

test('입장 중에 삭제된 참가자는 입장 폼으로 돌아간다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '영희', pin: '1234' });
  const { rows } = await H.db.query("SELECT id FROM participants WHERE name = '영희'");
  await participants.deleteParticipant(event.id, rows[0].id);
  const res = await agent.get(`/e/${event.slug}/home`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
  await agent.get(`/e/${event.slug}`).expect(200);
});
```

`tests/participant.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

test('홈에 일시, 집합 안내, 고정 우선 공지, 시간표 이미지가 보인다', async () => {
  const { event } = await H.makeEvent();
  await announcements.create(event.id, { title: '일반 공지', body: 'a' });
  await announcements.create(event.id, { title: '고정 공지', body: 'b', pinned: true });
  await schedules.add(event.id, { fileName: 'abc.png', caption: '제3회 시간표' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/home`).expect(200);
  assert.match(res.text, /2026년 10월 10일 \(토\)/);
  assert.match(res.text, /이촌동 한강맨션 앞/);
  assert.ok(res.text.indexOf('고정 공지') < res.text.indexOf('일반 공지'));
  assert.match(res.text, /\/uploads\/abc\.png/);
  assert.match(res.text, /제3회 시간표/);
});

test('공지 내용은 HTML로 해석되지 않는다', async () => {
  const { event } = await H.makeEvent();
  const a = await announcements.create(event.id, { title: '<b>굵게</b>', body: '<script>alert(1)</script>' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/announcements/${a.id}`).expect(200);
  assert.doesNotMatch(res.text, /<script>alert/);
  assert.match(res.text, /&lt;script&gt;/);
});

test('다른 운동회의 공지는 404', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(other.id, { title: '남의 공지', body: '' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await agent.get(`/e/${event.slug}/announcements/${a.id}`).expect(404);
  await agent.get(`/e/${event.slug}/announcements/abc`).expect(404);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/public.routes.test.js tests/participant.routes.test.js`
Expected: FAIL. `Cannot find module '../src/app'`

- [ ] **Step 3: 미들웨어와 라우트 구현**

`src/middleware/locals.js`
```js
const format = require('../services/format');

function locals(req, res, next) {
  Object.assign(res.locals, {
    title: '명량운동회',
    wide: false,
    error: null,
    message: null,
    isAdmin: Boolean(req.session?.admin),
    participant: null,
    isCreator: false,
    event: null,
    base: '',
    values: {},
    ...format,
  });
  next();
}

module.exports = { locals };
```

`src/middleware/auth.js`
```js
const crypto = require('node:crypto');
const config = require('../config');
const events = require('../services/events');
const participants = require('../services/participants');

function checkAdminPassword(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function notFound(res) {
  return res.status(404).render('error', { title: '찾을 수 없습니다', status: 404, message: '요청한 페이지가 없습니다' });
}

async function loadEvent(req, res, next) {
  const event = await events.getEventBySlug(req.params.slug);
  if (!event) return notFound(res);
  req.event = event;
  res.locals.event = event;
  res.locals.base = `/e/${event.slug}`;
  next();
}

async function requireParticipant(req, res, next) {
  const entry = req.session.events?.[req.event.id];
  if (!entry) return res.redirect(res.locals.base);
  const participant = await participants.getParticipant(req.event.id, entry.participantId);
  if (!participant) {
    const nextEvents = { ...req.session.events };
    delete nextEvents[req.event.id];
    req.session.events = nextEvents;
    return res.redirect(res.locals.base);
  }
  req.participant = participant;
  req.isCreator = Boolean(entry.isCreator);
  res.locals.participant = participant;
  res.locals.isCreator = req.isCreator;
  next();
}

async function requireCreator(req, res, next) {
  if (req.session.admin) {
    req.isCreator = true;
    res.locals.isCreator = true;
    return next();
  }
  return requireParticipant(req, res, () => {
    if (!req.isCreator) return res.redirect(`${res.locals.base}/manage/unlock`);
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

module.exports = { checkAdminPassword, notFound, loadEvent, requireParticipant, requireCreator, requireAdmin };
```

`src/routes/helpers.js`
```js
function regenerate(req) {
  const keep = { events: req.session.events, admin: req.session.admin };
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      if (keep.events) req.session.events = keep.events;
      if (keep.admin) req.session.admin = true;
      resolve();
    });
  });
}

function setEventEntry(req, eventId, entry) {
  req.session.events = { ...(req.session.events || {}), [eventId]: entry };
}

function clearEventEntry(req, eventId) {
  const next = { ...(req.session.events || {}) };
  delete next[eventId];
  req.session.events = next;
}

function inviteUrl(req, event) {
  return `${req.protocol}://${req.get('host')}/e/${event.slug}?code=${encodeURIComponent(event.auth_code)}`;
}

module.exports = { regenerate, setEventEntry, clearEventEntry, inviteUrl };
```

`src/routes/public.js`
```js
const express = require('express');
const events = require('../services/events');
const { ValidationError } = require('../services/errors');
const { regenerate, setEventEntry } = require('./helpers');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/home', { title: '명량운동회' });
});

router.get('/go', (req, res) => {
  const raw = String(req.query.target ?? '').trim();
  const link = raw.match(/\/e\/([a-z0-9]+)(\?[^#]*)?/);
  if (link) {
    const code = new URLSearchParams(link[2] || '').get('code');
    return res.redirect(`/e/${link[1]}${code ? `?code=${encodeURIComponent(code)}` : ''}`);
  }
  if (/^[a-z0-9]{4,20}$/.test(raw)) return res.redirect(`/e/${raw}`);
  res.status(400).render('public/home', { title: '명량운동회', error: '초대 링크 또는 운동회 코드를 확인해 주세요' });
});

router.get('/events/new', (req, res) => {
  res.render('public/new-event', { title: '운동회 만들기' });
});

router.post('/events', async (req, res) => {
  try {
    const { event, participant } = await events.createEvent(req.body);
    await regenerate(req);
    setEventEntry(req, event.id, { participantId: participant.id, isCreator: true });
    res.redirect(`/e/${event.slug}/manage/created`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    const { roundNo, title, eventDate, meetInfo, creatorName } = req.body;
    res.status(400).render('public/new-event', {
      title: '운동회 만들기',
      values: { roundNo, title, eventDate, meetInfo, creatorName },
      error: err.message,
    });
  }
});

module.exports = router;
```

`src/routes/participant.js`
```js
const express = require('express');
const participants = require('../services/participants');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const { ValidationError } = require('../services/errors');
const { loadEvent, requireParticipant, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, clearEventEntry } = require('./helpers');

const router = express.Router({ mergeParams: true });

router.use(loadEvent);

router.get('/', (req, res) => {
  if (req.session.events?.[req.event.id]) return res.redirect(`${res.locals.base}/home`);
  res.render('public/join', { title: req.event.title, values: { authCode: req.query.code || '' } });
});

router.post('/join', async (req, res) => {
  try {
    const participant = await participants.join(req.event, req.body);
    const previous = req.session.events?.[req.event.id];
    const keepCreator = Boolean(previous?.isCreator && String(previous.participantId) === String(participant.id));
    await regenerate(req);
    setEventEntry(req, req.event.id, { participantId: participant.id, isCreator: keepCreator });
    res.redirect(`${res.locals.base}/home`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).render('public/join', {
      title: req.event.title,
      values: { name: req.body.name, authCode: req.body.authCode },
      error: err.message,
    });
  }
});

router.get('/home', requireParticipant, async (req, res) => {
  const [announcementList, scheduleList] = await Promise.all([
    announcements.list(req.event.id),
    schedules.list(req.event.id),
  ]);
  res.render('participant/home', { title: req.event.title, announcements: announcementList, schedules: scheduleList });
});

router.get('/announcements/:id', requireParticipant, async (req, res) => {
  const announcement = await announcements.get(req.event.id, req.params.id);
  if (!announcement) return notFound(res);
  res.render('participant/announcement', { title: announcement.title, announcement });
});

router.post('/logout', (req, res) => {
  clearEventEntry(req, req.event.id);
  res.redirect(res.locals.base);
});

module.exports = router;
```

`src/app.js`
```js
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');
const config = require('./config');
const { pool } = require('./db');
const { locals } = require('./middleware/locals');

function createApp() {
  const app = express();
  if (config.isProd) app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(config.uploadDir));
  app.use(express.urlencoded({ extended: false }));
  // Express 5는 본문이 없으면 req.body가 undefined다
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(session({
    store: new PgStore({ pool, tableName: 'session', pruneSessionInterval: config.isTest ? false : 60 * 15 }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 60 * 60 * 1000 },
  }));
  app.use(locals);

  app.use('/', require('./routes/public'));
  app.use('/e/:slug', require('./routes/participant'));

  app.use((req, res) => {
    res.status(404).render('error', { title: '찾을 수 없습니다', status: 404, message: '요청한 페이지가 없습니다' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', {
      title: '오류',
      status: 500,
      message: config.isProd ? '서버 오류가 발생했습니다' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
```

`src/server.js`
```js
const config = require('./config');
const { createApp } = require('./app');

createApp().listen(config.port, () => {
  console.log(`명량운동회 서버: http://localhost:${config.port}`);
});
```

- [ ] **Step 4: 뷰와 스타일 작성**

디자인 기준은 `docs/design/mockup.html`이다. 아래 코드를 그대로 쓰고, 다 만든 뒤 `npm run dev`로 띄워 목업과 비교한다.

`src/views/layout.ejs`
```ejs
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%= title %></title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/app.css">
</head>
<body class="<%= wide ? 'wide' : '' %>">
  <main class="container"><%- body %></main>
</body>
</html>
```

`src/views/partials/alert.ejs`
```ejs
<% if (error) { %><p class="alert alert-error"><%= error %></p><% } %>
<% if (message) { %><p class="alert alert-ok"><%= message %></p><% } %>
```

`src/views/error.ejs`
```ejs
<section class="card center">
  <h1 class="title"><%= status %></h1>
  <p><%= message %></p>
  <a class="btn" href="/">처음으로</a>
</section>
```

`src/views/public/home.ejs`
```ejs
<header class="hero" style="padding-top: 48px">
  <h1 class="sticker" aria-label="명량운동회"><span class="back" aria-hidden="true">명량운동회</span><span class="front" aria-hidden="true">명량운동회</span></h1>
  <p class="sub">우리끼리 매년 여는 진짜 운동회</p>
</header>
<%- include('../partials/alert') %>
<form method="get" action="/go" class="card stack" style="margin-top: 32px">
  <label>초대 링크 또는 운동회 코드
    <input name="target" required placeholder="받은 링크를 붙여 넣으세요">
  </label>
  <button class="btn btn-primary">입장하기</button>
</form>
<a class="btn btn-block" href="/events/new">운동회 만들기</a>
<p class="hint center" style="margin-top: 24px">운동회를 만든 사람이 보낸 초대 링크로 바로 들어올 수도 있어요.</p>
```

`src/views/public/new-event.ejs`
```ejs
<h1 class="title">운동회 만들기</h1>
<%- include('../partials/alert') %>
<form method="post" action="/events" class="card stack">
  <label>회차
    <input name="roundNo" type="number" min="1" required value="<%= values.roundNo %>">
  </label>
  <label>제목 <small class="muted">비워 두면 "제 n회 명량운동회"</small>
    <input name="title" maxlength="50" value="<%= values.title %>">
  </label>
  <label>날짜
    <input name="eventDate" type="date" value="<%= values.eventDate %>">
  </label>
  <label>집합 안내
    <textarea name="meetInfo" rows="3"><%= values.meetInfo %></textarea>
  </label>
  <hr>
  <label>생성자 PIN (숫자 6자리)
    <input name="creatorPin" type="password" inputmode="numeric" pattern="\d{6}" maxlength="6" required>
  </label>
  <label>생성자 PIN 확인
    <input name="creatorPinConfirm" type="password" inputmode="numeric" pattern="\d{6}" maxlength="6" required>
  </label>
  <p class="hint">생성자 PIN은 관리 페이지에 들어갈 때 씁니다. 참가자에게 알려주지 마세요.</p>
  <hr>
  <label>내 이름
    <input name="creatorName" maxlength="20" required value="<%= values.creatorName %>">
  </label>
  <label>내 개인 PIN (숫자 4자리)
    <input name="creatorPersonalPin" type="password" inputmode="numeric" pattern="\d{4}" maxlength="4" required>
  </label>
  <button class="btn btn-primary">만들기</button>
</form>
```

`src/views/public/join.ejs`
```ejs
<header class="hero" style="padding-top: 24px">
  <%- include('../partials/sticker') %>
  <% if (event.event_date) { %><p class="sub"><span class="marker">집합 일시</span> <%= fmtDate(event.event_date) %></p><% } %>
</header>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/join" class="card ink stack">
  <h2>참가자 입장</h2>
  <label>이름
    <input name="name" maxlength="20" required value="<%= values.name %>">
  </label>
  <label>개인 PIN (숫자 4자리)
    <input name="pin" type="password" inputmode="numeric" pattern="\d{4}" maxlength="4" required>
    <span class="hint">처음 입장하면 지금 입력한 PIN이 내 PIN이 돼요. 다시 들어올 때 같은 이름과 PIN을 입력하세요.</span>
  </label>
  <label>인증코드
    <input name="authCode" required autocapitalize="characters" value="<%= values.authCode %>">
  </label>
  <button class="btn btn-primary">운동회 입장하기</button>
</form>
```

`src/views/participant/home.ejs`
```ejs
<%- include('../partials/topbar') %>
<header class="hero"><%- include('../partials/sticker', { compact: true }) %></header>
<section class="card ink meet">
  <span class="marker">집합 일시</span>
  <p class="when tnum"><%= event.event_date ? fmtDate(event.event_date) : '날짜 미정' %></p>
  <% if (event.meet_info) { %><p class="where pre"><%= event.meet_info %></p><% } %>
</section>
<div class="bib" aria-label="내 배번표">
  <div class="meta"><%= event.title %> 참가자</div>
  <div class="name"><%= participant.name %></div>
  <span class="badge">팀 배정 전</span>
</div>
<section class="card">
  <h2>공지</h2>
  <% if (announcements.length === 0) { %><p class="muted">아직 공지가 없습니다.</p><% } %>
  <ul class="list">
    <% announcements.forEach((a) => { %>
    <li><a href="<%= base %>/announcements/<%= a.id %>"><% if (a.pinned) { %><span class="badge badge-pin">고정</span><% } %><%= a.title %></a></li>
    <% }) %>
  </ul>
</section>
<section class="card">
  <h2>시간표</h2>
  <% if (schedules.length === 0) { %><p class="muted">아직 시간표가 없습니다.</p><% } %>
  <% schedules.forEach((s) => { %>
  <figure class="schedule">
    <a href="/uploads/<%= s.file_name %>" target="_blank" rel="noopener">
      <img src="/uploads/<%= s.file_name %>" alt="<%= s.caption || '시간표' %>" loading="lazy">
    </a>
    <figcaption class="row" style="justify-content: space-between">
      <span><%= s.caption %></span>
      <a class="btn btn-small" href="/uploads/<%= s.file_name %>" target="_blank" rel="noopener">크게 보기</a>
    </figcaption>
  </figure>
  <% }) %>
</section>
```

`src/views/participant/announcement.ejs`
```ejs
<%- include('../partials/topbar') %>
<p><a class="btn btn-small" href="<%= base %>/home">홈으로</a></p>
<article class="card">
  <h1 class="headline"><% if (announcement.pinned) { %><span class="badge badge-pin">고정</span><% } %><%= announcement.title %></h1>
  <p class="muted tnum"><%= fmtDateTime(announcement.created_at) %></p>
  <div class="pre" style="margin-top: 12px"><%= announcement.body %></div>
</article>
```

`src/views/partials/sticker.ejs` (운동회 제목 스티커. `제 n회` 부분은 주황색)
```ejs
<% const fullTitle = event.title; const prefix = '제 ' + event.round_no + '회'; const hasPrefix = fullTitle.startsWith(prefix); %>
<h1 class="sticker<%= locals.compact ? ' compact' : '' %>" aria-label="<%= fullTitle %>">
  <span class="back" aria-hidden="true"><%= fullTitle %></span>
  <span class="front" aria-hidden="true"><% if (hasPrefix) { %><span class="round"><%= prefix %></span><%= fullTitle.slice(prefix.length) %><% } else { %><%= fullTitle %><% } %></span>
</h1>
```

`src/views/partials/topbar.ejs` (참가자 화면 상단 바. 이름 칩을 누르면 나가기 버튼이 펼쳐진다)
```ejs
<header class="topbar">
  <a class="brand" href="<%= base %>/home"><%= event.title %></a>
  <div class="row" style="flex-wrap: nowrap">
    <% if (isCreator) { %><a class="btn btn-small" href="<%= base %>/manage">관리 페이지</a><% } %>
    <details class="me">
      <summary class="chip"><%= participant.name %> ▾</summary>
      <div class="menu">
        <form method="post" action="<%= base %>/logout"><button class="btn btn-small btn-danger">이 기기에서 나가기</button></form>
      </div>
    </details>
  </div>
</header>
```

`src/public/css/app.css`
```css
:root {
  --paper: #FFF8EE; --surface: #FFFFFF; --ink: #24211E; --muted: #686058; --line: #DED5CB;
  --orange: #FF8A3D; --sky: #3FB6F0; --marker: #FFE66B; --rest: #E7F5FD; --focus: #175CD3; --danger: #B42318;
  --team-red: #C93636; --team-blue: #245BC7; --team-green: #237448; --team-yellow: #F4D34E;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 400 16px/1.6 'Noto Sans KR', system-ui, sans-serif; word-break: keep-all; overflow-wrap: break-word; }
body:not(.wide) { padding-bottom: 8px; }
body:not(.wide)::after { content: ''; position: fixed; left: 0; right: 0; bottom: 0; height: 8px; background: var(--orange); }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
a { color: inherit; }
.container { max-width: 480px; margin: 0 auto; padding: 20px 16px 32px; }
body.wide .container { max-width: 960px; }
.tnum { font-variant-numeric: tabular-nums; }

/* 제목 */
.title { font: 400 28px/1.2 'Jua', sans-serif; margin: 8px 0 12px; }
.sticker { display: inline-grid; margin: 0; font: 400 clamp(34px, 9vw, 44px)/1.15 'Jua', sans-serif; letter-spacing: -.01em; }
.sticker.compact { font-size: clamp(28px, 8.5vw, 34px); line-height: 1.2; letter-spacing: -.02em; }
.sticker > span { grid-area: 1 / 1; }
.sticker .back { color: var(--ink); -webkit-text-stroke: 7px var(--ink); text-shadow: 2px 3px 0 var(--ink); }
.sticker .front { color: #fff; }
.sticker .round { color: var(--orange); }
.hero { text-align: center; padding: 12px 0 4px; }
.sub { color: var(--muted); margin: 8px 0 0; font-size: 14px; }
.headline { font: 700 22px/1.35 'Noto Sans KR', sans-serif; margin: 0 0 4px; }
.marker { display: inline-block; padding: 0 4px; font-weight: 700; background: linear-gradient(transparent 35%, var(--marker) 35%, var(--marker) 90%, transparent 90%); }

/* 상단 바 */
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 60px; margin: -20px -16px 12px; padding: 0 16px; border-bottom: 1px solid var(--line); }
.topbar .brand { min-width: 0; font: 400 18px/1.2 'Jua', sans-serif; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip { min-height: 44px; display: inline-flex; align-items: center; gap: 6px; padding: 0 14px; border: 1.5px solid var(--line); border-radius: 999px; background: var(--surface); font: 500 14px 'Noto Sans KR', sans-serif; white-space: nowrap; cursor: pointer; }
details.me { position: relative; }
details.me summary { list-style: none; }
details.me summary::-webkit-details-marker { display: none; }
details.me .menu { position: absolute; right: 0; top: 50px; z-index: 5; padding: 8px; background: var(--surface); border: 1.5px solid var(--ink); border-radius: 12px; box-shadow: 3px 4px 0 var(--ink); }

/* 카드 */
.card { margin: 12px 0; padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }
body.wide .card { padding: 20px; }
.card.ink { border: 2px solid var(--ink); }
.card h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font: 400 22px/1.3 'Jua', sans-serif; }
.card h2::before { content: ''; flex: none; width: 4px; height: 20px; border-radius: 2px; background: var(--sky); }
.meet .when { margin: 8px 0 2px; font: 700 24px/1.3 'Noto Sans KR', sans-serif; }
.meet .where { margin: 0; font-size: 18px; }

/* 배번표 */
.bib { position: relative; min-height: 136px; margin: 12px 0; padding: 22px 16px 16px; overflow: hidden; background: var(--surface); border: 2px solid var(--ink); border-radius: 16px; box-shadow: 3px 4px 0 var(--ink); }
.bib::before, .bib::after { content: ''; position: absolute; top: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--paper); border: 1.5px solid var(--ink); }
.bib::before { left: 12px; }
.bib::after { right: 12px; }
.bib .meta { color: var(--muted); font-size: 13px; }
.bib .name { margin: 2px 0 8px; font: 700 28px/1.3 'Noto Sans KR', sans-serif; }

/* 폼 */
.stack { display: grid; gap: 20px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
label { display: grid; gap: 6px; font: 500 14px/1.4 'Noto Sans KR', sans-serif; }
label.check { display: flex; align-items: center; gap: 8px; min-height: 44px; }
input, select, textarea { width: 100%; min-height: 52px; padding: 12px 14px; border: 1.5px solid var(--muted); border-radius: 10px; background: var(--surface); color: var(--ink); font: 400 16px 'Noto Sans KR', sans-serif; }
input[type=checkbox] { width: 22px; height: 22px; min-height: 22px; accent-color: var(--orange); }
input[type=file] { padding: 10px; }

/* 버튼 */
.btn { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 20px; border: 2px solid var(--ink); border-radius: 12px; background: var(--surface); color: var(--ink); font: 700 16px 'Noto Sans KR', sans-serif; text-decoration: none; cursor: pointer; box-shadow: 0 3px 0 var(--ink); transition: transform 120ms, box-shadow 120ms; }
.btn:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--ink); }
.btn:disabled { opacity: .4; cursor: default; transform: none; }
.btn-primary { background: var(--orange); }
.btn-block, form.stack > .btn { width: 100%; }
.btn-small { min-height: 44px; padding: 8px 14px; border-width: 1.5px; font-size: 14px; box-shadow: none; }
.btn-danger { color: var(--danger); border-color: var(--danger); }
.btn-ghost { background: transparent; border-color: transparent; color: var(--muted); box-shadow: none; }

/* 알림과 보조 글 */
.alert { margin: 12px 0; padding: 12px 14px; border-radius: 12px; font-size: 14px; }
.alert-error { background: #FDECEA; color: var(--danger); border: 1px solid #F4C7C3; }
.alert-ok { background: #E8F6EE; color: #1E6B41; border: 1px solid #BFE3CD; }
.hint, .muted { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.pre { white-space: pre-wrap; }
.center { text-align: center; }

/* 목록과 배지 */
.list { list-style: none; margin: 0; padding: 0; }
.list li { min-height: 48px; display: flex; align-items: center; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.list li:last-child { border-bottom: 0; }
.list a { flex: 1; text-decoration: none; }
.badge { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; padding: 4px 10px; border-radius: 999px; background: #F2E8DD; font: 700 13px/1.2 'Noto Sans KR', sans-serif; vertical-align: middle; }
.badge-pin { background: var(--orange); }

/* 시간표 */
.schedule { margin: 0 0 16px; }
.schedule img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 12px; }
.schedule figcaption { margin-top: 6px; color: var(--muted); font-size: 13px; }

/* 관리 화면 */
.nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.nav a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 14px; text-decoration: none; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
.stats div { padding: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; color: var(--muted); font-size: 13px; }
.stats strong { display: block; color: var(--ink); font: 400 30px/1.1 'Jua', sans-serif; }
.copy { margin: 0; padding: 12px; border: 1px dashed var(--line); border-radius: 10px; background: #F7F1EA; font: 400 13px/1.5 ui-monospace, monospace; word-break: break-all; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { padding: 12px; background: var(--sky); color: var(--ink); text-align: left; white-space: nowrap; }
td { height: 48px; padding: 8px 12px; border-top: 1px solid var(--line); white-space: nowrap; vertical-align: middle; }
td input, td select { width: auto; min-height: 40px; padding: 6px 10px; font-size: 14px; }
hr { margin: 0; border: 0; border-top: 1px solid var(--line); }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src tests
git commit -m "feat: 운동회 생성, 입장, 참가자 홈 화면 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 생성자 인증, 대시보드, 운동회 정보·참가자 관리

**Files:**
- Create: `src/routes/creator.js`, `src/views/partials/creator-nav.ejs`, `src/views/creator/unlock.ejs`, `src/views/creator/created.ejs`, `src/views/creator/dashboard.ejs`, `src/views/creator/event-edit.ejs`, `src/views/creator/participants.ejs`
- Modify: `src/routes/participant.js`(`module.exports` 바로 위에 `/manage` 마운트)
- Test: `tests/creator.routes.test.js`

**Interfaces:**
- Consumes: Task 5 `requireParticipant`, `requireCreator`, `regenerate`, `setEventEntry`, `inviteUrl`, Task 3 `events.verifyCreatorPin`, `events.updateEvent`, `participants.*`
- Produces: `/e/:slug/manage` 라우터(`express.Router({ mergeParams: true })`). Task 7, 8은 이 파일의 `module.exports = router;` 바로 위에 라우트를 추가한다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/creator.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../src/services/events');

test.beforeEach(H.resetDb);

async function participantId(eventId, name) {
  const { rows } = await H.db.query('SELECT id FROM participants WHERE event_id = $1 AND name = $2', [eventId, name]);
  return rows[0].id;
}

test('입장하지 않은 사용자가 관리 페이지에 오면 입장 폼으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const res = await H.request(H.getApp()).get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}`);
});

test('일반 참가자는 생성자 PIN 확인 화면으로 보낸다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/manage`).expect(302);
  assert.equal(res.headers.location, `/e/${event.slug}/manage/unlock`);
  await agent.get(`/e/${event.slug}/manage/unlock`).expect(200);
});

test('틀린 생성자 PIN은 400, 맞으면 대시보드가 열린다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  const bad = await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '000000' }).expect(400);
  assert.match(bad.text, /정보가 일치하지 않습니다/);
  const ok = await agent.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(302);
  assert.equal(ok.headers.location, `/e/${event.slug}/manage`);
  const dash = await agent.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(dash.text, /초대 링크/);
});

test('생성 완료 화면에 초대 링크와 인증코드가 있다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const res = await agent.get(`/e/${event.slug}/manage/created`).expect(200);
  assert.match(res.text, new RegExp(`/e/${event.slug}\\?code=${event.auth_code}`));
  assert.match(res.text, /다시 확인할 수 없습니다/);
});

test('운동회 정보를 수정하면 새 인증코드만 통한다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/manage/event`).type('form').send({
    roundNo: '3', title: '제 3회 명량운동회', eventDate: '2026-10-10', meetInfo: '변경된 장소', authCode: 'newcode1', status: 'live',
  }).expect(302);
  const updated = await events.getEventById(event.id);
  assert.equal(updated.auth_code, 'NEWCODE1');
  assert.equal(updated.status, 'live');
  await H.request(H.getApp()).post(`/e/${event.slug}/join`).type('form')
    .send({ name: '새사람', pin: '1234', authCode: event.auth_code }).expect(400);
});

test('운동회 정보가 잘못되면 400과 입력값 유지', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const res = await agent.post(`/e/${event.slug}/manage/event`).type('form').send({
    roundNo: '3', title: '', eventDate: '', meetInfo: '바뀐 안내', authCode: 'ABCD12', status: 'nope',
  }).expect(400);
  assert.match(res.text, /상태 값이 올바르지 않습니다/);
  assert.match(res.text, /바뀐 안내/);
});

test('참가자 출석 상태를 바꾸고 잘못된 값은 400', async () => {
  const { event } = await H.makeEvent();
  await H.joinAgent(event, { name: '철수', pin: '2222' });
  const agent = await H.creatorAgent(event);
  const id = await participantId(event.id, '철수');
  await agent.post(`/e/${event.slug}/manage/participants/${id}`).type('form')
    .send({ attendance: 'absent' }).expect(302);
  const { rows } = await H.db.query('SELECT attendance FROM participants WHERE id = $1', [id]);
  assert.equal(rows[0].attendance, 'absent');
  const page = await agent.get(`/e/${event.slug}/manage/participants`).expect(200);
  assert.match(page.text, /철수/);
  assert.doesNotMatch(page.text, /덩치|운동능력|성별/);
  const bad = await agent.post(`/e/${event.slug}/manage/participants/${id}`).type('form')
    .send({ attendance: 'gone' }).expect(400);
  assert.match(bad.text, /출석 상태 값이 올바르지 않습니다/);
});

test('참가자를 삭제할 수 있지만 본인은 삭제할 수 없다', async () => {
  const { event, participant: creator } = await H.makeEvent();
  await H.joinAgent(event, { name: '철수', pin: '2222' });
  const agent = await H.creatorAgent(event);
  const id = await participantId(event.id, '철수');
  await agent.post(`/e/${event.slug}/manage/participants/${id}/delete`).expect(302);
  const self = await agent.post(`/e/${event.slug}/manage/participants/${creator.id}/delete`).expect(400);
  assert.match(self.text, /본인은 삭제할 수 없습니다/);
  const { rows } = await H.db.query('SELECT name FROM participants WHERE event_id = $1', [event.id]);
  assert.deepEqual(rows.map((r) => r.name), ['생성자']);
});

test('다른 운동회의 참가자는 수정되지 않는다', async () => {
  const { event } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/manage/participants/${other.id}`).type('form')
    .send({ attendance: 'absent' }).expect(302);
  await agent.post(`/e/${event.slug}/manage/participants/${other.id}/delete`).expect(302);
  const { rows } = await H.db.query('SELECT attendance FROM participants WHERE id = $1', [other.id]);
  assert.equal(rows[0].attendance, 'present');
});

test('생성자 권한은 다시 입장해도 유지되지만 다른 이름으로 입장하면 사라진다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  await agent.post(`/e/${event.slug}/join`).type('form').send({ name: '생성자', pin: '1111', authCode: event.auth_code }).expect(302);
  await agent.get(`/e/${event.slug}/manage`).expect(200);
  await agent.post(`/e/${event.slug}/join`).type('form').send({ name: '다른사람', pin: '3333', authCode: event.auth_code }).expect(302);
  await agent.get(`/e/${event.slug}/manage`).expect(302);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/creator.routes.test.js`
Expected: FAIL. 관리 페이지 요청이 404

- [ ] **Step 3: 라우터 구현**

`src/routes/creator.js`
```js
const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const { ValidationError } = require('../services/errors');
const { requireParticipant, requireCreator } = require('../middleware/auth');
const { regenerate, setEventEntry, inviteUrl } = require('./helpers');

const router = express.Router({ mergeParams: true });
const manage = (res, path = '') => `${res.locals.base}/manage${path}`;

router.get('/unlock', requireParticipant, (req, res) => {
  if (req.isCreator) return res.redirect(manage(res));
  res.render('creator/unlock', { title: '생성자 확인' });
});

router.post('/unlock', requireParticipant, async (req, res) => {
  if (!(await events.verifyCreatorPin(req.event, req.body.pin))) {
    return res.status(400).render('creator/unlock', { title: '생성자 확인', error: '정보가 일치하지 않습니다' });
  }
  await regenerate(req);
  setEventEntry(req, req.event.id, { participantId: req.participant.id, isCreator: true });
  res.redirect(manage(res));
});

router.use(requireCreator);

router.get('/', async (req, res) => {
  const list = await participants.listParticipants(req.event.id);
  res.render('creator/dashboard', {
    title: '운동회 관리',
    inviteUrl: inviteUrl(req, req.event),
    total: list.length,
    present: list.filter((p) => p.attendance === 'present').length,
  });
});

router.get('/created', (req, res) => {
  res.render('creator/created', { title: '운동회가 만들어졌습니다', inviteUrl: inviteUrl(req, req.event) });
});

router.get('/event', (req, res) => {
  res.render('creator/event-edit', { title: '운동회 정보', values: req.event });
});

router.post('/event', async (req, res) => {
  try {
    await events.updateEvent(req.event.id, req.body);
    res.redirect(manage(res));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    const b = req.body;
    res.status(400).render('creator/event-edit', {
      title: '운동회 정보',
      values: {
        round_no: b.roundNo, title: b.title, event_date: b.eventDate, meet_info: b.meetInfo, auth_code: b.authCode, status: b.status,
      },
      error: err.message,
    });
  }
});

async function renderParticipants(req, res, error = null, status = 200) {
  const list = await participants.listParticipants(req.event.id);
  res.status(status).render('creator/participants', { title: '참가자 관리', wide: true, list, error });
}

router.get('/participants', (req, res) => renderParticipants(req, res));

router.post('/participants/:id', async (req, res) => {
  try {
    await participants.setAttendance(req.event.id, req.params.id, req.body.attendance);
    res.redirect(manage(res, '/participants'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderParticipants(req, res, err.message, 400);
  }
});

router.post('/participants/:id/delete', async (req, res) => {
  if (req.participant && String(req.participant.id) === String(req.params.id)) {
    return renderParticipants(req, res, '본인은 삭제할 수 없습니다', 400);
  }
  await participants.deleteParticipant(req.event.id, req.params.id);
  res.redirect(manage(res, '/participants'));
});

module.exports = router;
```

`src/routes/participant.js`의 `module.exports = router;` 바로 위에 추가:
```js
router.use('/manage', require('./creator'));
```

- [ ] **Step 4: 뷰 작성**

`src/views/partials/creator-nav.ejs`
```ejs
<nav class="nav">
  <a href="<%= base %>/manage">대시보드</a>
  <a href="<%= base %>/manage/event">운동회 정보</a>
  <a href="<%= base %>/manage/participants">참가자</a>
  <a href="<%= base %>/manage/announcements">공지</a>
  <a href="<%= base %>/manage/schedules">시간표</a>
  <a href="<%= base %>/home">참가자 화면</a>
  <% if (isAdmin) { %><a href="/admin">플랫폼 관리</a><% } %>
</nav>
```

`src/views/creator/unlock.ejs`
```ejs
<h1 class="title center">생성자 확인</h1>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/manage/unlock" class="card stack">
  <label>생성자 PIN (숫자 6자리)
    <input name="pin" type="password" inputmode="numeric" pattern="\d{6}" maxlength="6" required autofocus>
  </label>
  <button class="btn btn-primary">확인</button>
</form>
<p class="center"><a href="<%= base %>/home">참가자 화면으로</a></p>
```

`src/views/creator/created.ejs`
```ejs
<header class="hero">
  <p class="sub">제 <%= event.round_no %>회</p>
  <h1 class="title"><%= event.title %></h1>
</header>
<section class="card stack">
  <h2>초대 링크</h2>
  <p class="copy" id="invite"><%= inviteUrl %></p>
  <button class="btn" type="button" onclick="navigator.clipboard.writeText(document.getElementById('invite').textContent).then(() => { this.textContent = '복사했습니다'; })">링크 복사</button>
  <p class="hint">인증코드 <strong><%= event.auth_code %></strong> 가 링크에 들어 있습니다.</p>
</section>
<p class="alert alert-error">생성자 PIN은 다시 확인할 수 없습니다. 잊어버리면 플랫폼 관리자에게 재설정을 요청하세요.</p>
<a class="btn btn-primary" href="<%= base %>/manage">관리 페이지로</a>
```

`src/views/creator/dashboard.ejs`
```ejs
<h1 class="title"><%= event.title %></h1>
<%- include('../partials/creator-nav') %>
<section class="stats">
  <div><strong><%= total %></strong>참가자</div>
  <div><strong><%= present %></strong>참석</div>
  <div><strong><%= statusLabel(event.status) %></strong>상태</div>
</section>
<section class="card stack">
  <h2>초대 링크</h2>
  <p class="copy" id="invite"><%= inviteUrl %></p>
  <button class="btn" type="button" onclick="navigator.clipboard.writeText(document.getElementById('invite').textContent).then(() => { this.textContent = '복사했습니다'; })">링크 복사</button>
  <p class="hint">인증코드 <strong><%= event.auth_code %></strong></p>
</section>
```

`src/views/creator/event-edit.ejs`
```ejs
<h1 class="title">운동회 정보</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/manage/event" class="card stack">
  <label>회차<input name="roundNo" type="number" min="1" required value="<%= values.round_no %>"></label>
  <label>제목<input name="title" maxlength="50" value="<%= values.title %>"></label>
  <label>날짜<input name="eventDate" type="date" value="<%= values.event_date %>"></label>
  <label>집합 안내<textarea name="meetInfo" rows="3"><%= values.meet_info %></textarea></label>
  <label>인증코드 <small class="muted">영문·숫자 4~12자</small><input name="authCode" required value="<%= values.auth_code %>"></label>
  <label>상태
    <select name="status">
      <% ['ready', 'live', 'closed'].forEach((s) => { %>
      <option value="<%= s %>" <%= values.status === s ? 'selected' : '' %>><%= statusLabel(s) %></option>
      <% }) %>
    </select>
  </label>
  <p class="hint">상태가 종료이면 새 참가자는 입장할 수 없고 기존 참가자만 다시 들어올 수 있습니다.</p>
  <button class="btn btn-primary">저장</button>
</form>
```

`src/views/creator/participants.ejs`
```ejs
<h1 class="title">참가자 관리</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<p class="muted">총 <%= list.length %>명 · 참석 <%= list.filter((p) => p.attendance === 'present').length %>명</p>
<div class="table-wrap" style="margin-top:12px">
  <table>
    <thead><tr><th>이름</th><th>입장일</th><th>출석</th><th></th></tr></thead>
    <tbody>
      <% list.forEach((p) => { const f = 'p-' + p.id; %>
      <tr>
        <td><strong><%= p.name %></strong></td>
        <td class="tnum"><%= fmtDateTime(p.created_at) %></td>
        <td>
          <select name="attendance" form="<%= f %>" aria-label="<%= p.name %> 출석 상태">
            <option value="present" <%= p.attendance === 'present' ? 'selected' : '' %>>참석</option>
            <option value="absent" <%= p.attendance === 'absent' ? 'selected' : '' %>>미출석</option>
          </select>
        </td>
        <td>
          <div class="row">
            <form id="<%= f %>" method="post" action="<%= base %>/manage/participants/<%= p.id %>"><button class="btn btn-small">저장</button></form>
            <form method="post" action="<%= base %>/manage/participants/<%= p.id %>/delete" data-msg="<%= p.name %>님을 삭제할까요?" onsubmit="return confirm(this.dataset.msg)">
              <button class="btn btn-small btn-danger">삭제</button>
            </form>
          </div>
        </td>
      </tr>
      <% }) %>
    </tbody>
  </table>
</div>
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src tests
git commit -m "feat: 생성자 인증, 대시보드, 운동회 정보와 참가자 관리 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 생성자 공지 관리

**Files:**
- Modify: `src/routes/creator.js`(`module.exports = router;` 바로 위에 추가, 상단 require 추가)
- Create: `src/views/creator/announcements.ejs`, `src/views/creator/announcement-edit.ejs`
- Test: `tests/creator-announcements.routes.test.js`

**Interfaces:**
- Consumes: Task 4 `announcements.list/get/create/update/remove`, Task 5 `notFound`, Task 6 `manage(res, path)` 헬퍼와 `requireCreator` 적용 구간

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/creator-announcements.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');

test.beforeEach(H.resetDb);

test('공지를 등록하면 참가자 홈에 고정 표시와 함께 보인다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  await creator.post(`/e/${event.slug}/manage/announcements`).type('form')
    .send({ title: '집합 시간 변경', body: '7시 50분까지', pinned: 'on' }).expect(302);
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, /집합 시간 변경/);
  assert.match(home.text, /고정/);
});

test('제목이 비면 400과 입력한 내용 유지', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const res = await creator.post(`/e/${event.slug}/manage/announcements`).type('form')
    .send({ title: ' ', body: '남겨둘 내용' }).expect(400);
  assert.match(res.text, /제목은 1~100자/);
  assert.match(res.text, /남겨둘 내용/);
});

test('공지를 수정하고 삭제한다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const a = await announcements.create(event.id, { title: '원래 제목', body: '' });
  await creator.get(`/e/${event.slug}/manage/announcements/${a.id}/edit`).expect(200);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form')
    .send({ title: '바뀐 제목', body: '본문' }).expect(302);
  assert.equal((await announcements.get(event.id, a.id)).title, '바뀐 제목');
  const bad = await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form')
    .send({ title: '', body: '' }).expect(400);
  assert.match(bad.text, /제목은 1~100자/);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}/delete`).expect(302);
  assert.equal(await announcements.get(event.id, a.id), null);
});

test('다른 운동회의 공지는 수정 화면과 수정 요청이 404', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(other.id, { title: '남의 공지', body: '' });
  const creator = await H.creatorAgent(event);
  await creator.get(`/e/${event.slug}/manage/announcements/${a.id}/edit`).expect(404);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form').send({ title: '탈취', body: '' }).expect(404);
  assert.equal((await announcements.get(other.id, a.id)).title, '남의 공지');
});

test('일반 참가자는 공지를 등록할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await member.post(`/e/${event.slug}/manage/announcements`).type('form').send({ title: '몰래', body: '' }).expect(302);
  assert.deepEqual(await announcements.list(event.id), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/creator-announcements.routes.test.js`
Expected: FAIL. 공지 관리 요청이 404

- [ ] **Step 3: 라우트 구현**

`src/routes/creator.js` 상단 require에 추가:
```js
const announcements = require('../services/announcements');
const { notFound } = require('../middleware/auth');
```

`module.exports = router;` 바로 위에 추가:
```js
async function renderAnnouncements(req, res, { error = null, values = {}, status = 200 } = {}) {
  const list = await announcements.list(req.event.id);
  res.status(status).render('creator/announcements', { title: '공지 관리', list, values, error });
}

router.get('/announcements', (req, res) => renderAnnouncements(req, res));

router.post('/announcements', async (req, res) => {
  try {
    await announcements.create(req.event.id, req.body);
    res.redirect(manage(res, '/announcements'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderAnnouncements(req, res, { error: err.message, values: req.body, status: 400 });
  }
});

router.get('/announcements/:id/edit', async (req, res) => {
  const announcement = await announcements.get(req.event.id, req.params.id);
  if (!announcement) return notFound(res);
  res.render('creator/announcement-edit', { title: '공지 수정', values: announcement });
});

router.post('/announcements/:id', async (req, res) => {
  try {
    const updated = await announcements.update(req.event.id, req.params.id, req.body);
    if (!updated) return notFound(res);
    res.redirect(manage(res, '/announcements'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    if (!(await announcements.get(req.event.id, req.params.id))) return notFound(res);
    res.status(400).render('creator/announcement-edit', {
      title: '공지 수정',
      values: { id: req.params.id, title: req.body.title, body: req.body.body, pinned: req.body.pinned === 'on' },
      error: err.message,
    });
  }
});

router.post('/announcements/:id/delete', async (req, res) => {
  await announcements.remove(req.event.id, req.params.id);
  res.redirect(manage(res, '/announcements'));
});
```

- [ ] **Step 4: 뷰 작성**

`src/views/creator/announcements.ejs`
```ejs
<h1 class="title">공지 관리</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/manage/announcements" class="card stack">
  <h2>새 공지</h2>
  <label>제목<input name="title" maxlength="100" required value="<%= values.title %>"></label>
  <label>내용<textarea name="body" rows="5"><%= values.body %></textarea></label>
  <label class="check"><input type="checkbox" name="pinned" <%= values.pinned ? 'checked' : '' %>> 상단 고정</label>
  <button class="btn btn-primary">등록</button>
</form>
<section class="card">
  <h2>공지 목록</h2>
  <% if (list.length === 0) { %><p class="muted">아직 공지가 없습니다.</p><% } %>
  <ul class="list">
    <% list.forEach((a) => { %>
    <li class="row" style="justify-content: space-between">
      <span><% if (a.pinned) { %><span class="badge badge-pin">고정</span><% } %><%= a.title %> <small class="muted"><%= fmtDateTime(a.created_at) %></small></span>
      <span class="row">
        <a class="btn btn-small" href="<%= base %>/manage/announcements/<%= a.id %>/edit">수정</a>
        <form method="post" action="<%= base %>/manage/announcements/<%= a.id %>/delete" data-msg="공지를 삭제할까요?" onsubmit="return confirm(this.dataset.msg)">
          <button class="btn btn-small btn-danger">삭제</button>
        </form>
      </span>
    </li>
    <% }) %>
  </ul>
</section>
```

`src/views/creator/announcement-edit.ejs`
```ejs
<h1 class="title">공지 수정</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/manage/announcements/<%= values.id %>" class="card stack">
  <label>제목<input name="title" maxlength="100" required value="<%= values.title %>"></label>
  <label>내용<textarea name="body" rows="8"><%= values.body %></textarea></label>
  <label class="check"><input type="checkbox" name="pinned" <%= values.pinned ? 'checked' : '' %>> 상단 고정</label>
  <button class="btn btn-primary">저장</button>
</form>
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src tests
git commit -m "feat: 생성자 공지 등록·수정·삭제 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 생성자 시간표 이미지 관리

**Files:**
- Create: `src/routes/upload.js`, `src/views/creator/schedules.ejs`
- Modify: `src/routes/creator.js`(상단 require, `module.exports = router;` 바로 위에 추가)
- Test: `tests/creator-schedules.routes.test.js`

**Interfaces:**
- Consumes: Task 4 `schedules.*`, `config.uploadDir`
- Produces: `scheduleUpload`(multer 인스턴스, 필드명 `image`)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/creator-schedules.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const uploaded = (name) => path.join(process.env.UPLOAD_DIR, name);
const uploadCount = () => fs.readdirSync(process.env.UPLOAD_DIR).length;

test('이미지를 올리면 파일이 저장되고 참가자 홈에 보인다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  await creator.post(`/e/${event.slug}/manage/schedules`)
    .field('caption', '3회 시간표')
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(302);
  const [s] = await schedules.list(event.id);
  assert.match(s.file_name, /^[0-9a-f-]{36}\.png$/);
  assert.equal(s.caption, '3회 시간표');
  assert.equal(fs.existsSync(uploaded(s.file_name)), true);
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, new RegExp(s.file_name));
  await H.request(H.getApp()).get(`/uploads/${s.file_name}`).expect(200);
});

test('이미지가 아니면 400이고 파일이 남지 않는다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  const res = await creator.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
    .expect(400);
  assert.match(res.text, /jpg, png, webp, gif/);
  assert.deepEqual(await schedules.list(event.id), []);
  assert.equal(uploadCount(), before);
});

test('5MB를 넘으면 400이고 파일이 남지 않는다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  const res = await creator.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' })
    .expect(400);
  assert.match(res.text, /5MB/);
  assert.equal(uploadCount(), before);
});

test('파일 없이 올리면 400', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const res = await creator.post(`/e/${event.slug}/manage/schedules`).field('caption', '설명만').expect(400);
  assert.match(res.text, /이미지를 선택해 주세요/);
});

test('설명이 너무 길면 400이고 올린 파일은 지운다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  await creator.post(`/e/${event.slug}/manage/schedules`)
    .field('caption', '가'.repeat(101))
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(400);
  assert.equal(uploadCount(), before);
});

test('설명 수정, 순서 변경, 삭제', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  fs.writeFileSync(uploaded('route-a.png'), 'a');
  fs.writeFileSync(uploaded('route-b.png'), 'b');
  const a = await schedules.add(event.id, { fileName: 'route-a.png', caption: 'A' });
  const b = await schedules.add(event.id, { fileName: 'route-b.png', caption: 'B' });
  await creator.post(`/e/${event.slug}/manage/schedules/${a.id}`).type('form').send({ caption: '새 설명' }).expect(302);
  await creator.post(`/e/${event.slug}/manage/schedules/${b.id}/move`).type('form').send({ direction: 'up' }).expect(302);
  const list = await schedules.list(event.id);
  assert.deepEqual(list.map((s) => s.id), [b.id, a.id]);
  assert.equal(list[1].caption, '새 설명');
  await creator.post(`/e/${event.slug}/manage/schedules/${a.id}/delete`).expect(302);
  assert.equal(fs.existsSync(uploaded('route-a.png')), false);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [b.id]);
});

test('일반 참가자는 시간표를 올릴 수 없다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await member.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(302);
  assert.deepEqual(await schedules.list(event.id), []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/creator-schedules.routes.test.js`
Expected: FAIL. 시간표 요청이 404

- [ ] **Step 3: 구현**

`src/routes/upload.js`
```js
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { ValidationError } = require('../services/errors');

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const scheduleUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${randomUUID()}${EXTENSIONS[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new ValidationError('jpg, png, webp, gif 이미지만 올릴 수 있습니다'));
  },
});

module.exports = { scheduleUpload };
```

`src/routes/creator.js` 상단 require에 추가:
```js
const schedules = require('../services/schedules');
const { scheduleUpload } = require('./upload');
```

`module.exports = router;` 바로 위에 추가:
```js
async function renderSchedules(req, res, error = null, status = 200) {
  const list = await schedules.list(req.event.id);
  res.status(status).render('creator/schedules', { title: '시간표 관리', list, error });
}

router.get('/schedules', (req, res) => renderSchedules(req, res));

router.post('/schedules', (req, res, next) => {
  scheduleUpload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') return await renderSchedules(req, res, '이미지는 5MB 이하만 올릴 수 있습니다', 400);
        if (uploadErr instanceof ValidationError) return await renderSchedules(req, res, uploadErr.message, 400);
        return next(uploadErr);
      }
      if (!req.file) return await renderSchedules(req, res, '이미지를 선택해 주세요', 400);
      try {
        await schedules.add(req.event.id, { fileName: req.file.filename, caption: req.body.caption });
      } catch (err) {
        await schedules.removeFile(req.file.filename);
        if (err instanceof ValidationError) return await renderSchedules(req, res, err.message, 400);
        throw err;
      }
      res.redirect(manage(res, '/schedules'));
    } catch (err) {
      next(err);
    }
  });
});

router.post('/schedules/:id', async (req, res) => {
  try {
    await schedules.updateCaption(req.event.id, req.params.id, req.body.caption);
    res.redirect(manage(res, '/schedules'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderSchedules(req, res, err.message, 400);
  }
});

router.post('/schedules/:id/move', async (req, res) => {
  await schedules.move(req.event.id, req.params.id, req.body.direction === 'up' ? 'up' : 'down');
  res.redirect(manage(res, '/schedules'));
});

router.post('/schedules/:id/delete', async (req, res) => {
  await schedules.remove(req.event.id, req.params.id);
  res.redirect(manage(res, '/schedules'));
});
```

`src/views/creator/schedules.ejs`
```ejs
<h1 class="title">시간표 관리</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<form method="post" action="<%= base %>/manage/schedules" enctype="multipart/form-data" class="card stack">
  <h2>시간표 올리기</h2>
  <label>설명<input name="caption" maxlength="100" placeholder="예: 제3회 시간표"></label>
  <label>이미지 <small class="muted">jpg, png, webp, gif / 5MB 이하</small>
    <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required>
  </label>
  <button class="btn btn-primary">올리기</button>
</form>
<section class="card">
  <h2>등록된 시간표</h2>
  <% if (list.length === 0) { %><p class="muted">아직 시간표가 없습니다.</p><% } %>
  <% list.forEach((s, i) => { %>
  <figure class="schedule stack">
    <img src="/uploads/<%= s.file_name %>" alt="<%= s.caption || '시간표' %>">
    <form method="post" action="<%= base %>/manage/schedules/<%= s.id %>" class="row">
      <input name="caption" maxlength="100" value="<%= s.caption %>" style="flex: 1">
      <button class="btn btn-small">설명 저장</button>
    </form>
    <div class="row">
      <form method="post" action="<%= base %>/manage/schedules/<%= s.id %>/move">
        <input type="hidden" name="direction" value="up">
        <button class="btn btn-small" <%= i === 0 ? 'disabled' : '' %>>위로</button>
      </form>
      <form method="post" action="<%= base %>/manage/schedules/<%= s.id %>/move">
        <input type="hidden" name="direction" value="down">
        <button class="btn btn-small" <%= i === list.length - 1 ? 'disabled' : '' %>>아래로</button>
      </form>
      <form method="post" action="<%= base %>/manage/schedules/<%= s.id %>/delete" data-msg="시간표를 삭제할까요?" onsubmit="return confirm(this.dataset.msg)">
        <button class="btn btn-small btn-danger">삭제</button>
      </form>
    </div>
  </figure>
  <% }) %>
</section>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS. 만약 "5MB" 테스트의 파일 개수 단언만 실패하면 multer가 부분 파일을 남긴 것이다. 업로드 디렉터리에서 남은 파일을 확인한 뒤, 업로드 오류 분기 맨 앞에서 그 파일을 지우도록 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src tests
git commit -m "feat: 시간표 이미지 업로드와 관리 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 플랫폼 관리자

**Files:**
- Create: `src/routes/admin.js`, `src/views/admin/login.ejs`, `src/views/admin/index.ejs`, `src/views/admin/event.ejs`
- Modify: `src/app.js`(`app.use('/e/:slug', ...)` 바로 위에 `/admin` 마운트)
- Test: `tests/admin.routes.test.js`

**Interfaces:**
- Consumes: Task 5 `checkAdminPassword`, `requireAdmin`, `notFound`, `regenerate`, `inviteUrl`, Task 3 `events.listEvents/getEventById/setCreatorPin/deleteEvent`, `participants.listParticipants/resetPin`, Task 4 `schedules.removeFile`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/admin.routes.test.js`
```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkAdminPassword } = require('../src/middleware/auth');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

test('checkAdminPassword는 정확히 일치할 때만 참이다', () => {
  assert.equal(checkAdminPassword('admin-test-pw'), true);
  assert.equal(checkAdminPassword('admin-test-p'), false);
  assert.equal(checkAdminPassword(undefined), false);
});

test('관리자가 아니면 로그인 화면으로 보낸다', async () => {
  const res = await H.request(H.getApp()).get('/admin').expect(302);
  assert.equal(res.headers.location, '/admin/login');
});

test('틀린 비밀번호는 401', async () => {
  const res = await H.request(H.getApp()).post('/admin/login').type('form').send({ password: 'nope' }).expect(401);
  assert.match(res.text, /정보가 일치하지 않습니다/);
});

test('로그인하면 운동회 목록과 상세가 보이고 로그아웃할 수 있다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const list = await admin.get('/admin').expect(200);
  assert.match(list.text, /제 3회 명량운동회/);
  const detail = await admin.get(`/admin/events/${event.id}`).expect(200);
  assert.match(detail.text, /생성자/);
  assert.match(detail.text, new RegExp(event.auth_code));
  await admin.get('/admin/events/999999').expect(404);
  await admin.post('/admin/logout').expect(302);
  await admin.get('/admin').expect(302);
});

test('참가자 PIN을 재설정하면 새 PIN으로 입장한다', async () => {
  const { event, participant } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.post(`/admin/events/${event.id}/participants/${participant.id}/pin`).type('form')
    .send({ pin: '7777' }).expect(302);
  const done = await admin.get(res.headers.location).expect(200);
  assert.match(done.text, /참가자 PIN을 재설정했습니다/);
  await H.joinAgent(event, { name: '생성자', pin: '7777' });
  const bad = await admin.post(`/admin/events/${event.id}/participants/${participant.id}/pin`).type('form')
    .send({ pin: '77' }).expect(400);
  assert.match(bad.text, /4자리/);
});

test('다른 운동회의 참가자 PIN은 재설정할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/participants/${other.id}/pin`).type('form').send({ pin: '7777' }).expect(404);
});

test('생성자 PIN을 재설정하면 새 PIN으로 관리 페이지가 열린다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/creator-pin`).type('form').send({ pin: '654321' }).expect(302);
  const member = await H.joinAgent(event, { name: '생성자', pin: '1111' });
  await member.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '123456' }).expect(400);
  await member.post(`/e/${event.slug}/manage/unlock`).type('form').send({ pin: '654321' }).expect(302);
});

test('관리자는 입장하지 않고도 생성자 화면에 들어갈 수 있다', async () => {
  const { event } = await H.makeEvent();
  const admin = await H.adminAgent();
  const res = await admin.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(res.text, /플랫폼 관리/);
  await admin.get(`/e/${event.slug}/manage/participants`).expect(200);
});

test('삭제 확인 문구가 틀리면 400, 맞으면 운동회와 시간표 파일이 지워진다', async () => {
  const { event } = await H.makeEvent();
  const file = path.join(process.env.UPLOAD_DIR, 'admin-del.png');
  fs.writeFileSync(file, 'x');
  await schedules.add(event.id, { fileName: 'admin-del.png', caption: '' });
  const admin = await H.adminAgent();
  await admin.post(`/admin/events/${event.id}/delete`).type('form').send({ confirm: 'wrong' }).expect(400);
  await admin.post(`/admin/events/${event.id}/delete`).type('form').send({ confirm: event.slug }).expect(302);
  await admin.get(`/admin/events/${event.id}`).expect(404);
  assert.equal(fs.existsSync(file), false);
});

test('관리자 로그인 후에도 기존 운동회 입장 정보가 유지된다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '철수', pin: '1234' });
  await agent.post('/admin/login').type('form').send({ password: 'admin-test-pw' }).expect(302);
  await agent.get(`/e/${event.slug}/home`).expect(200);
  await agent.get('/admin').expect(200);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test tests/admin.routes.test.js`
Expected: FAIL. `/admin` 요청이 404

- [ ] **Step 3: 구현**

`src/routes/admin.js`
```js
const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const schedules = require('../services/schedules');
const { ValidationError } = require('../services/errors');
const { checkAdminPassword, requireAdmin, notFound } = require('../middleware/auth');
const { regenerate, inviteUrl } = require('./helpers');

const router = express.Router();

const DONE_MESSAGES = {
  pin: '참가자 PIN을 재설정했습니다',
  creator: '생성자 PIN을 재설정했습니다',
};

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: '관리자 로그인' });
});

router.post('/login', async (req, res) => {
  if (!checkAdminPassword(req.body.password)) {
    return res.status(401).render('admin/login', { title: '관리자 로그인', error: '정보가 일치하지 않습니다' });
  }
  await regenerate(req);
  req.session.admin = true;
  res.redirect('/admin');
});

router.post('/logout', (req, res) => {
  req.session.admin = false;
  res.redirect('/admin/login');
});

router.use(requireAdmin);

router.get('/', async (req, res) => {
  res.render('admin/index', { title: '플랫폼 관리', wide: true, eventList: await events.listEvents() });
});

async function loadAdminEvent(req, res, next) {
  const event = await events.getEventById(req.params.id);
  if (!event) return notFound(res);
  req.event = event;
  next();
}

async function renderDetail(req, res, { message = null, error = null, status = 200 } = {}) {
  const list = await participants.listParticipants(req.event.id);
  res.status(status).render('admin/event', {
    title: `관리: ${req.event.title}`,
    wide: true,
    event: req.event,
    list,
    inviteUrl: inviteUrl(req, req.event),
    message,
    error,
  });
}

router.get('/events/:id', loadAdminEvent, (req, res) => {
  renderDetail(req, res, { message: DONE_MESSAGES[req.query.done] || null });
});

router.post('/events/:id/participants/:pid/pin', loadAdminEvent, async (req, res) => {
  try {
    const ok = await participants.resetPin(req.event.id, req.params.pid, req.body.pin);
    if (!ok) return notFound(res);
    res.redirect(`/admin/events/${req.event.id}?done=pin`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDetail(req, res, { error: err.message, status: 400 });
  }
});

router.post('/events/:id/creator-pin', loadAdminEvent, async (req, res) => {
  try {
    await events.setCreatorPin(req.event.id, req.body.pin);
    res.redirect(`/admin/events/${req.event.id}?done=creator`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDetail(req, res, { error: err.message, status: 400 });
  }
});

router.post('/events/:id/delete', loadAdminEvent, async (req, res) => {
  if (String(req.body.confirm ?? '').trim() !== req.event.slug) {
    return renderDetail(req, res, { error: '확인 문구가 운동회 코드와 다릅니다', status: 400 });
  }
  const files = await events.deleteEvent(req.event.id);
  await Promise.all((files || []).map((f) => schedules.removeFile(f)));
  res.redirect('/admin');
});

module.exports = router;
```

`src/app.js`에서 `app.use('/e/:slug', require('./routes/participant'));` 바로 위에 추가:
```js
  app.use('/admin', require('./routes/admin'));
```

`src/views/admin/login.ejs`
```ejs
<h1 class="title center">플랫폼 관리자</h1>
<%- include('../partials/alert') %>
<form method="post" action="/admin/login" class="card stack">
  <label>비밀번호<input type="password" name="password" required autofocus></label>
  <button class="btn btn-primary">로그인</button>
</form>
```

`src/views/admin/index.ejs`
```ejs
<div class="row" style="justify-content: space-between">
  <h1 class="title">플랫폼 관리</h1>
  <form method="post" action="/admin/logout"><button class="btn btn-ghost">로그아웃</button></form>
</div>
<div class="card table-wrap">
  <table>
    <thead><tr><th>회차</th><th>제목</th><th>참가자</th><th>상태</th><th>생성일</th></tr></thead>
    <tbody>
      <% if (eventList.length === 0) { %><tr><td colspan="5" class="muted">운동회가 없습니다</td></tr><% } %>
      <% eventList.forEach((e) => { %>
      <tr>
        <td><%= e.round_no %></td>
        <td><a href="/admin/events/<%= e.id %>"><%= e.title %></a></td>
        <td><%= e.participant_count %></td>
        <td><%= statusLabel(e.status) %></td>
        <td><%= fmtDateTime(e.created_at) %></td>
      </tr>
      <% }) %>
    </tbody>
  </table>
</div>
```

`src/views/admin/event.ejs`
```ejs
<p><a href="/admin">목록으로</a></p>
<h1 class="title"><%= event.title %></h1>
<%- include('../partials/alert') %>
<section class="card stack">
  <h2>정보</h2>
  <p>회차 <%= event.round_no %> · 상태 <%= statusLabel(event.status) %> · 인증코드 <strong><%= event.auth_code %></strong> · 코드 <strong><%= event.slug %></strong></p>
  <p class="copy"><%= inviteUrl %></p>
  <div><a class="btn" href="/e/<%= event.slug %>/manage">생성자 화면으로 들어가기</a></div>
</section>
<section class="card stack">
  <h2>생성자 PIN 재설정</h2>
  <form method="post" action="/admin/events/<%= event.id %>/creator-pin" class="row">
    <input name="pin" inputmode="numeric" pattern="\d{6}" maxlength="6" required placeholder="새 6자리 PIN" style="width: 10em">
    <button class="btn btn-small">재설정</button>
  </form>
</section>
<section class="card table-wrap">
  <h2>참가자 (<%= list.length %>명)</h2>
  <table>
    <thead><tr><th>이름</th><th>출석</th><th>입장일</th><th>PIN 재설정</th></tr></thead>
    <tbody>
      <% list.forEach((p) => { %>
      <tr>
        <td><%= p.name %></td>
        <td><%= p.attendance === 'present' ? '참석' : '미출석' %></td>
        <td><%= fmtDateTime(p.created_at) %></td>
        <td>
          <form method="post" action="/admin/events/<%= event.id %>/participants/<%= p.id %>/pin" class="row">
            <input name="pin" inputmode="numeric" pattern="\d{4}" maxlength="4" required placeholder="새 4자리" style="width: 7em">
            <button class="btn btn-small">재설정</button>
          </form>
        </td>
      </tr>
      <% }) %>
    </tbody>
  </table>
</section>
<section class="card stack">
  <h2>운동회 삭제</h2>
  <p class="hint">되돌릴 수 없습니다. 확인을 위해 운동회 코드 <strong><%= event.slug %></strong>를 입력하세요.</p>
  <form method="post" action="/admin/events/<%= event.id %>/delete" class="row">
    <input name="confirm" required style="width: 10em">
    <button class="btn btn-small btn-danger">삭제</button>
  </form>
</section>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src tests
git commit -m "feat: 플랫폼 관리자 로그인, 운동회 관리, PIN 재설정 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 실제 서버 구동 확인

**Files:**
- 변경 없음(문제가 발견되면 해당 파일 수정)

- [ ] **Step 1: 개발 DB 마이그레이션**

Run: `npm run migrate`
Expected: `적용: 001_init.sql`

- [ ] **Step 2: 서버를 띄우고 핵심 흐름을 curl로 확인**

```bash
npm start &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s -c /tmp/sd.txt -o /dev/null -w "%{http_code} %{redirect_url}\n" -X POST http://localhost:3000/events \
  --data-urlencode roundNo=99 --data-urlencode creatorPin=123456 --data-urlencode creatorPinConfirm=123456 \
  --data-urlencode creatorName=점검 --data-urlencode creatorPersonalPin=1111
```
Expected: `200`, 그리고 `302 http://localhost:3000/e/<slug>/manage/created`. 이어서 `curl -s -b /tmp/sd.txt <redirect_url>`이 초대 링크를 포함한 HTML을 돌려준다.

- [ ] **Step 3: 점검용 데이터 정리와 서버 종료**

```bash
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -c "DELETE FROM events WHERE round_no = 99"
kill %1
```

- [ ] **Step 4: 전체 테스트 재실행**

Run: `npm test`
Expected: PASS
