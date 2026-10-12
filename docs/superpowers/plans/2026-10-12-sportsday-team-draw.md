# 명량운동회 2단계(팀 뽑기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생성자가 그룹과 팀을 설정하고, 참가자가 "미리 봉투" 방식으로 자기 폰에서 연출과 함께 팀을 뽑으며, 생성자·관리자가 대리 뽑기와 수동 이동을 할 수 있게 한다.

**Architecture:** 배정 계산은 DB와 무관한 순수 함수(`draw-assign.js`)로 두고, 상태 변경은 서비스(`teams`, `groups`, `draw`)가 운동회 행을 `FOR UPDATE`로 잠근 트랜잭션 안에서 처리한다. 화면에 보이는 팀 소속은 항상 `draw_results`에서만 읽고, 봉투(`participants.team_id`)는 `draw.js` 서비스 안에서만 읽는다. 클라이언트 연출은 `src/public/js/draw.js` 하나이며 자바스크립트 없이도 폼 전송으로 동작한다.

**Tech Stack:** Node 24(CommonJS), Express 5, EJS + express-ejs-layouts, PostgreSQL 17(`pg`), node:test + supertest

**Spec:** `docs/superpowers/specs/2026-10-12-sportsday-team-draw-design.md` (선행: `docs/superpowers/specs/2026-10-11-sportsday-foundation-design.md`)

## Global Constraints

- Node.js 24 이상, CommonJS(`require`), TypeScript 사용 안 함
- 실시간 갱신(폴링, SSE, 소켓) 없음. 화면은 접속·새로고침 시점의 상태를 보여준다
- 상태 변경은 모두 POST. 사용자에게 보이는 문구는 모두 한국어
- 디자인은 `docs/design/mockup.html`의 합의안(제목 Jua, 본문 Noto Sans KR, 배경 `#FFF8EE`, 주황 `#FF8A3D`)을 따른다. 터치 영역 44px 이상, 뽑기 버튼 52px
- 팀 색 팔레트 키: `red 레드 ● #C93636`, `blue 블루 ▲ #245BC7`, `green 그린 ■ #237448`, `yellow 옐로우 ★ #F4D34E`, `purple 퍼플 ◆ #7A3FB0`, `orange 오렌지 ♥ #E0701F`, `pink 핑크 ♣ #D6487E`, `black 블랙 ✚ #24211E`. 옐로우·오렌지 위 글자는 잉크색, 나머지는 흰색
- 팀 수 2~8개, 팀·그룹 이름 1~20자
- 아직 열지 않은 봉투의 팀은 참가자·생성자·관리자 어떤 화면과 응답에도 나오지 않는다
- 모든 서비스: id는 `/^[1-9]\d{0,17}$/`로 검증, 모든 쿼리는 `event_id`로 범위 제한, 검증 실패는 `ValidationError`
- 테스트는 원격 공유 테스트 DB를 쓰므로 반드시 `npm test`(이미 `--test-concurrency=1`)로 실행한다. 단일 파일은 `NODE_ENV=test node --test --test-concurrency=1 tests/<file>`
- `.env`는 읽지도, 출력하지도, 수정하지도 않는다
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **봉투 누출**: 시작 직후 안 뽑은 참가자의 팀이 참가자 홈·뽑기 화면·현황판·생성자 뽑기 화면 HTML에 나오면 안 된다 → Task 6, Task 7 테스트
2. **같은 사람의 동시 뽑기(더블 탭)**: 결과 행은 하나, 두 응답의 팀은 같아야 한다 → Task 5 테스트
3. **늦게 온 여러 명의 동시 뽑기**: 팀 인원 균형이 유지되어야 한다 → Task 5 테스트
4. **팀 이름에 HTML·`</script>` 문자**: 뽑기 화면에 삽입하는 JSON과 배지가 깨지거나 스크립트가 실행되면 안 된다 → Task 7 테스트
5. **1단계에서 만든 운동회(팀 없음)**: 팀 설정·뽑기 화면을 처음 열면 기본 4팀이 생겨야 한다 → Task 3, Task 6 테스트

---

### Task 1: 마이그레이션, 운동회 잠금, 팀 서비스

**Files:**
- Create: `db/migrations/003_draw_method.sql`
- Create: `src/services/event-lock.js`
- Create: `src/services/teams.js`
- Modify: `src/services/events.js` (createEvent에서 기본 팀 생성)
- Modify: `tests/helpers.js` (`addParticipant` 추가)
- Test: `tests/teams.service.test.js`

**Interfaces:**
- Produces:
  - `event-lock.js`: `LOCKED`(문구), `lockEvent(client, eventId) → event row`, `lockEditable(client, eventId) → event row`(진행 중이면 `ValidationError(LOCKED)`)
  - `teams.js`: `PALETTE`, `MIN_TEAMS=2`, `MAX_TEAMS=8`, `paletteOf(key) → {key,name,mark}|null`, `insertDefaultTeams(client, eventId)`, `ensureDefaultTeams(eventId)`, `listTeams(eventId, client = db) → [{...team row, leader_name, palette}]`, `setTeamCount(eventId, value)`, `saveTeams(eventId, input)` (폼 필드 `name<i>`, `color<i>`, `leader<i>`)
  - `tests/helpers.js`: `addParticipant(eventId, name, { attendance = 'present', groupId = null } = {}) → participant row`

- [ ] **Step 1: 마이그레이션 작성**

`db/migrations/003_draw_method.sql`:

```sql
-- 공개 기록이 본인 뽑기·대리·수동·팀장 중 무엇으로 생겼는지
ALTER TABLE draw_results ADD COLUMN method text NOT NULL DEFAULT 'self'
  CHECK (method IN ('self', 'proxy', 'manual', 'leader'));
```

- [ ] **Step 2: 테스트 헬퍼 추가**

`tests/helpers.js`의 `adminAgent` 함수 아래에 추가하고 `module.exports`에 `addParticipant`를 넣는다.

```js
// 세션 없이 참가자 행만 만든다(입장 화면을 거치지 않는 서비스 테스트용)
async function addParticipant(eventId, name, { attendance = 'present', groupId = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO participants (event_id, name, pin_hash, attendance, group_id)
     VALUES ($1, $2, 'unused-hash', $3, $4) RETURNING *`,
    [eventId, name, attendance, groupId],
  );
  return rows[0];
}
```

```js
module.exports = {
  getApp, resetDb, makeEvent, joinAgent, creatorAgent, adminAgent, addParticipant, request, EVENT_INPUT, db,
};
```

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/teams.service.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const teams = require('../src/services/teams');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

function form(list, overrides = {}) {
  const input = {};
  list.forEach((t, i) => {
    input[`name${i}`] = t.name;
    input[`color${i}`] = t.color;
    input[`leader${i}`] = t.leader_participant_id ?? '';
  });
  return { ...input, ...overrides };
}

test('운동회를 만들면 기본 4팀이 생긴다', async () => {
  const { event } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => [t.name, t.color, t.palette.mark]), [
    ['레드', 'red', '●'], ['블루', 'blue', '▲'], ['그린', 'green', '■'], ['옐로우', 'yellow', '★'],
  ]);
});

test('팀이 없는 운동회는 ensureDefaultTeams가 기본 4팀을 한 번만 만든다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query('DELETE FROM teams WHERE event_id = $1', [event.id]);
  await teams.ensureDefaultTeams(event.id);
  await teams.ensureDefaultTeams(event.id);
  assert.equal((await teams.listTeams(event.id)).length, 4);
});

test('팀 수를 늘리면 안 쓴 색으로 추가하고, 줄이면 뒤에서부터 지운다', async () => {
  const { event } = await H.makeEvent();
  await teams.setTeamCount(event.id, '6');
  let list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => t.color), ['red', 'blue', 'green', 'yellow', 'purple', 'orange']);
  assert.deepEqual(list.slice(4).map((t) => t.name), ['퍼플', '오렌지']);
  await teams.setTeamCount(event.id, '3');
  list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => t.name), ['레드', '블루', '그린']);
  for (const bad of ['1', '9', 'abc', '']) {
    await assert.rejects(teams.setTeamCount(event.id, bad), ValidationError);
  }
});

test('새 팀의 기본 이름이 이미 쓰이고 있으면 번호를 붙인다', async () => {
  const { event } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  await teams.saveTeams(event.id, form(list, { name0: '퍼플' }));
  await teams.setTeamCount(event.id, '5');
  const after = await teams.listTeams(event.id);
  assert.equal(after[4].name, '퍼플 5');
});

test('팀 이름·색·팀장을 저장한다', async () => {
  const { event, participant } = await H.makeEvent();
  const list = await teams.listTeams(event.id);
  await teams.saveTeams(event.id, form(list, { name0: '  불꽃   팀 ', color0: 'purple', leader0: participant.id }));
  const saved = await teams.listTeams(event.id);
  assert.equal(saved[0].name, '불꽃 팀');
  assert.equal(saved[0].color, 'purple');
  assert.equal(String(saved[0].leader_participant_id), String(participant.id));
  assert.equal(saved[0].leader_name, '생성자');
  assert.equal(saved[0].palette.mark, '◆');
});

test('팀 설정 검증', async () => {
  const { event, participant } = await H.makeEvent();
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  const { event: other } = await H.makeEvent();
  const outsider = await H.addParticipant(other.id, '남의사람');
  const list = await teams.listTeams(event.id);
  const cases = [
    [{ name1: '레드' }, /중복/],
    [{ name0: '   ' }, /1~20자/],
    [{ name0: 'ㄱ'.repeat(21) }, /1~20자/],
    [{ color1: 'red' }, /다른 색/],
    [{ color0: 'gold' }, /색 값/],
    [{ leader0: absent.id }, /결석/],
    [{ leader0: participant.id, leader1: participant.id }, /두 팀/],
    [{ leader0: outsider.id }, /팀장 값/],
    [{ leader0: '01' }, /팀장 값/],
  ];
  for (const [overrides, message] of cases) {
    await assert.rejects(teams.saveTeams(event.id, form(list, overrides)), message);
  }
  assert.deepEqual((await teams.listTeams(event.id)).map((t) => t.name), ['레드', '블루', '그린', '옐로우']);
});

test('뽑기 진행 중에는 팀 수와 팀 설정을 바꿀 수 없다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query('UPDATE events SET draw_open = true WHERE id = $1', [event.id]);
  const list = await teams.listTeams(event.id);
  await assert.rejects(teams.setTeamCount(event.id, '5'), /진행 중/);
  await assert.rejects(teams.saveTeams(event.id, form(list, { name0: '새이름' })), /진행 중/);
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node db/migrate.js && NODE_ENV=test node --test --test-concurrency=1 tests/teams.service.test.js`
Expected: FAIL — `Cannot find module '../src/services/teams'`

- [ ] **Step 5: 운동회 잠금 모듈 작성**

`src/services/event-lock.js`:

```js
const { ValidationError } = require('./errors');

const LOCKED = '팀 뽑기가 진행 중이라 바꿀 수 없습니다. 팀 뽑기 화면에서 초기화한 뒤 다시 시도해 주세요';

// 운동회 행을 잠가 같은 운동회의 팀·그룹·뽑기 작업이 동시에 엇갈리지 않게 한다
async function lockEvent(client, eventId) {
  const { rows } = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  if (!rows[0]) throw new ValidationError('운동회를 찾을 수 없습니다');
  return rows[0];
}

// 뽑기가 진행 중이면 팀·그룹 편집을 막는다
async function lockEditable(client, eventId) {
  const event = await lockEvent(client, eventId);
  if (event.draw_open) throw new ValidationError(LOCKED);
  return event;
}

module.exports = { LOCKED, lockEvent, lockEditable };
```

- [ ] **Step 6: 팀 서비스 작성**

`src/services/teams.js`:

```js
const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEditable } = require('./event-lock');

const PALETTE = [
  { key: 'red', name: '레드', mark: '●' },
  { key: 'blue', name: '블루', mark: '▲' },
  { key: 'green', name: '그린', mark: '■' },
  { key: 'yellow', name: '옐로우', mark: '★' },
  { key: 'purple', name: '퍼플', mark: '◆' },
  { key: 'orange', name: '오렌지', mark: '♥' },
  { key: 'pink', name: '핑크', mark: '♣' },
  { key: 'black', name: '블랙', mark: '✚' },
];
const MIN_TEAMS = 2;
const MAX_TEAMS = 8;
const DEFAULT_COUNT = 4;

const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));
const paletteOf = (key) => PALETTE.find((c) => c.key === key) || null;

function cleanTeamName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  const length = Array.from(name).length;
  if (length < 1 || length > 20) throw new ValidationError('팀 이름은 1~20자로 입력해 주세요');
  return name;
}

async function insertTeam(client, eventId, name, color, sortOrder) {
  await client.query(
    'INSERT INTO teams (event_id, name, color, sort_order) VALUES ($1, $2, $3, $4)',
    [eventId, name, color, sortOrder],
  );
}

// 운동회를 만들 때 같은 트랜잭션에서 기본 4팀을 만든다
async function insertDefaultTeams(client, eventId) {
  for (let i = 0; i < DEFAULT_COUNT; i++) await insertTeam(client, eventId, PALETTE[i].name, PALETTE[i].key, i);
}

async function listTeams(eventId, client = db) {
  const { rows } = await client.query(
    `SELECT t.*, p.name AS leader_name
     FROM teams t LEFT JOIN participants p ON p.id = t.leader_participant_id
     WHERE t.event_id = $1 ORDER BY t.sort_order, t.id`,
    [eventId],
  );
  return rows.map((t) => ({ ...t, palette: paletteOf(t.color) }));
}

// 1단계에서 만든 운동회처럼 팀이 하나도 없으면 기본 4팀을 만든다
async function ensureDefaultTeams(eventId) {
  return db.tx(async (client) => {
    const { rows } = await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    if (!rows[0]) return;
    const count = await client.query('SELECT count(*)::int AS n FROM teams WHERE event_id = $1', [eventId]);
    if (count.rows[0].n === 0) await insertDefaultTeams(client, eventId);
  });
}

async function setTeamCount(eventId, value) {
  const count = Number(value);
  if (!String(value ?? '').trim() || !Number.isInteger(count) || count < MIN_TEAMS || count > MAX_TEAMS) {
    throw new ValidationError(`팀 수는 ${MIN_TEAMS}~${MAX_TEAMS}개로 정해 주세요`);
  }
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const current = await listTeams(eventId, client);
    if (count < current.length) {
      const removeIds = current.slice(count).map((t) => t.id);
      await client.query('DELETE FROM teams WHERE event_id = $1 AND id = ANY($2::bigint[])', [eventId, removeIds]);
    }
    const kept = current.slice(0, count);
    const usedColors = new Set(kept.map((t) => t.color));
    const usedNames = new Set(kept.map((t) => t.name));
    const free = PALETTE.filter((c) => !usedColors.has(c.key));
    for (let i = current.length; i < count; i++) {
      const color = free.shift() || PALETTE[i];
      const name = usedNames.has(color.name) ? `${color.name} ${i + 1}` : color.name;
      usedNames.add(name);
      await insertTeam(client, eventId, name, color.key, i);
    }
  });
}

async function saveTeams(eventId, input) {
  return db.tx(async (client) => {
    await lockEditable(client, eventId);
    const current = await listTeams(eventId, client);
    const { rows: people } = await client.query(
      'SELECT id, name, attendance FROM participants WHERE event_id = $1',
      [eventId],
    );
    const byId = new Map(people.map((p) => [String(p.id), p]));
    const names = new Set();
    const colors = new Set();
    const leaders = new Set();
    const updates = current.map((team, i) => {
      const name = cleanTeamName(input[`name${i}`]);
      if (names.has(name)) throw new ValidationError(`팀 이름 "${name}"이(가) 중복됩니다`);
      names.add(name);

      const color = String(input[`color${i}`] ?? '');
      if (!paletteOf(color)) throw new ValidationError('팀 색 값이 올바르지 않습니다');
      if (colors.has(color)) throw new ValidationError('팀마다 다른 색을 골라 주세요');
      colors.add(color);

      const leaderValue = String(input[`leader${i}`] ?? '');
      let leaderId = null;
      if (leaderValue) {
        const person = isId(leaderValue) ? byId.get(leaderValue) : null;
        if (!person) throw new ValidationError('팀장 값이 올바르지 않습니다');
        if (person.attendance !== 'present') {
          throw new ValidationError(`${person.name}님은 결석으로 되어 있어 팀장이 될 수 없습니다`);
        }
        if (leaders.has(leaderValue)) throw new ValidationError(`${person.name}님이 두 팀의 팀장으로 지정되었습니다`);
        leaders.add(leaderValue);
        leaderId = person.id;
      }
      return { id: team.id, name, color, leaderId };
    });
    for (const u of updates) {
      await client.query(
        'UPDATE teams SET name = $3, color = $4, leader_participant_id = $5 WHERE event_id = $1 AND id = $2',
        [eventId, u.id, u.name, u.color, u.leaderId],
      );
    }
  });
}

module.exports = {
  PALETTE, MIN_TEAMS, MAX_TEAMS, paletteOf, insertDefaultTeams, listTeams, ensureDefaultTeams, setTeamCount, saveTeams,
};
```

- [ ] **Step 7: 운동회 생성 시 기본 팀 생성**

`src/services/events.js` 상단 require에 추가:

```js
const { insertDefaultTeams } = require('./teams');
```

`createEvent`의 트랜잭션 안, 생성자 참가자 INSERT 다음 줄(`return { event, participant: rows[0] };` 앞)에 추가:

```js
    await insertDefaultTeams(client, event.id);
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS(기존 121개 + 새 7개)

- [ ] **Step 9: 커밋**

```bash
git add db/migrations/003_draw_method.sql src/services/event-lock.js src/services/teams.js src/services/events.js tests/helpers.js tests/teams.service.test.js
git commit -m "feat: 팀 설정 서비스와 기본 4팀, 뽑기 방식 컬럼 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 그룹 서비스

**Files:**
- Create: `src/services/groups.js`
- Test: `tests/groups.service.test.js`

**Interfaces:**
- Consumes: `lockEditable(client, eventId)` (Task 1), `H.addParticipant` (Task 1)
- Produces: `groups.js`: `listGroups(eventId) → [{...group row, member_count}]`, `createGroup(eventId, name) → row`, `renameGroup(eventId, id, name) → row|null`, `deleteGroup(eventId, id) → boolean`, `saveMembership(eventId, input)` (폼 필드 `g<참가자 id>`, 빈 값은 그룹 없음)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/groups.service.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../src/services/groups');

test.beforeEach(H.resetDb);

const groupOf = async (pid) => (await H.db.query('SELECT group_id FROM participants WHERE id = $1', [pid])).rows[0].group_id;

test('그룹을 만들고 이름 중복과 길이를 검사한다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, ' 축구부 ');
  const b = await groups.createGroup(event.id, '동창');
  assert.equal(a.name, '축구부');
  assert.equal(a.sort_order, 0);
  assert.equal(b.sort_order, 1);
  await assert.rejects(groups.createGroup(event.id, '축구부'), /이미 있습니다/);
  await assert.rejects(groups.createGroup(event.id, ''), /1~20자/);
  const { event: other } = await H.makeEvent();
  await groups.createGroup(other.id, '축구부');
});

test('그룹 이름을 바꾸고, 없는 그룹은 null', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  await groups.createGroup(event.id, '동창');
  assert.equal((await groups.renameGroup(event.id, a.id, '농구부')).name, '농구부');
  assert.equal((await groups.renameGroup(event.id, a.id, '농구부')).name, '농구부');
  await assert.rejects(groups.renameGroup(event.id, a.id, '동창'), /이미 있습니다/);
  assert.equal(await groups.renameGroup(event.id, '999999', '새이름'), null);
  assert.equal(await groups.renameGroup(event.id, 'abc', '새이름'), null);
  const { event: other } = await H.makeEvent();
  assert.equal(await groups.renameGroup(other.id, a.id, '남의것'), null);
});

test('그룹을 지우면 소속 참가자는 그룹 없음이 된다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const p = await H.addParticipant(event.id, '철수', { groupId: a.id });
  assert.equal(await groups.deleteGroup(event.id, a.id), true);
  assert.equal(await groupOf(p.id), null);
  assert.equal(await groups.deleteGroup(event.id, a.id), false);
  assert.equal(await groups.deleteGroup(event.id, '01'), false);
});

test('참가자 소속을 한 번에 저장하고 목록에 인원수를 보여 준다', async () => {
  const { event, participant: creator } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const b = await groups.createGroup(event.id, '동창');
  const p1 = await H.addParticipant(event.id, '철수');
  const p2 = await H.addParticipant(event.id, '영희', { groupId: b.id });
  await groups.saveMembership(event.id, { [`g${p1.id}`]: String(a.id), [`g${p2.id}`]: '' });
  assert.equal(String(await groupOf(p1.id)), String(a.id));
  assert.equal(await groupOf(p2.id), null);
  assert.equal(await groupOf(creator.id), null);
  const list = await groups.listGroups(event.id);
  assert.deepEqual(list.map((g) => [g.name, g.member_count]), [['축구부', 1], ['동창', 0]]);
});

test('다른 운동회의 그룹이나 잘못된 값은 거부하고 아무것도 바꾸지 않는다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent();
  const foreign = await groups.createGroup(other.id, '남의그룹');
  const mine = await groups.createGroup(event.id, '축구부');
  const p1 = await H.addParticipant(event.id, '철수');
  const p2 = await H.addParticipant(event.id, '영희');
  await assert.rejects(
    groups.saveMembership(event.id, { [`g${p1.id}`]: String(mine.id), [`g${p2.id}`]: String(foreign.id) }),
    /그룹 값/,
  );
  assert.equal(await groupOf(p1.id), null);
  await assert.rejects(groups.saveMembership(event.id, { [`g${p1.id}`]: 'abc' }), /그룹 값/);
});

test('뽑기 진행 중에는 그룹을 바꿀 수 없다', async () => {
  const { event } = await H.makeEvent();
  const a = await groups.createGroup(event.id, '축구부');
  const p = await H.addParticipant(event.id, '철수');
  await H.db.query('UPDATE events SET draw_open = true WHERE id = $1', [event.id]);
  await assert.rejects(groups.createGroup(event.id, '새그룹'), /진행 중/);
  await assert.rejects(groups.renameGroup(event.id, a.id, '새이름'), /진행 중/);
  await assert.rejects(groups.deleteGroup(event.id, a.id), /진행 중/);
  await assert.rejects(groups.saveMembership(event.id, { [`g${p.id}`]: String(a.id) }), /진행 중/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/groups.service.test.js`
Expected: FAIL — `Cannot find module '../src/services/groups'`

- [ ] **Step 3: 그룹 서비스 작성**

`src/services/groups.js`:

```js
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/groups.js tests/groups.service.test.js
git commit -m "feat: 그룹 만들기·이름 변경·삭제와 참가자 소속 저장 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 생성자 팀 설정·그룹 화면

**Files:**
- Modify: `src/routes/creator.js` (팀·그룹 라우트 추가)
- Create: `src/views/creator/teams.ejs`
- Create: `src/views/creator/groups.ejs`
- Modify: `src/views/partials/creator-nav.ejs`
- Modify: `src/public/css/app.css` (팀 색 변수와 팀 배지)
- Test: `tests/creator-teams.routes.test.js`

**Interfaces:**
- Consumes: `teams.*` (Task 1), `groups.*` (Task 2), `participants.listParticipants(eventId)`
- Produces: 라우트 `GET|POST /e/:slug/manage/teams`, `POST /manage/teams/count`, `GET /manage/groups`, `POST /manage/groups`, `POST /manage/groups/members`, `POST /manage/groups/:id`, `POST /manage/groups/:id/delete`. CSS 클래스 `team-<key>`(변수 `--team`, `--team-ink`)와 `.badge[class*="team-"]`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/creator-teams.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const teams = require('../src/services/teams');
const groups = require('../src/services/groups');

test.beforeEach(H.resetDb);

async function setup() {
  const { event, participant } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  return { event, creator: participant, agent, base: `/e/${event.slug}/manage` };
}

test('팀 설정 화면에 기본 4팀이 보인다', async () => {
  const { agent, base } = await setup();
  const res = await agent.get(`${base}/teams`).expect(200);
  for (const name of ['레드', '블루', '그린', '옐로우']) assert.match(res.text, new RegExp(`value="${name}"`));
  assert.match(res.text, /팀 설정 저장/);
});

test('팀이 없던 운동회도 팀 설정 화면을 열면 기본 4팀이 생긴다', async () => {
  const { event, agent, base } = await setup();
  await H.db.query('DELETE FROM teams WHERE event_id = $1', [event.id]);
  await agent.get(`${base}/teams`).expect(200);
  assert.equal((await teams.listTeams(event.id)).length, 4);
});

test('팀 수를 바꾸고 팀 설정을 저장한다', async () => {
  const { event, creator, agent, base } = await setup();
  await agent.post(`${base}/teams/count`).type('form').send({ count: '2' }).expect(302);
  assert.equal((await teams.listTeams(event.id)).length, 2);
  const res = await agent.post(`${base}/teams`).type('form').send({
    name0: '청팀', color0: 'blue', leader0: String(creator.id), name1: '백팀', color1: 'black', leader1: '',
  }).expect(302);
  assert.equal(res.headers.location, `${base}/teams`);
  const list = await teams.listTeams(event.id);
  assert.deepEqual(list.map((t) => [t.name, t.color, t.leader_name]), [['청팀', 'blue', '생성자'], ['백팀', 'black', null]]);
});

test('팀 설정이 잘못되면 400과 입력값을 유지한다', async () => {
  const { agent, base } = await setup();
  const res = await agent.post(`${base}/teams`).type('form').send({
    name0: '같은이름', color0: 'red', name1: '같은이름', color1: 'blue', name2: '그린', color2: 'green', name3: '옐로우', color3: 'yellow',
  }).expect(400);
  assert.match(res.text, /중복/);
  assert.match(res.text, /value="같은이름"/);
  await agent.post(`${base}/teams/count`).type('form').send({ count: '9' }).expect(400);
});

test('뽑기 진행 중에는 팀 설정과 그룹을 바꿀 수 없다', async () => {
  const { event, agent, base } = await setup();
  await H.db.query('UPDATE events SET draw_open = true WHERE id = $1', [event.id]);
  const page = await agent.get(`${base}/teams`).expect(200);
  assert.match(page.text, /진행 중/);
  await agent.post(`${base}/teams/count`).type('form').send({ count: '3' }).expect(400);
  await agent.post(`${base}/groups`).type('form').send({ name: '축구부' }).expect(400);
});

test('그룹을 만들고 이름을 바꾸고 참가자를 넣고 지운다', async () => {
  const { event, agent, base } = await setup();
  const p = await H.addParticipant(event.id, '철수');
  await agent.post(`${base}/groups`).type('form').send({ name: '축구부' }).expect(302);
  const [group] = await groups.listGroups(event.id);
  await agent.post(`${base}/groups/${group.id}`).type('form').send({ name: '농구부' }).expect(302);
  await agent.post(`${base}/groups/members`).type('form').send({ [`g${p.id}`]: String(group.id) }).expect(302);
  const page = await agent.get(`${base}/groups`).expect(200);
  assert.match(page.text, /value="농구부"/);
  assert.match(page.text, new RegExp(`<option value="${group.id}" selected>농구부</option>`));
  await agent.post(`${base}/groups/${group.id}/delete`).expect(302);
  assert.equal((await groups.listGroups(event.id)).length, 0);
});

test('그룹 화면 오류와 없는 그룹', async () => {
  const { event, agent, base } = await setup();
  await agent.post(`${base}/groups`).type('form').send({ name: '' }).expect(400);
  const p = await H.addParticipant(event.id, '철수');
  const bad = await agent.post(`${base}/groups/members`).type('form').send({ [`g${p.id}`]: '999999' }).expect(400);
  assert.match(bad.text, /그룹 값/);
  await agent.post(`${base}/groups/999999`).type('form').send({ name: '이름' }).expect(404);
  await agent.post(`${base}/groups/999999/delete`).expect(404);
});

test('일반 참가자는 팀 설정에 들어갈 수 없고 관리자는 들어갈 수 있다', async () => {
  const { event, base } = await setup();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await member.get(`${base}/teams`).expect(302);
  assert.equal(res.headers.location, `${base}/unlock`);
  await member.post(`${base}/groups`).type('form').send({ name: '몰래' }).expect(302);
  assert.equal((await groups.listGroups(event.id)).length, 0);
  const admin = await H.adminAgent();
  await admin.get(`${base}/teams`).expect(200);
  await admin.get(`${base}/groups`).expect(200);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-teams.routes.test.js`
Expected: FAIL — 404 응답(라우트 없음)

- [ ] **Step 3: 라우트 추가**

`src/routes/creator.js` 상단 require에 추가:

```js
const teams = require('../services/teams');
const groups = require('../services/groups');
```

`module.exports = router;` 바로 위에 추가:

```js
async function renderTeams(req, res, { error = null, values = null, status = 200 } = {}) {
  await teams.ensureDefaultTeams(req.event.id);
  const [teamList, people] = await Promise.all([
    teams.listTeams(req.event.id),
    participants.listParticipants(req.event.id),
  ]);
  res.status(status).render('creator/teams', {
    title: '팀 설정', wide: true, teams: teamList, people, palette: teams.PALETTE, values, error, locked: req.event.draw_open,
  });
}

router.get('/teams', (req, res) => renderTeams(req, res));

router.post('/teams/count', async (req, res) => {
  try {
    await teams.setTeamCount(req.event.id, req.body.count);
    res.redirect(manage(res, '/teams'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderTeams(req, res, { error: err.message, status: 400 });
  }
});

router.post('/teams', async (req, res) => {
  try {
    await teams.saveTeams(req.event.id, req.body);
    res.redirect(manage(res, '/teams'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderTeams(req, res, { error: err.message, values: req.body, status: 400 });
  }
});

async function renderGroups(req, res, { error = null, status = 200 } = {}) {
  const [groupList, list] = await Promise.all([
    groups.listGroups(req.event.id),
    participants.listParticipants(req.event.id),
  ]);
  res.status(status).render('creator/groups', {
    title: '그룹', wide: true, groups: groupList, list, error, locked: req.event.draw_open,
  });
}

// 그룹 화면의 POST는 모두 같은 방식으로 처리한다. 결과가 null/false면 없는 그룹이다
async function groupAction(req, res, action) {
  try {
    const result = await action();
    if (result === null || result === false) return notFound(res);
    res.redirect(manage(res, '/groups'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderGroups(req, res, { error: err.message, status: 400 });
  }
}

router.get('/groups', (req, res) => renderGroups(req, res));
router.post('/groups', (req, res) => groupAction(req, res, () => groups.createGroup(req.event.id, req.body.name)));
// /groups/:id보다 먼저 등록해야 members가 id로 해석되지 않는다
router.post('/groups/members', (req, res) => groupAction(req, res, () => groups.saveMembership(req.event.id, req.body)));
router.post('/groups/:id', (req, res) => groupAction(req, res, () => groups.renameGroup(req.event.id, req.params.id, req.body.name)));
router.post('/groups/:id/delete', (req, res) => groupAction(req, res, () => groups.deleteGroup(req.event.id, req.params.id)));
```

`saveMembership`은 `undefined`를 돌려주므로 `groupAction`에서 리다이렉트된다.

- [ ] **Step 4: 팀 설정 화면 작성**

`src/views/creator/teams.ejs`:

```ejs
<h1 class="title">팀 설정</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<% if (locked) { %><p class="alert alert-error">팀 뽑기가 진행 중이라 팀 설정을 바꿀 수 없습니다. 바꾸려면 팀 뽑기 화면에서 초기화하세요.</p><% } %>
<form class="card row" method="post" action="<%= base %>/manage/teams/count">
  <label style="flex: 1">팀 수
    <select name="count" <%= locked ? 'disabled' : '' %>>
      <% for (let n = 2; n <= 8; n++) { %><option value="<%= n %>" <%= n === teams.length ? 'selected' : '' %>><%= n %>팀</option><% } %>
    </select>
  </label>
  <button class="btn" <%= locked ? 'disabled' : '' %>>팀 수 변경</button>
</form>
<form class="stack" method="post" action="<%= base %>/manage/teams">
  <div class="table-wrap">
    <table>
      <thead><tr><th>팀</th><th>이름</th><th>색</th><th>팀장</th></tr></thead>
      <tbody>
        <% teams.forEach((t, i) => { const v = (field, fallback) => values && values[field + i] !== undefined ? String(values[field + i]) : String(fallback ?? ''); %>
        <tr>
          <td><span class="badge team-<%= t.color %>"><%= t.palette ? t.palette.mark : '' %> <%= i + 1 %></span></td>
          <td><input name="name<%= i %>" value="<%= v('name', t.name) %>" maxlength="20" aria-label="<%= i + 1 %>번 팀 이름" <%= locked ? 'disabled' : '' %>></td>
          <td>
            <select name="color<%= i %>" aria-label="<%= i + 1 %>번 팀 색" <%= locked ? 'disabled' : '' %>>
              <% palette.forEach((c) => { %><option value="<%= c.key %>" <%= v('color', t.color) === c.key ? 'selected' : '' %>><%= c.mark %> <%= c.name %></option><% }) %>
            </select>
          </td>
          <td>
            <select name="leader<%= i %>" aria-label="<%= i + 1 %>번 팀장" <%= locked ? 'disabled' : '' %>>
              <option value="">없음</option>
              <% people.forEach((p) => { %><option value="<%= p.id %>" <%= v('leader', t.leader_participant_id) === String(p.id) ? 'selected' : '' %>><%= p.name %><%= p.attendance === 'absent' ? ' (결석)' : '' %></option><% }) %>
            </select>
          </td>
        </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
  <% if (!locked) { %><button class="btn btn-primary">팀 설정 저장</button><% } %>
</form>
<p class="hint">팀장은 뽑기를 시작하면 자기 팀에 바로 들어갑니다. 팀장은 출석한 사람만 지정할 수 있습니다.</p>
```

- [ ] **Step 5: 그룹 화면 작성**

`src/views/creator/groups.ejs`:

```ejs
<h1 class="title">그룹</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<% if (locked) { %><p class="alert alert-error">팀 뽑기가 진행 중이라 그룹을 바꿀 수 없습니다. 바꾸려면 팀 뽑기 화면에서 초기화하세요.</p><% } %>
<p class="hint">같은 그룹에 넣은 사람들은 팀 뽑기에서 서로 다른 팀으로 흩어집니다. 그룹이 없는 사람은 혼자인 그룹으로 칩니다.</p>
<form class="card row" method="post" action="<%= base %>/manage/groups">
  <label style="flex: 1">새 그룹 이름<input name="name" maxlength="20" <%= locked ? 'disabled' : '' %>></label>
  <button class="btn" <%= locked ? 'disabled' : '' %>>그룹 추가</button>
</form>
<% if (groups.length) { %>
<div class="table-wrap">
  <table>
    <thead><tr><th>그룹</th><th>인원</th><th></th></tr></thead>
    <tbody>
      <% groups.forEach((g) => { const f = 'group-' + g.id; %>
      <tr>
        <td><input name="name" form="<%= f %>" value="<%= g.name %>" maxlength="20" aria-label="<%= g.name %> 그룹 이름" <%= locked ? 'disabled' : '' %>></td>
        <td class="tnum"><%= g.member_count %>명</td>
        <td>
          <div class="row">
            <form id="<%= f %>" method="post" action="<%= base %>/manage/groups/<%= g.id %>"><button class="btn btn-small" <%= locked ? 'disabled' : '' %>>이름 저장</button></form>
            <form method="post" action="<%= base %>/manage/groups/<%= g.id %>/delete" data-msg="<%= g.name %> 그룹을 지울까요? 소속 참가자는 그룹 없음이 됩니다." onsubmit="return confirm(this.dataset.msg)">
              <button class="btn btn-small btn-danger" <%= locked ? 'disabled' : '' %>>삭제</button>
            </form>
          </div>
        </td>
      </tr>
      <% }) %>
    </tbody>
  </table>
</div>
<% } %>
<form class="stack" method="post" action="<%= base %>/manage/groups/members" style="margin-top: 12px">
  <div class="table-wrap">
    <table>
      <thead><tr><th>이름</th><th>출석</th><th>그룹</th></tr></thead>
      <tbody>
        <% list.forEach((p) => { %>
        <tr>
          <td><strong><%= p.name %></strong></td>
          <td><%= p.attendance === 'present' ? '참석' : '미출석' %></td>
          <td>
            <select name="g<%= p.id %>" aria-label="<%= p.name %> 그룹" <%= locked ? 'disabled' : '' %>>
              <option value="">그룹 없음</option>
              <% groups.forEach((g) => { %><option value="<%= g.id %>" <%= String(p.group_id ?? '') === String(g.id) ? 'selected' : '' %>><%= g.name %></option><% }) %>
            </select>
          </td>
        </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
  <% if (!locked) { %><button class="btn btn-primary">그룹 저장</button><% } %>
</form>
```

- [ ] **Step 6: 관리 메뉴에 링크 추가**

`src/views/partials/creator-nav.ejs`의 시간표 링크 다음 줄에 추가:

```ejs
  <a href="<%= base %>/manage/teams">팀 설정</a>
  <a href="<%= base %>/manage/groups">그룹</a>
```

- [ ] **Step 7: 팀 색 CSS 추가**

`src/public/css/app.css`의 `:root` 안 `--team-yellow: #F4D34E;` 뒤에 이어서 추가:

```css
  --team-purple: #7A3FB0; --team-orange: #E0701F; --team-pink: #D6487E; --team-black: #24211E;
```

파일 끝(`@media (prefers-reduced-motion ...` 줄 앞)에 추가:

```css
/* 팀 색. 색만으로 구분하지 않도록 화면에서는 항상 기호와 함께 쓴다 */
.team-red { --team: var(--team-red); --team-ink: #fff; }
.team-blue { --team: var(--team-blue); --team-ink: #fff; }
.team-green { --team: var(--team-green); --team-ink: #fff; }
.team-yellow { --team: var(--team-yellow); --team-ink: var(--ink); }
.team-purple { --team: var(--team-purple); --team-ink: #fff; }
.team-orange { --team: var(--team-orange); --team-ink: var(--ink); }
.team-pink { --team: var(--team-pink); --team-ink: #fff; }
.team-black { --team: var(--team-black); --team-ink: #fff; }
.badge[class*="team-"] { background: var(--team); color: var(--team-ink); }
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 9: 커밋**

```bash
git add src/routes/creator.js src/views/creator/teams.ejs src/views/creator/groups.ejs src/views/partials/creator-nav.ejs src/public/css/app.css tests/creator-teams.routes.test.js
git commit -m "feat: 생성자 팀 설정과 그룹 관리 화면 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 배정 알고리즘(순수 함수)

**Files:**
- Create: `src/services/draw-assign.js`
- Test: `tests/draw-assign.test.js`

**Interfaces:**
- Produces:
  - `mulberry32(seed) → () => number` (시드 고정 난수, [0,1))
  - `assignAll({ teams, members, random = Math.random, attempts = 200 }) → { assignment: Map<memberId, teamId>, penalty }`. `teams: [{ id, leader: { id, groupKey } | null }]`, `members: [{ id, groupKey }]`(팀장 제외). 전체 인원(팀장 포함)이 팀 수보다 적으면 `Error`
  - `assignLate({ teams, random = Math.random }) → teamId`. `teams: [{ id, size, groupCount }]`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/draw-assign.test.js` (DB를 쓰지 않으므로 helpers를 불러오지 않는다):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { assignAll, assignLate, mulberry32 } = require('../src/services/draw-assign');

function scenario(random, withLeaders) {
  const k = 2 + Math.floor(random() * 7);
  const n = k + Math.floor(random() * (40 - k + 1));
  const people = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    groupKey: random() < 0.3 ? `solo:p${i}` : `g${Math.floor(random() * 6)}`,
  }));
  const teams = Array.from({ length: k }, (_, i) => ({
    id: `t${i}`,
    leader: withLeaders && random() < 0.5 ? people[i] : null,
  }));
  const leaderIds = new Set(teams.filter((t) => t.leader).map((t) => t.leader.id));
  return { teams, people, members: people.filter((p) => !leaderIds.has(p.id)) };
}

test('팀 인원은 항상 floor(N/k) 또는 ceil(N/k)이고 모두 정확히 한 번 배정된다', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const random = mulberry32(seed);
    const { teams, people, members } = scenario(random, seed % 2 === 0);
    const { assignment } = assignAll({ teams, members, random });
    assert.equal(assignment.size, members.length);
    const sizes = new Map(teams.map((t) => [t.id, t.leader ? 1 : 0]));
    for (const t of teams) if (t.leader) assert.ok(!assignment.has(t.leader.id), `seed ${seed}: 팀장이 다시 배정됨`);
    for (const m of members) {
      const teamId = assignment.get(m.id);
      assert.ok(sizes.has(teamId), `seed ${seed}: 알 수 없는 팀 ${teamId}`);
      sizes.set(teamId, sizes.get(teamId) + 1);
    }
    const lo = Math.floor(people.length / teams.length);
    for (const size of sizes.values()) {
      assert.ok(size === lo || size === lo + 1, `seed ${seed}: 팀 인원 ${[...sizes.values()]}`);
    }
  }
});

test('그룹이 팀 수 이하이고 팀장이 없으면 같은 그룹은 항상 다른 팀이다', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = mulberry32(seed);
    const k = 2 + (seed % 7);
    const members = [];
    let id = 0;
    const groupCount = 1 + Math.floor(random() * 8);
    for (let g = 0; g < groupCount; g++) {
      const size = 1 + Math.floor(random() * k);
      for (let i = 0; i < size; i++) members.push({ id: `p${id++}`, groupKey: `g${g}` });
    }
    while (members.length < k) { members.push({ id: `p${id}`, groupKey: `solo:p${id}` }); id++; }
    const teams = Array.from({ length: k }, (_, i) => ({ id: `t${i}`, leader: null }));
    const { assignment, penalty } = assignAll({ teams, members, random });
    assert.equal(penalty, 0, `seed ${seed}`);
    const seen = new Set();
    for (const m of members) {
      const key = `${m.groupKey}|${assignment.get(m.id)}`;
      assert.ok(!seen.has(key), `seed ${seed}: ${key} 중복`);
      seen.add(key);
    }
  }
});

test('팀장은 자기 팀의 한 자리와 그룹 인원으로 센다', () => {
  const teams = [{ id: 't0', leader: { id: 'L', groupKey: 'A' } }, { id: 't1', leader: null }];
  const members = [{ id: 'a', groupKey: 'A' }, { id: 'x', groupKey: 'solo:x' }, { id: 'y', groupKey: 'solo:y' }];
  for (let seed = 1; seed <= 50; seed++) {
    const { assignment, penalty } = assignAll({ teams, members, random: mulberry32(seed) });
    assert.equal(assignment.get('a'), 't1');
    assert.equal(penalty, 0);
    assert.equal([...assignment.values()].filter((t) => t === 't0').length, 1);
  }
});

test('같은 시드면 같은 결과다', () => {
  const { teams, members } = scenario(mulberry32(99), true);
  const a = assignAll({ teams, members, random: mulberry32(7) });
  const b = assignAll({ teams, members, random: mulberry32(7) });
  assert.deepEqual([...a.assignment], [...b.assignment]);
});

test('사람이 팀 수보다 적으면 오류', () => {
  const teams = [{ id: 't0', leader: null }, { id: 't1', leader: null }, { id: 't2', leader: null }];
  assert.throws(() => assignAll({ teams, members: [{ id: 'a', groupKey: 'solo:a' }] }), /팀 수/);
});

test('늦은 배정은 인원이 가장 적은 팀, 그중 그 그룹이 가장 적은 팀으로 간다', () => {
  const teams = [
    { id: 't0', size: 3, groupCount: 0 },
    { id: 't1', size: 2, groupCount: 1 },
    { id: 't2', size: 2, groupCount: 0 },
  ];
  for (let seed = 1; seed <= 20; seed++) assert.equal(assignLate({ teams, random: mulberry32(seed) }), 't2');
  const tie = [{ id: 'a', size: 1, groupCount: 0 }, { id: 'b', size: 1, groupCount: 0 }];
  const picked = new Set(Array.from({ length: 40 }, (_, i) => assignLate({ teams: tie, random: mulberry32(i + 1) })));
  assert.deepEqual([...picked].sort(), ['a', 'b']);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/draw-assign.test.js`
Expected: FAIL — `Cannot find module '../src/services/draw-assign'`

- [ ] **Step 3: 알고리즘 작성**

`src/services/draw-assign.js`:

```js
// 팀 뽑기 배정 계산. DB와 무관한 순수 함수이며 난수 함수를 받아 시드 고정 테스트를 할 수 있다

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 한 번의 시도: 팀별 정원을 정하고, 큰 그룹부터 그 그룹이 가장 적은 팀 → 남은 자리가 가장 많은 팀 순으로 채운다
function attemptOnce(teams, members, groupSize, random) {
  const k = teams.length;
  const total = members.length + teams.filter((t) => t.leader).length;
  const base = Math.floor(total / k);
  const bigger = new Set(shuffle(teams.map((t) => t.id), random).slice(0, total % k));
  const state = teams.map((t) => ({
    id: t.id,
    cap: base + (bigger.has(t.id) ? 1 : 0),
    size: t.leader ? 1 : 0,
    groups: new Map(t.leader ? [[t.leader.groupKey, 1]] : []),
  }));

  const byGroup = new Map();
  for (const m of members) {
    if (!byGroup.has(m.groupKey)) byGroup.set(m.groupKey, []);
    byGroup.get(m.groupKey).push(m);
  }
  // 섞은 뒤 안정 정렬하므로 크기가 같은 그룹끼리는 무작위 순서가 된다
  const order = shuffle([...byGroup.keys()], random).sort((a, b) => groupSize.get(b) - groupSize.get(a));

  const assignment = new Map();
  for (const key of order) {
    for (const member of shuffle(byGroup.get(key), random)) {
      const open = state.filter((s) => s.size < s.cap);
      const fewest = Math.min(...open.map((s) => s.groups.get(key) || 0));
      const spread = open.filter((s) => (s.groups.get(key) || 0) === fewest);
      const most = Math.max(...spread.map((s) => s.cap - s.size));
      const target = pick(spread.filter((s) => s.cap - s.size === most), random);
      target.size += 1;
      target.groups.set(key, (target.groups.get(key) || 0) + 1);
      assignment.set(member.id, target.id);
    }
  }

  let penalty = 0;
  for (const s of state) {
    for (const [key, n] of s.groups) penalty += Math.max(0, n - Math.ceil(groupSize.get(key) / k));
  }
  return { assignment, penalty };
}

function assignAll({ teams, members, random = Math.random, attempts = 200 }) {
  const leaders = teams.filter((t) => t.leader).map((t) => t.leader);
  if (members.length + leaders.length < teams.length) throw new Error('배정할 사람이 팀 수보다 적습니다');
  const groupSize = new Map();
  for (const person of [...members, ...leaders]) groupSize.set(person.groupKey, (groupSize.get(person.groupKey) || 0) + 1);

  let best = null;
  for (let i = 0; i < attempts; i++) {
    const result = attemptOnce(teams, members, groupSize, random);
    if (!best || result.penalty < best.penalty) best = result;
    if (best.penalty === 0) break;
  }
  return best;
}

// 시작 뒤에 봉투 없이 뽑는 사람: 인원이 가장 적은 팀 → 그 그룹이 가장 적은 팀 → 무작위
function assignLate({ teams, random = Math.random }) {
  const smallest = Math.min(...teams.map((t) => t.size));
  const small = teams.filter((t) => t.size === smallest);
  const fewest = Math.min(...small.map((t) => t.groupCount));
  return pick(small.filter((t) => t.groupCount === fewest), random).id;
}

module.exports = { mulberry32, assignAll, assignLate };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/draw-assign.js tests/draw-assign.test.js
git commit -m "feat: 팀 인원 균형과 그룹 분산을 지키는 배정 알고리즘 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 뽑기 서비스

**Files:**
- Create: `src/services/draw.js`
- Test: `tests/draw.service.test.js`

**Interfaces:**
- Consumes: `lockEvent` (Task 1), `teams.listTeams`, `teams.paletteOf` (Task 1), `assignAll`, `assignLate`, `mulberry32` (Task 4), `groups.createGroup` (Task 2, 테스트에서)
- Produces (`draw.js`):
  - `NOT_OPEN`, `ABSENT` (문구 상수)
  - `findStartProblems(teams, people) → string[]`, `startProblems(eventId) → Promise<string[]>`
  - `start(eventId, random = Math.random)`, `reset(eventId, confirm)`
  - `open(eventId, participantId, method = 'self', random = Math.random) → Reveal|null` (`method`는 `'self'|'proxy'`)
  - `move(eventId, participantId, teamId) → Reveal|null`
  - `myResult(eventId, participantId) → Reveal|null`
  - `progress(eventId) → [{ id, name, attendance, group_name, method, shown_team_id, is_leader }]`
  - `board(eventId) → { teams: [{...team, palette, members: [{ name, is_leader }]}], pending }`
  - `Reveal = { method, leaderName, team: { id, name, color, mark } }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/draw.service.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const draw = require('../src/services/draw');
const teams = require('../src/services/teams');
const groups = require('../src/services/groups');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

async function setup(count = 7) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  return { event, creator, people };
}

const envelope = async (pid) => (await H.db.query('SELECT team_id FROM participants WHERE id = $1', [pid])).rows[0].team_id;
const resultsOf = async (eventId) => (await H.db.query('SELECT * FROM draw_results WHERE event_id = $1', [eventId])).rows;
async function teamSizes(eventId) {
  const { rows } = await H.db.query(
    'SELECT count(*)::int AS n FROM participants WHERE event_id = $1 AND team_id IS NOT NULL GROUP BY team_id',
    [eventId],
  );
  return rows.map((r) => r.n).sort((a, b) => a - b);
}

test('시작 전 점검: 출석 인원, 팀장 결석', async () => {
  const { event } = await H.makeEvent();
  assert.match((await draw.startProblems(event.id)).join(), /출석한 참가자\(1명\)가 팀 수\(4개\)보다 적습니다/);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  for (let i = 1; i <= 4; i++) await H.addParticipant(event.id, `참가자${i}`);
  const [first] = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [first.id, absent.id]);
  assert.deepEqual(await draw.startProblems(event.id), ['레드 팀장 결석자님이 결석으로 되어 있습니다']);
  await assert.rejects(draw.start(event.id), /결석/);
  const after = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(after.rows[0].draw_open, false);
});

test('시작하면 출석자 전원이 봉투를 받고, 팀장만 공개되며, 같은 그룹은 흩어진다', async () => {
  const { event, creator, people } = await setup(7);
  const group = await groups.createGroup(event.id, '축구부');
  const grouped = people.slice(1, 5);
  for (const p of grouped) await H.db.query('UPDATE participants SET group_id = $2 WHERE id = $1', [p.id, group.id]);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  const [first] = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [first.id, creator.id]);

  await draw.start(event.id, mulberry32(1));

  const opened = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(opened.rows[0].draw_open, true);
  assert.equal(String(await envelope(creator.id)), String(first.id));
  for (const p of people) assert.ok(await envelope(p.id), `${p.name} 봉투 없음`);
  assert.equal(await envelope(absent.id), null);
  assert.deepEqual(await teamSizes(event.id), [2, 2, 2, 2]);
  const groupTeams = await Promise.all(grouped.map((p) => envelope(p.id)));
  assert.equal(new Set(groupTeams.map(String)).size, 4);
  const results = await resultsOf(event.id);
  assert.deepEqual(results.map((r) => [String(r.participant_id), r.method]), [[String(creator.id), 'leader']]);
  await assert.rejects(draw.start(event.id), /이미/);
});

test('봉투를 열면 봉투의 팀이 공개되고, 다시 열어도 같다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(2));
  const target = people[3];
  const first = await draw.open(event.id, target.id);
  assert.equal(String(first.team.id), String(await envelope(target.id)));
  assert.equal(first.method, 'self');
  assert.ok(first.team.mark);
  const again = await draw.open(event.id, target.id, 'proxy');
  assert.deepEqual(again, first);
  assert.equal((await resultsOf(event.id)).length, 1);
  assert.deepEqual(await draw.myResult(event.id, target.id), first);
  assert.equal(await draw.myResult(event.id, people[4].id), null);
  assert.equal(await draw.open(event.id, '999999'), null);
});

test('같은 사람이 동시에 두 번 열어도 결과 행은 하나다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(3));
  const [a, b] = await Promise.all([draw.open(event.id, people[2].id), draw.open(event.id, people[2].id)]);
  assert.deepEqual(a.team, b.team);
  assert.equal((await resultsOf(event.id)).length, 1);
});

test('준비 상태에서는 열 수 없고, 봉투 없는 결석자도 열 수 없다', async () => {
  const { event } = await setup(7);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await assert.rejects(draw.open(event.id, absent.id), new RegExp(draw.NOT_OPEN));
  await draw.start(event.id, mulberry32(4));
  await assert.rejects(draw.open(event.id, absent.id), /결석으로 표시/);
});

test('시작 뒤에 온 사람들이 동시에 뽑아도 팀 인원이 고르다', async () => {
  const { event } = await setup(7);
  await draw.start(event.id, mulberry32(5));
  const late = [];
  for (let i = 1; i <= 4; i++) late.push(await H.addParticipant(event.id, `늦은사람${i}`));
  const results = await Promise.all(late.map((p) => draw.open(event.id, p.id, 'proxy')));
  assert.ok(results.every((r) => r && r.method === 'proxy'));
  assert.deepEqual(await teamSizes(event.id), [3, 3, 3, 3]);
});

test('늦게 온 사람은 그 그룹이 적은 팀으로 간다', async () => {
  const { event, people } = await setup(7);
  const group = await groups.createGroup(event.id, '동창');
  await H.db.query('UPDATE participants SET group_id = $2 WHERE id = $1', [people[1].id, group.id]);
  await draw.start(event.id, mulberry32(6));
  const groupTeam = String(await envelope(people[1].id));
  for (let seed = 1; seed <= 3; seed++) {
    await H.db.query('UPDATE participants SET team_id = NULL WHERE event_id = $1 AND name LIKE $2', [event.id, '늦은%']);
    await H.db.query("DELETE FROM participants WHERE event_id = $1 AND name LIKE '늦은%'", [event.id]);
    const late = await H.addParticipant(event.id, `늦은${seed}`, { groupId: group.id });
    const r = await draw.open(event.id, late.id, 'self', mulberry32(seed));
    assert.notEqual(String(r.team.id), groupTeam);
  }
});

test('팀 옮기기는 공개 처리하고 팀장은 옮길 수 없다', async () => {
  const { event, creator, people } = await setup(7);
  const list = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [list[0].id, creator.id]);
  await assert.rejects(draw.move(event.id, people[2].id, list[1].id), new RegExp(draw.NOT_OPEN));
  await draw.start(event.id, mulberry32(7));
  const moved = await draw.move(event.id, people[2].id, list[3].id);
  assert.equal(moved.method, 'manual');
  assert.equal(String(moved.team.id), String(list[3].id));
  assert.equal(String(await envelope(people[2].id)), String(list[3].id));
  await draw.open(event.id, people[4].id);
  const removed = await draw.move(event.id, people[4].id, list[2].id);
  assert.equal(String(removed.team.id), String(list[2].id));
  assert.equal((await resultsOf(event.id)).filter((r) => String(r.participant_id) === String(people[4].id)).length, 1);
  await assert.rejects(draw.move(event.id, creator.id, list[1].id), /팀장은 옮길 수 없습니다/);
  await assert.rejects(draw.move(event.id, people[2].id, ''), /옮길 팀/);
  const { event: other } = await H.makeEvent();
  const [foreignTeam] = await teams.listTeams(other.id);
  assert.equal(await draw.move(event.id, people[2].id, foreignTeam.id), null);
  assert.equal(await draw.move(event.id, '999999', list[1].id), null);
});

test('초기화는 확인 문구가 맞을 때만 모두 되돌린다', async () => {
  const { event, people } = await setup(7);
  await draw.start(event.id, mulberry32(8));
  await draw.open(event.id, people[1].id);
  await assert.rejects(draw.reset(event.id, '초기 화'), /초기화/);
  await draw.reset(event.id, '  초기화 ');
  const e = await H.db.query('SELECT draw_open FROM events WHERE id = $1', [event.id]);
  assert.equal(e.rows[0].draw_open, false);
  assert.equal((await resultsOf(event.id)).length, 0);
  assert.deepEqual(await teamSizes(event.id), []);
});

test('현황판과 진행표는 공개된 결과만 보여 준다', async () => {
  const { event, creator, people } = await setup(7);
  const list = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [list[0].id, creator.id]);
  await draw.start(event.id, mulberry32(9));
  await draw.open(event.id, people[1].id);

  const b = await draw.board(event.id);
  const shown = b.teams.flatMap((t) => t.members.map((m) => m.name)).sort();
  assert.deepEqual(shown, ['생성자', '참가자1'].sort());
  assert.equal(b.teams[0].members[0].is_leader, true);
  assert.equal(b.pending, 6);

  const rows = await draw.progress(event.id);
  for (const row of rows) assert.ok(!('team_id' in row), 'progress가 봉투를 읽으면 안 된다');
  const hidden = rows.find((r) => r.name === '참가자2');
  assert.equal(hidden.method, null);
  assert.equal(hidden.shown_team_id, null);
  assert.equal(rows.find((r) => r.name === '생성자').is_leader, true);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/draw.service.test.js`
Expected: FAIL — `Cannot find module '../src/services/draw'`

- [ ] **Step 3: 뽑기 서비스 작성**

`src/services/draw.js`:

```js
const db = require('../db');
const { ValidationError } = require('./errors');
const { lockEvent } = require('./event-lock');
const { listTeams, paletteOf } = require('./teams');
const { assignAll, assignLate } = require('./draw-assign');

const NOT_OPEN = '팀 뽑기가 아직 열리지 않았습니다';
const ABSENT = '결석으로 표시되어 있어요. 생성자에게 알려 주세요';
const isId = (value) => /^[1-9]\d{0,17}$/.test(String(value));

// 그룹이 없는 사람은 혼자인 그룹으로 친다
const groupKeyOf = (p) => (p.group_id ? `g:${p.group_id}` : `solo:${p.id}`);

function findStartProblems(teamList, people) {
  const problems = [];
  if (teamList.length < 2) problems.push('팀이 2개 이상 있어야 합니다');
  const present = people.filter((p) => p.attendance === 'present');
  if (present.length < teamList.length) {
    problems.push(`출석한 참가자(${present.length}명)가 팀 수(${teamList.length}개)보다 적습니다`);
  }
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const seen = new Set();
  for (const team of teamList) {
    const leader = team.leader_participant_id ? byId.get(String(team.leader_participant_id)) : null;
    if (!leader) continue;
    if (leader.attendance !== 'present') problems.push(`${team.name} 팀장 ${leader.name}님이 결석으로 되어 있습니다`);
    if (seen.has(String(leader.id))) problems.push(`${leader.name}님이 두 팀의 팀장으로 지정되어 있습니다`);
    seen.add(String(leader.id));
  }
  return problems;
}

async function loadPeople(client, eventId) {
  const { rows } = await client.query(
    'SELECT id, name, attendance, group_id FROM participants WHERE event_id = $1 ORDER BY id',
    [eventId],
  );
  return rows;
}

async function startProblems(eventId) {
  const [teamList, people] = await Promise.all([listTeams(eventId), loadPeople(db, eventId)]);
  return findStartProblems(teamList, people);
}

async function start(eventId, random = Math.random) {
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (event.draw_open) throw new ValidationError('이미 팀 뽑기가 시작되었습니다');
    const teamList = await listTeams(eventId, client);
    const people = await loadPeople(client, eventId);
    const problems = findStartProblems(teamList, people);
    if (problems.length) throw new ValidationError(problems.join(' / '));

    const byId = new Map(people.map((p) => [String(p.id), p]));
    const leaderIds = new Set(teamList.filter((t) => t.leader_participant_id).map((t) => String(t.leader_participant_id)));
    const { assignment } = assignAll({
      teams: teamList.map((t) => {
        const leader = t.leader_participant_id ? byId.get(String(t.leader_participant_id)) : null;
        return { id: String(t.id), leader: leader ? { id: String(leader.id), groupKey: groupKeyOf(leader) } : null };
      }),
      members: people
        .filter((p) => p.attendance === 'present' && !leaderIds.has(String(p.id)))
        .map((p) => ({ id: String(p.id), groupKey: groupKeyOf(p) })),
      random,
    });

    const pids = [];
    const tids = [];
    for (const t of teamList) {
      if (t.leader_participant_id) { pids.push(String(t.leader_participant_id)); tids.push(String(t.id)); }
    }
    for (const [pid, tid] of assignment) { pids.push(pid); tids.push(tid); }

    await client.query('DELETE FROM draw_results WHERE event_id = $1', [eventId]);
    await client.query('UPDATE participants SET team_id = NULL WHERE event_id = $1', [eventId]);
    await client.query(
      `UPDATE participants p SET team_id = v.team_id
       FROM unnest($2::bigint[], $3::bigint[]) AS v(pid, team_id)
       WHERE p.event_id = $1 AND p.id = v.pid`,
      [eventId, pids, tids],
    );
    // 팀장은 시작과 동시에 공개된다
    await client.query(
      `INSERT INTO draw_results (event_id, participant_id, team_id, method)
       SELECT $1, leader_participant_id, id, 'leader' FROM teams
       WHERE event_id = $1 AND leader_participant_id IS NOT NULL`,
      [eventId],
    );
    await client.query('UPDATE events SET draw_open = true WHERE id = $1', [eventId]);
  });
}

async function reset(eventId, confirm) {
  if (String(confirm ?? '').trim() !== '초기화') throw new ValidationError('확인 문구로 "초기화"를 입력해 주세요');
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    await client.query('DELETE FROM draw_results WHERE event_id = $1', [eventId]);
    await client.query('UPDATE participants SET team_id = NULL WHERE event_id = $1', [eventId]);
    await client.query('UPDATE events SET draw_open = false WHERE id = $1', [eventId]);
  });
}

// 공개 기록만 읽는다. 봉투(participants.team_id)를 밖으로 내보내는 유일한 통로다
async function revealOf(client, eventId, participantId) {
  const { rows } = await client.query(
    `SELECT d.method, t.id AS team_id, t.name AS team_name, t.color, l.name AS leader_name
     FROM draw_results d
     JOIN teams t ON t.id = d.team_id
     LEFT JOIN participants l ON l.id = t.leader_participant_id
     WHERE d.event_id = $1 AND d.participant_id = $2`,
    [eventId, participantId],
  );
  const r = rows[0];
  if (!r) return null;
  const palette = paletteOf(r.color);
  return {
    method: r.method,
    leaderName: r.leader_name,
    team: { id: r.team_id, name: r.team_name, color: r.color, mark: palette ? palette.mark : '' },
  };
}

async function myResult(eventId, participantId) {
  if (!isId(participantId)) return null;
  return revealOf(db, eventId, participantId);
}

async function lateTeam(client, eventId, person, random) {
  const { rows } = await client.query(
    `SELECT t.id,
       (SELECT count(*)::int FROM participants p WHERE p.team_id = t.id) AS size,
       (SELECT count(*)::int FROM participants p WHERE p.team_id = t.id AND p.group_id = $2::bigint) AS group_count
     FROM teams t WHERE t.event_id = $1 ORDER BY t.sort_order, t.id`,
    [eventId, person.group_id],
  );
  return assignLate({ teams: rows.map((r) => ({ id: String(r.id), size: r.size, groupCount: r.group_count })), random });
}

async function open(eventId, participantId, method = 'self', random = Math.random) {
  if (!isId(participantId)) return null;
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (!event.draw_open) throw new ValidationError(NOT_OPEN);
    const { rows } = await client.query('SELECT * FROM participants WHERE event_id = $1 AND id = $2', [eventId, participantId]);
    const person = rows[0];
    if (!person) return null;
    const existing = await revealOf(client, eventId, person.id);
    if (existing) return existing;
    let teamId = person.team_id;
    if (!teamId) {
      if (person.attendance !== 'present') throw new ValidationError(ABSENT);
      teamId = await lateTeam(client, eventId, person, random);
      await client.query('UPDATE participants SET team_id = $3 WHERE event_id = $1 AND id = $2', [eventId, person.id, teamId]);
    }
    await client.query(
      'INSERT INTO draw_results (event_id, participant_id, team_id, method) VALUES ($1, $2, $3, $4)',
      [eventId, person.id, teamId, method],
    );
    return revealOf(client, eventId, person.id);
  });
}

async function move(eventId, participantId, teamId) {
  if (!String(teamId ?? '').trim()) throw new ValidationError('옮길 팀을 골라 주세요');
  if (!isId(participantId) || !isId(teamId)) return null;
  return db.tx(async (client) => {
    const event = await lockEvent(client, eventId);
    if (!event.draw_open) throw new ValidationError(NOT_OPEN);
    const person = (await client.query('SELECT id FROM participants WHERE event_id = $1 AND id = $2', [eventId, participantId])).rows[0];
    const team = (await client.query('SELECT id FROM teams WHERE event_id = $1 AND id = $2', [eventId, teamId])).rows[0];
    if (!person || !team) return null;
    const led = await client.query('SELECT 1 FROM teams WHERE event_id = $1 AND leader_participant_id = $2', [eventId, person.id]);
    if (led.rows[0]) throw new ValidationError('팀장은 옮길 수 없습니다. 팀장을 바꾸려면 초기화한 뒤 팀 설정에서 바꿔 주세요');
    await client.query('UPDATE participants SET team_id = $3 WHERE event_id = $1 AND id = $2', [eventId, person.id, team.id]);
    await client.query(
      `INSERT INTO draw_results (event_id, participant_id, team_id, method) VALUES ($1, $2, $3, 'manual')
       ON CONFLICT (participant_id) DO UPDATE SET team_id = EXCLUDED.team_id, method = 'manual', drawn_at = now()`,
      [eventId, person.id, team.id],
    );
    return revealOf(client, eventId, person.id);
  });
}

// 생성자 진행표. 봉투는 읽지 않고 공개 기록만 읽는다
async function progress(eventId) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.attendance, g.name AS group_name, d.method, d.team_id AS shown_team_id,
       EXISTS (SELECT 1 FROM teams t WHERE t.event_id = p.event_id AND t.leader_participant_id = p.id) AS is_leader
     FROM participants p
     LEFT JOIN groups g ON g.id = p.group_id
     LEFT JOIN draw_results d ON d.participant_id = p.id
     WHERE p.event_id = $1
     ORDER BY p.created_at, p.id`,
    [eventId],
  );
  return rows;
}

async function board(eventId) {
  const teamList = await listTeams(eventId);
  const { rows } = await db.query(
    `SELECT d.team_id, p.name, coalesce(t.leader_participant_id = p.id, false) AS is_leader
     FROM draw_results d
     JOIN participants p ON p.id = d.participant_id
     JOIN teams t ON t.id = d.team_id
     WHERE d.event_id = $1
     ORDER BY is_leader DESC, d.drawn_at, d.id`,
    [eventId],
  );
  const { rows: pending } = await db.query(
    `SELECT count(*)::int AS n FROM participants p
     WHERE p.event_id = $1 AND p.attendance = 'present'
       AND NOT EXISTS (SELECT 1 FROM draw_results d WHERE d.participant_id = p.id)`,
    [eventId],
  );
  return {
    teams: teamList.map((t) => ({
      ...t,
      members: rows.filter((r) => String(r.team_id) === String(t.id)).map((r) => ({ name: r.name, is_leader: r.is_leader })),
    })),
    pending: pending[0].n,
  };
}

module.exports = {
  NOT_OPEN, ABSENT, findStartProblems, startProblems, start, reset, open, move, myResult, progress, board,
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/draw.js tests/draw.service.test.js
git commit -m "feat: 봉투 방식 뽑기 시작·열기·대리·이동·초기화 서비스 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 생성자 뽑기 진행 화면

**Files:**
- Modify: `src/routes/creator.js` (뽑기 라우트 추가)
- Create: `src/views/creator/draw.ejs`
- Modify: `src/views/partials/creator-nav.ejs`
- Test: `tests/creator-draw.routes.test.js`

**Interfaces:**
- Consumes: `draw.*` (Task 5), `teams.ensureDefaultTeams`, `teams.listTeams` (Task 1), CSS `team-<key>` (Task 3)
- Produces: 라우트 `GET /e/:slug/manage/draw`, `POST /manage/draw/start`, `POST /manage/draw/reset`(필드 `confirm`), `POST /manage/draw/proxy/:participantId`, `POST /manage/draw/move/:participantId`(필드 `teamId`). 진행표의 각 행은 `<tr id="row-<참가자 id>">`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/creator-draw.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const teams = require('../src/services/teams');

test.beforeEach(H.resetDb);

async function setup(count = 7) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  const agent = await H.creatorAgent(event);
  return { event, creator, people, agent, base: `/e/${event.slug}/manage/draw` };
}

const rowOf = (html, pid) => html.match(new RegExp(`<tr id="row-${pid}">[\\s\\S]*?</tr>`))[0];
const drawOpen = async (eventId) => (await H.db.query('SELECT draw_open FROM events WHERE id = $1', [eventId])).rows[0].draw_open;
const methodOf = async (pid) => (await H.db.query('SELECT method FROM draw_results WHERE participant_id = $1', [pid])).rows[0]?.method;

test('시작 전에는 점검 결과를 보여 주고, 문제가 있으면 시작 버튼이 꺼진다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const res = await agent.get(`/e/${event.slug}/manage/draw`).expect(200);
  assert.match(res.text, /출석한 참가자\(1명\)/);
  assert.match(res.text, /<button class="btn btn-primary" disabled>뽑기 시작<\/button>/);
  await agent.post(`/e/${event.slug}/manage/draw/start`).expect(400);
  assert.equal(await drawOpen(event.id), false);
});

test('팀이 없던 운동회도 뽑기 화면을 열면 기본 4팀이 생긴다', async () => {
  const { event, agent, base } = await setup();
  await H.db.query('DELETE FROM teams WHERE event_id = $1', [event.id]);
  await agent.get(base).expect(200);
  assert.equal((await teams.listTeams(event.id)).length, 4);
});

test('시작하면 진행표에 안 뽑은 사람의 팀이 드러나지 않는다', async () => {
  const { event, people, agent, base } = await setup();
  const res = await agent.post(`${base}/start`).expect(302);
  assert.equal(res.headers.location, base);
  assert.equal(await drawOpen(event.id), true);
  const page = await agent.get(base).expect(200);
  for (const p of people) {
    const row = rowOf(page.text, p.id);
    assert.match(row, /안 뽑음/);
    assert.doesNotMatch(row, /badge team-/);
    assert.doesNotMatch(row, /<option value="\d+" selected>/);
  }
  assert.match(page.text, /뽑기 초기화/);
});

test('대신 뽑기와 팀 옮기기', async () => {
  const { event, people, agent, base } = await setup();
  await agent.post(`${base}/start`).expect(302);
  await agent.post(`${base}/proxy/${people[0].id}`).expect(302);
  assert.equal(await methodOf(people[0].id), 'proxy');
  const list = await teams.listTeams(event.id);
  await agent.post(`${base}/move/${people[1].id}`).type('form').send({ teamId: String(list[2].id) }).expect(302);
  assert.equal(await methodOf(people[1].id), 'manual');
  const page = await agent.get(base).expect(200);
  assert.match(rowOf(page.text, people[0].id), /대리/);
  const movedRow = rowOf(page.text, people[1].id);
  assert.match(movedRow, /수동/);
  assert.match(movedRow, new RegExp(`badge team-${list[2].color}`));
  assert.match(movedRow, new RegExp(`<option value="${list[2].id}" selected>`));
  await agent.post(`${base}/proxy/999999`).expect(404);
  await agent.post(`${base}/move/${people[2].id}`).type('form').send({ teamId: '' }).expect(400);
  await agent.post(`${base}/move/${people[2].id}`).type('form').send({ teamId: '999999' }).expect(404);
});

test('팀장은 옮길 수 없고 진행표에 옮기기 칸이 없다', async () => {
  const { event, creator, agent, base } = await setup();
  const list = await teams.listTeams(event.id);
  await H.db.query('UPDATE teams SET leader_participant_id = $2 WHERE id = $1', [list[0].id, creator.id]);
  await agent.post(`${base}/start`).expect(302);
  const page = await agent.get(base).expect(200);
  const row = rowOf(page.text, creator.id);
  assert.match(row, /팀장/);
  assert.doesNotMatch(row, /옮기기/);
  const res = await agent.post(`${base}/move/${creator.id}`).type('form').send({ teamId: String(list[1].id) }).expect(400);
  assert.match(res.text, /팀장은 옮길 수 없습니다/);
});

test('초기화는 확인 문구가 맞아야 한다', async () => {
  const { event, agent, base } = await setup();
  await agent.post(`${base}/start`).expect(302);
  const bad = await agent.post(`${base}/reset`).type('form').send({ confirm: '네' }).expect(400);
  assert.match(bad.text, /초기화/);
  assert.equal(await drawOpen(event.id), true);
  await agent.post(`${base}/reset`).type('form').send({ confirm: '초기화' }).expect(302);
  assert.equal(await drawOpen(event.id), false);
});

test('관리자는 뽑기를 진행할 수 있고 일반 참가자는 못 한다', async () => {
  const { event, base } = await setup();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const denied = await member.post(`${base}/start`).expect(302);
  assert.equal(denied.headers.location, `/e/${event.slug}/manage/unlock`);
  assert.equal(await drawOpen(event.id), false);
  const admin = await H.adminAgent();
  await admin.get(base).expect(200);
  await admin.post(`${base}/start`).expect(302);
  assert.equal(await drawOpen(event.id), true);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-draw.routes.test.js`
Expected: FAIL — 404 응답(라우트 없음)

- [ ] **Step 3: 라우트 추가**

`src/routes/creator.js` 상단 require에 추가:

```js
const draw = require('../services/draw');
```

Task 3에서 추가한 그룹 라우트 아래(`module.exports = router;` 위)에 추가:

```js
async function renderDraw(req, res, { error = null, status = 200 } = {}) {
  await teams.ensureDefaultTeams(req.event.id);
  const [teamList, rows, problems] = await Promise.all([
    teams.listTeams(req.event.id),
    draw.progress(req.event.id),
    req.event.draw_open ? [] : draw.startProblems(req.event.id),
  ]);
  res.status(status).render('creator/draw', {
    title: '팀 뽑기', wide: true, teams: teamList, rows, problems, open: req.event.draw_open, error,
  });
}

// 뽑기 화면의 POST는 모두 같은 방식으로 처리한다. 결과가 null이면 없는 참가자·팀이다
async function drawAction(req, res, action) {
  try {
    const result = await action();
    if (result === null) return notFound(res);
    res.redirect(manage(res, '/draw'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDraw(req, res, { error: err.message, status: 400 });
  }
}

router.get('/draw', (req, res) => renderDraw(req, res));
router.post('/draw/start', (req, res) => drawAction(req, res, () => draw.start(req.event.id)));
router.post('/draw/reset', (req, res) => drawAction(req, res, () => draw.reset(req.event.id, req.body.confirm)));
router.post('/draw/proxy/:participantId', (req, res) => drawAction(req, res, () => draw.open(req.event.id, req.params.participantId, 'proxy')));
router.post('/draw/move/:participantId', (req, res) => drawAction(req, res, () => draw.move(req.event.id, req.params.participantId, req.body.teamId)));
```

- [ ] **Step 4: 뽑기 진행 화면 작성**

`src/views/creator/draw.ejs`:

```ejs
<h1 class="title">팀 뽑기</h1>
<%- include('../partials/creator-nav') %>
<%- include('../partials/alert') %>
<% const teamById = new Map(teams.map((t) => [String(t.id), t])); const methodLabel = { self: '뽑음', proxy: '대리', manual: '수동', leader: '팀장' }; %>
<section class="card">
  <h2>팀</h2>
  <div class="row">
    <% teams.forEach((t) => { %><span class="badge team-<%= t.color %>"><%= t.palette ? t.palette.mark : '' %> <%= t.name %><% if (t.leader_name) { %> · 팀장 <%= t.leader_name %><% } %></span><% }) %>
  </div>
</section>
<% if (!open) { %>
<section class="card stack">
  <h2>뽑기 시작</h2>
  <% if (problems.length) { %>
  <ul class="list"><% problems.forEach((p) => { %><li><%= p %></li><% }) %></ul>
  <% } else { %>
  <p>준비가 끝났어요. 시작하면 출석한 참가자 전원의 팀이 봉투에 담기고, 팀 설정과 그룹은 잠깁니다.</p>
  <% } %>
  <form class="stack" method="post" action="<%= base %>/manage/draw/start">
    <button class="btn btn-primary"<%= problems.length ? ' disabled' : '' %>>뽑기 시작</button>
  </form>
  <p class="hint">결석으로 표시된 참가자는 봉투를 받지 않습니다. 시작 전에 출석을 확인하세요.</p>
</section>
<% } else { %>
<% const shownCount = rows.filter((r) => r.method).length; const pendingCount = rows.filter((r) => !r.method && r.attendance === 'present').length; %>
<section class="stats">
  <div><strong><%= shownCount %></strong>공개</div>
  <div><strong><%= pendingCount %></strong>안 뽑음</div>
  <div><strong><%= teams.length %></strong>팀</div>
</section>
<div class="table-wrap">
  <table>
    <thead><tr><th>이름</th><th>그룹</th><th>상태</th><th>팀</th><th>대신 뽑기</th><th>팀 옮기기</th></tr></thead>
    <tbody>
      <% rows.forEach((r) => { const team = r.shown_team_id ? teamById.get(String(r.shown_team_id)) : null; const f = 'move-' + r.id; %>
      <tr id="row-<%= r.id %>">
        <td><strong><%= r.name %></strong><% if (r.attendance === 'absent') { %> <span class="muted">결석</span><% } %></td>
        <td><%= r.group_name || '-' %></td>
        <td><%= r.method ? methodLabel[r.method] : '안 뽑음' %></td>
        <td><% if (team) { %><span class="badge team-<%= team.color %>"><%= team.palette ? team.palette.mark : '' %> <%= team.name %></span><% } else { %>-<% } %></td>
        <td><% if (!r.method && r.attendance === 'present') { %>
          <form method="post" action="<%= base %>/manage/draw/proxy/<%= r.id %>"><button class="btn btn-small">대신 뽑기</button></form>
        <% } %></td>
        <td><% if (!r.is_leader) { %>
          <div class="row" style="flex-wrap: nowrap">
            <select name="teamId" form="<%= f %>" aria-label="<%= r.name %> 옮길 팀">
              <option value=""<%= team ? '' : ' selected' %>>팀 선택</option>
              <% teams.forEach((t) => { %><option value="<%= t.id %>"<%= team && String(team.id) === String(t.id) ? ' selected' : '' %>><%= t.name %></option><% }) %>
            </select>
            <form id="<%= f %>" method="post" action="<%= base %>/manage/draw/move/<%= r.id %>"><button class="btn btn-small">옮기기</button></form>
          </div>
        <% } %></td>
      </tr>
      <% }) %>
    </tbody>
  </table>
</div>
<p class="hint">아직 열지 않은 봉투의 팀은 생성자와 관리자에게도 보이지 않습니다. 안 뽑은 사람을 옮기면 그 순간 공개됩니다.</p>
<section class="card stack">
  <h2>뽑기 초기화</h2>
  <p class="hint">봉투와 뽑은 결과, 수동 배치를 모두 지우고 준비 상태로 돌아갑니다. 계속하려면 "초기화"라고 입력하세요.</p>
  <form class="stack" method="post" action="<%= base %>/manage/draw/reset">
    <label>확인 문구<input name="confirm" autocomplete="off"></label>
    <button class="btn btn-danger">초기화</button>
  </form>
</section>
<% } %>
```

테스트의 `<option value="\d+" selected>` 확인은 `<option value="<id>" selected>` 형태(공백 하나)를 전제로 한다. 위 템플릿은 `value="<%= t.id %>"` 바로 뒤에 `' selected'`를 붙여 정확히 그 형태가 된다.

- [ ] **Step 5: 관리 메뉴에 링크 추가**

`src/views/partials/creator-nav.ejs`의 그룹 링크 다음 줄에 추가:

```ejs
  <a href="<%= base %>/manage/draw">팀 뽑기</a>
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/routes/creator.js src/views/creator/draw.ejs src/views/partials/creator-nav.ejs tests/creator-draw.routes.test.js
git commit -m "feat: 생성자 뽑기 진행 화면(시작, 대리 뽑기, 팀 옮기기, 초기화) 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 참가자 뽑기 화면, 연출, 팀 현황판

**Files:**
- Modify: `src/routes/participant.js` (홈 데이터, `/draw`, `/teams`)
- Create: `src/views/partials/bib.ejs`
- Modify: `src/views/participant/home.ejs`
- Create: `src/views/participant/draw.ejs`
- Create: `src/views/participant/teams.ejs`
- Create: `src/public/js/draw.js`
- Modify: `src/public/css/app.css` (뽑기통, 연출, 배번표 띠, 팀 카드)
- Test: `tests/participant-draw.routes.test.js`

**Interfaces:**
- Consumes: `draw.open`, `draw.myResult`, `draw.board`, `draw.NOT_OPEN` (Task 5), `teams.listTeams` (Task 1), CSS `team-<key>` (Task 3)
- Produces: 라우트 `GET|POST /e/:slug/draw`, `GET /e/:slug/teams`. `POST /draw`는 `Accept: application/json`이면 `{ team: { name, color, mark }, leaderName }`(준비 상태 409 `{ error }`, 검증 실패 400 `{ error }`), 아니면 303 `/draw`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/participant-draw.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const draw = require('../src/services/draw');
const teams = require('../src/services/teams');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

const TEAM_NAMES = ['레드', '블루', '그린', '옐로우'];

async function setup({ start = true, absent = false } = {}) {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '철수', pin: '2222' });
  for (let i = 1; i <= 6; i++) await H.addParticipant(event.id, `참가자${i}`);
  const me = (await H.db.query('SELECT * FROM participants WHERE event_id = $1 AND name = $2', [event.id, '철수'])).rows[0];
  if (absent) await H.db.query("UPDATE participants SET attendance = 'absent' WHERE id = $1", [me.id]);
  if (start) await draw.start(event.id, mulberry32(11));
  return { event, agent, me, base: `/e/${event.slug}` };
}

const envelopeName = async (pid) => (await H.db.query(
  'SELECT t.name FROM participants p JOIN teams t ON t.id = p.team_id WHERE p.id = $1', [pid],
)).rows[0].name;

test('준비 상태: 홈 안내, 뽑기 화면은 홈으로, POST는 409', async () => {
  const { agent, base } = await setup({ start: false });
  const home = await agent.get(`${base}/home`).expect(200);
  assert.match(home.text, /팀 뽑기 준비 중/);
  const page = await agent.get(`${base}/draw`).expect(302);
  assert.equal(page.headers.location, `${base}/home`);
  const json = await agent.post(`${base}/draw`).set('Accept', 'application/json').expect(409);
  assert.equal(json.body.error, draw.NOT_OPEN);
  const form = await agent.post(`${base}/draw`).expect(302);
  assert.equal(form.headers.location, `${base}/home`);
});

test('시작 직후 안 뽑은 참가자의 화면에는 자기 팀이 드러나지 않는다', async () => {
  const { agent, base } = await setup();
  const home = await agent.get(`${base}/home`).expect(200);
  assert.match(home.text, /팀 뽑기가 열렸어요/);
  for (const name of TEAM_NAMES) assert.doesNotMatch(home.text, new RegExp(name));
  const page = await agent.get(`${base}/draw`).expect(200);
  assert.match(page.text, /<div id="drawResult" aria-live="polite"><\/div>/);
  assert.match(page.text, /id="slot">\?</);
  const board = await agent.get(`${base}/teams`).expect(200);
  assert.doesNotMatch(board.text, /철수/);
  // 생성자 + 철수 + 참가자 6명 = 출석 8명, 팀장 없음
  assert.match(board.text, /아직 8명이 안 뽑았어요/);
});

test('JSON으로 뽑으면 봉투의 팀이 나오고 다시 뽑아도 같다', async () => {
  const { event, agent, me, base } = await setup();
  const expected = await envelopeName(me.id);
  const res = await agent.post(`${base}/draw`).set('Accept', 'application/json').expect(200);
  assert.equal(res.body.team.name, expected);
  assert.ok(res.body.team.mark);
  assert.ok(teams.PALETTE.some((c) => c.key === res.body.team.color));
  assert.equal(res.body.team.id, undefined);
  const again = await agent.post(`${base}/draw`).set('Accept', 'application/json').expect(200);
  assert.deepEqual(again.body, res.body);
  const rows = (await H.db.query('SELECT method FROM draw_results WHERE event_id = $1 AND participant_id = $2', [event.id, me.id])).rows;
  assert.deepEqual(rows.map((r) => r.method), ['self']);
});

test('자바스크립트 없이 폼으로 뽑아도 결과 화면과 홈 배번표에 팀이 나온다', async () => {
  const { agent, me, base } = await setup();
  const expected = await envelopeName(me.id);
  const res = await agent.post(`${base}/draw`).expect(303);
  assert.equal(res.headers.location, `${base}/draw`);
  const page = await agent.get(`${base}/draw`).expect(200);
  assert.match(page.text, new RegExp(`${expected}팀`));
  assert.match(page.text, /팀 현황 보기/);
  assert.doesNotMatch(page.text, /id="drawForm"/);
  const home = await agent.get(`${base}/home`).expect(200);
  assert.match(home.text, new RegExp(`${expected}팀`));
  assert.match(home.text, /class="bib team-/);
  const board = await agent.get(`${base}/teams`).expect(200);
  assert.match(board.text, /철수/);
  assert.match(board.text, /아직 7명이 안 뽑았어요/);
});

test('봉투 없는 결석자는 뽑을 수 없다', async () => {
  const { agent, base } = await setup({ absent: true });
  const home = await agent.get(`${base}/home`).expect(200);
  assert.match(home.text, /결석으로 표시되어 있어요/);
  const res = await agent.post(`${base}/draw`).set('Accept', 'application/json').expect(400);
  assert.equal(res.body.error, draw.ABSENT);
  const form = await agent.post(`${base}/draw`).expect(400);
  assert.match(form.text, /결석으로 표시되어 있어요/);
});

test('시작 뒤에 들어온 사람도 뽑을 수 있다', async () => {
  const { event, base } = await setup();
  const late = await H.joinAgent(event, { name: '영희', pin: '3333' });
  const res = await late.post(`${base}/draw`).set('Accept', 'application/json').expect(200);
  assert.ok(TEAM_NAMES.includes(res.body.team.name));
});

test('팀 이름의 HTML과 </script>가 안전하게 들어간다', async () => {
  const { event, agent, base } = await setup();
  await H.db.query("UPDATE teams SET name = '</script><b>x' WHERE event_id = $1 AND sort_order = 0", [event.id]);
  const page = await agent.get(`${base}/draw`).expect(200);
  assert.equal(page.text.split('</script>').length - 1, 2);
  assert.match(page.text, /&lt;\/script&gt;&lt;b&gt;x/);
  assert.doesNotMatch(page.text, /<b>x/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/participant-draw.routes.test.js`
Expected: FAIL — 홈에 `팀 뽑기 준비 중` 없음, `/draw` 404

- [ ] **Step 3: 라우트 수정·추가**

`src/routes/participant.js` 상단 require에 추가:

```js
const draw = require('../services/draw');
const teams = require('../services/teams');
```

기존 `router.get('/home', ...)`을 아래로 바꾼다:

```js
router.get('/home', requireParticipant, async (req, res) => {
  const [announcementList, scheduleList, mine] = await Promise.all([
    announcements.list(req.event.id),
    schedules.list(req.event.id),
    draw.myResult(req.event.id, req.participant.id),
  ]);
  res.render('participant/home', {
    title: req.event.title, announcements: announcementList, schedules: scheduleList, mine,
  });
});
```

`router.post('/logout', ...)` 위에 추가:

```js
async function renderDraw(req, res, { error = null, status = 200 } = {}) {
  const [mine, teamList] = await Promise.all([
    draw.myResult(req.event.id, req.participant.id),
    teams.listTeams(req.event.id),
  ]);
  res.status(status).render('participant/draw', { title: '팀 뽑기', mine, teams: teamList, error });
}

router.get('/draw', requireParticipant, async (req, res) => {
  if (!req.event.draw_open) return res.redirect(`${res.locals.base}/home`);
  await renderDraw(req, res);
});

router.post('/draw', requireParticipant, async (req, res) => {
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  if (!req.event.draw_open) {
    return wantsJson ? res.status(409).json({ error: draw.NOT_OPEN }) : res.redirect(`${res.locals.base}/home`);
  }
  try {
    const result = await draw.open(req.event.id, req.participant.id, 'self');
    if (!result) return notFound(res);
    if (wantsJson) {
      return res.json({
        team: { name: result.team.name, color: result.team.color, mark: result.team.mark },
        leaderName: result.leaderName,
      });
    }
    res.redirect(303, `${res.locals.base}/draw`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    if (wantsJson) return res.status(400).json({ error: err.message });
    await renderDraw(req, res, { error: err.message, status: 400 });
  }
});

router.get('/teams', requireParticipant, async (req, res) => {
  const board = await draw.board(req.event.id);
  res.render('participant/teams', { title: '팀 현황', board });
});
```

- [ ] **Step 4: 배번표 partial 작성**

`src/views/partials/bib.ejs` (`result`는 `draw.myResult`의 반환값 또는 `null`):

```ejs
<div class="bib<%= result ? ' team-' + result.team.color : '' %>" aria-label="내 배번표">
  <div class="band"></div>
  <div class="meta"><%= event.title %> 참가자</div>
  <div class="name"><%= participant.name %></div>
  <% if (result) { %>
  <span class="badge team-<%= result.team.color %>"><%= result.team.mark %> <%= result.team.name %>팀</span>
  <% if (result.leaderName) { %><span class="badge">팀장: <%= result.leaderName %></span><% } %>
  <% } else { %>
  <span class="badge">팀 배정 전</span>
  <% } %>
</div>
```

- [ ] **Step 5: 홈 화면 수정**

`src/views/participant/home.ejs`에서 기존 배번표 블록 전체(`<div class="bib" aria-label="내 배번표">`부터 그 닫는 `</div>`까지 5줄)를 아래로 바꾼다:

```ejs
<%- include('../partials/bib', { result: mine }) %>
<section class="card stack">
  <h2>팀 뽑기</h2>
  <% if (!event.draw_open) { %>
  <p class="muted">팀 뽑기 준비 중이에요. 열리면 여기에서 뽑을 수 있어요.</p>
  <% } else if (mine) { %>
  <a class="btn btn-block" href="<%= base %>/teams">팀 현황 보기</a>
  <% } else if (participant.attendance === 'absent' && !participant.team_id) { %>
  <p class="muted">결석으로 표시되어 있어요. 생성자에게 알려 주세요.</p>
  <% } else { %>
  <p><strong>팀 뽑기가 열렸어요</strong></p>
  <a class="btn btn-primary btn-block" href="<%= base %>/draw">뽑기</a>
  <% } %>
</section>
```

`participant.team_id`는 봉투가 있는지만 판단하는 데 쓰고 화면에 출력하지 않는다.

- [ ] **Step 6: 뽑기 화면 작성**

`src/views/participant/draw.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title center">팀 뽑기</h1>
<%- include('../partials/alert') %>
<div class="row" style="justify-content: center">
  <% teams.forEach((t) => { %><span class="badge team-<%= t.color %>"><%= t.palette ? t.palette.mark : '' %> <%= t.name %></span><% }) %>
</div>
<div class="drum" id="drum">
  <div>
    <div class="slot" id="slot"><%= mine ? mine.team.mark + ' ' + mine.team.name : '?' %></div>
    <div class="muted" id="slotHint"><%= mine ? '결과 발표' : '두근두근' %></div>
  </div>
</div>
<div id="drawResult" aria-live="polite"><% if (mine) { %><%- include('../partials/bib', { result: mine }) %><% } %></div>
<div id="drawControls" class="stack">
  <% if (mine) { %>
  <a class="btn btn-block" href="<%= base %>/teams">팀 현황 보기</a>
  <% } else { %>
  <form id="drawForm" class="stack" method="post" action="<%= base %>/draw" data-teams-url="<%= base %>/teams">
    <button class="btn btn-primary draw-button">뽑기!</button>
  </form>
  <% } %>
  <a class="btn btn-ghost btn-block" href="<%= base %>/home">홈으로</a>
</div>
<% if (!mine) { %>
<template id="bibTemplate"><%- include('../partials/bib', { result: null }) %></template>
<script type="application/json" id="drawTeams"><%- JSON.stringify(teams.map((t) => ({ name: t.name, mark: t.palette ? t.palette.mark : '' }))).replace(/</g, '\\u003c') %></script>
<script src="/js/draw.js" defer></script>
<% } %>
```

JSON 안의 `<`를 `<`로 바꿔 팀 이름의 `</script>`가 스크립트 블록을 닫지 못하게 한다.

- [ ] **Step 7: 팀 현황판 작성**

`src/views/participant/teams.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title">팀 현황</h1>
<% if (!event.draw_open) { %>
<p class="card muted">팀 뽑기 준비 중이에요.</p>
<% } else { %>
<p class="muted">아직 <%= board.pending %>명이 안 뽑았어요. 새로고침하면 최신 결과가 보여요.</p>
<% board.teams.forEach((t) => { %>
<section class="card team-card team-<%= t.color %>">
  <h2><span class="badge team-<%= t.color %>"><%= t.palette ? t.palette.mark : '' %> <%= t.name %></span><span class="muted"><%= t.members.length %>명</span></h2>
  <% if (t.members.length === 0) { %><p class="muted">아직 아무도 없어요.</p><% } %>
  <ul class="list">
    <% t.members.forEach((m) => { %><li><%= m.name %><% if (m.is_leader) { %> <span class="badge">★ 팀장</span><% } %></li><% }) %>
  </ul>
</section>
<% }) %>
<% } %>
<a class="btn btn-ghost btn-block" href="<%= base %>/home">홈으로</a>
```

- [ ] **Step 8: 연출 스크립트 작성**

`src/public/js/draw.js`:

```js
// 팀 뽑기 연출. 결과는 서버 응답에서만 받고, 응답을 해석할 수 없으면 일반 폼 전송으로 넘긴다
(() => {
  const form = document.getElementById('drawForm');
  if (!form) return;
  const teams = JSON.parse(document.getElementById('drawTeams').textContent);
  const drum = document.getElementById('drum');
  const slot = document.getElementById('slot');
  const hint = document.getElementById('slotHint');
  const out = document.getElementById('drawResult');
  const controls = document.getElementById('drawControls');
  const homeLink = controls.querySelector('.btn-ghost');
  const template = document.getElementById('bibTemplate');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timers = [];

  function buildBib(data) {
    const bib = template.content.firstElementChild.cloneNode(true);
    bib.classList.add(`team-${data.team.color}`, 'reveal');
    const badge = bib.querySelector('.badge');
    badge.className = `badge team-${data.team.color}`;
    badge.textContent = `${data.team.mark} ${data.team.name}팀`;
    if (data.leaderName) {
      const leader = document.createElement('span');
      leader.className = 'badge';
      leader.textContent = `팀장: ${data.leaderName}`;
      bib.appendChild(leader);
    }
    return bib;
  }

  function show(data) {
    timers.forEach(clearTimeout);
    timers = [];
    slot.textContent = `${data.team.mark} ${data.team.name}`;
    hint.textContent = '결과 발표';
    out.replaceChildren(buildBib(data));
    const board = document.createElement('a');
    board.className = 'btn btn-block';
    board.href = form.dataset.teamsUrl;
    board.textContent = '팀 현황 보기';
    controls.replaceChildren(board, homeLink);
  }

  // 0–600ms 흔들림, 600–2400ms 팀 이름이 감속하며 지나감, 2400–2800ms 결과 등장
  function play(data) {
    if (reduce) return show(data);
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn btn-ghost btn-block';
    skip.textContent = '결과 바로 보기';
    skip.addEventListener('click', () => show(data));
    controls.replaceChildren(skip);
    hint.textContent = '섞는 중';
    drum.classList.remove('shake');
    void drum.offsetWidth;
    drum.classList.add('shake');
    let t = 600;
    let delay = 60;
    let i = 0;
    while (t < 2400) {
      const team = teams[i % teams.length];
      timers.push(setTimeout(() => { slot.textContent = `${team.mark} ${team.name}`; }, t));
      t += delay;
      delay = Math.round(delay * 1.18);
      i += 1;
    }
    timers.push(setTimeout(() => { slot.textContent = `${data.team.mark} ${data.team.name}`; }, 2400));
    timers.push(setTimeout(() => show(data), 2800));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    hint.textContent = '팀 확인 중';
    let res;
    let data;
    try {
      res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      data = await res.json();
    } catch {
      form.submit();
      return;
    }
    if (!res.ok || !data.team) {
      hint.textContent = data.error || '뽑기에 실패했어요. 다시 눌러 주세요';
      button.disabled = false;
      return;
    }
    play(data);
  });
})();
```

- [ ] **Step 9: CSS 추가**

`src/public/css/app.css` 파일 끝의 `@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }` 줄을 지우고, 파일 끝에 아래를 추가한다:

```css
/* 팀 뽑기 */
.drum { display: grid; place-items: center; width: 180px; aspect-ratio: 1; margin: 28px auto 24px; text-align: center; border: 3px solid var(--ink); border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0 30%, #FFE9D6 70%); box-shadow: 4px 5px 0 var(--ink); }
.drum .slot { min-height: 34px; padding: 0 12px; font: 400 26px/1.2 'Jua', sans-serif; }
.drum.shake { animation: shake 300ms ease-in-out 2; }
@keyframes shake { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-3deg); } 75% { transform: rotate(3deg); } }
.reveal { animation: reveal 400ms cubic-bezier(.2, .8, .2, 1) both; }
@keyframes reveal { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
.draw-button { width: 100%; min-height: 52px; }
.bib .band { display: none; position: absolute; left: 0; right: 0; top: 0; height: 8px; background: var(--team); }
.bib[class*="team-"] .band { display: block; }
.team-card { border-top: 6px solid var(--team); }
.team-card h2 { justify-content: space-between; }
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } .drum.shake, .reveal { animation: none; } }
```

- [ ] **Step 10: 테스트 통과 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 11: 브라우저로 연출 확인**

`npm run dev`로 띄운 뒤 운동회를 만들고 참가자 4명 이상을 입장시키고 뽑기를 시작한 다음, 참가자 화면에서 `뽑기!`를 눌러 아래를 확인한다(개발 DB에 만든 확인용 운동회는 끝나고 관리자 화면에서 삭제한다).

- 흔들림 → 팀 이름 감속 → 결과 배번표 등장(약 2.8초)
- "결과 바로 보기"로 바로 결과
- 결과 후 홈 배번표 상단 띠가 팀 색
- 폭 375px에서 가로 스크롤 없음

- [ ] **Step 12: 커밋**

```bash
git add src/routes/participant.js src/views/partials/bib.ejs src/views/participant/home.ejs src/views/participant/draw.ejs src/views/participant/teams.ejs src/public/js/draw.js src/public/css/app.css tests/participant-draw.routes.test.js
git commit -m "feat: 참가자 팀 뽑기 연출과 팀 현황판 추가

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
