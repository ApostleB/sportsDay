# 명량운동회 3단계(마니또) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 출석 참가자 전원을 하나의 순환으로 묶는 마니또를 배정하고, 각자 봉투로 자기 마니또만 확인하다가 생성자가 전체 맵을 공개하며, 결석·추가·삭제를 자동으로 최소 수정 반영하고, 생성자·관리자가 참가 마감을 걸 수 있게 한다.

**Architecture:** 순환 계산은 DB와 무관한 순수 함수(`manito-cycle.js`)로 두고, 상태 변경은 `manito.js` 서비스가 운동회 행을 `FOR UPDATE`로 잠근 트랜잭션 안에서 처리한다. 자동 반영 진입점 `syncPresence`는 참가자 서비스의 출석 변경·삭제·생성·입장 트랜잭션 안에서 호출되며, 바뀐 연결만 고친다(`applyLinks`). 생성자 요약은 집계만, 관리자 조회는 서비스에서 마스킹한 이름만, 맵은 `opened && !manito_locked`일 때만 이름을 돌려준다.

**Tech Stack:** Node 24(CommonJS), Express 5, EJS + express-ejs-layouts, PostgreSQL 17(`pg`), node:test + supertest

**Spec:** `docs/superpowers/specs/2026-10-12-sportsday-manito-design.md` (선행: `2026-10-11-sportsday-foundation-design.md`, `2026-10-12-sportsday-team-draw-design.md`)

## Global Constraints

- Node.js 24 이상, CommonJS(`require`), TypeScript 사용 안 함, 새 의존성 추가 없음
- 실시간 갱신(폴링, SSE, 소켓) 없음. 화면은 접속·새로고침 시점의 상태를 보여준다
- 상태 변경은 모두 POST. 사용자에게 보이는 문구는 모두 한국어
- 디자인은 기존 `src/public/css/app.css` 변수와 클래스(`card`, `stack`, `btn`, `btn-primary`, `btn-danger`, `btn-small`, `stats`, `hint`, `muted`, `alert`)를 따른다. 터치 영역 44px 이상
- 마니또 단계: `none`(준비) / `assigned`(배정됨) / `opened`(공개됨). 배정 최소 출석 인원 3명. 다시 배정 확인 문구 `다시 배정`(앞뒤 공백 무시)
- 공개 전에는 짝 정보가 생성자 화면·관리자 화면(마스킹 제외)·다른 참가자 화면 어디에도 나오지 않는다. 관리자 마니또 정보는 `mask.js`의 `maskName`으로 서비스에서 마스킹한다
- 맵은 `manito_stage === 'opened' && !manito_locked`일 때만 보인다. 개인 확인은 잠금과 무관하다
- 참가 마감 문구: `참가가 마감되었습니다`. 마감은 처음 보는 이름의 입장만 막는다. 재입장과 생성자 직접 추가는 허용
- 모든 서비스: id는 `/^[1-9]\d{0,17}$/`로 검증, 모든 쿼리는 `event_id`로 범위 제한, 검증 실패는 `ValidationError`. 잘못된 형식의 참가자 id는 `null`/`false`를 돌려준다(라우트가 404 등으로 처리)
- 마니또 상태 변경과 자동 반영은 모두 `db.tx` 안에서 `lockEvent(client, eventId)`로 운동회 행을 먼저 잠근다
- 테스트는 원격 공유 테스트 DB를 쓰므로 반드시 `npm test`(이미 `--test-concurrency=1`)로 실행한다. 단일 파일은 `NODE_ENV=test node --test --test-concurrency=1 tests/<file>`
- `.env`는 읽지도, 출력하지도, 수정하지도 않는다
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **공개 전 짝 누출**: 배정 직후 생성자 마니또 화면, 참가자 홈·봉투·맵 화면, 관리자 상세 마니또 칸에 원래 이름 쌍이 나오면 안 된다 → Task 4, 5, 6 테스트
2. **동시 출석 변경·추가**: 여러 요청이 동시에 들어와도 순환이 하나의 고리로 남아야 한다 → Task 3 테스트
3. **순환에 있는 참가자 삭제**: `manito_links`의 `ON DELETE CASCADE`가 앞사람의 연결까지 지우기 전에 이어 붙여야 한다(먼저 `syncPresence(..., { leaving: true })`, 그다음 DELETE) → Task 2, Task 3 테스트
4. **마감 직전에 읽은 운동회 행**: `loadEvent`가 읽은 행은 `join_closed=false`인데 그 사이 마감되었으면 새 이름 입장은 거부되어야 한다(트랜잭션 안에서 다시 읽음) → Task 3 테스트
5. **이름에 HTML 문자**: `<b>굵게</b>` 같은 이름이 맵·봉투에서 이스케이프되어야 한다 → Task 4 테스트

## Rulings carried into the plan

- 스펙 §9의 "관리자 화면은 마스킹된 이름만 보이고 원래 이름은 HTML에 없음"은 **마니또 칸**(`<section ... id="manito">`)에 대한 요구로 해석한다. 관리자 상세의 기존 참가자 표(1단계, PIN 재설정용)는 원래 이름을 계속 보여 준다. 테스트는 마니또 칸만 잘라 검사하고, 페이지 전체에서 원래 이름 쌍(`A → B`)이 없는지도 검사한다
- 봉투를 연 직후에는 `/manito?opened=1`로 보내 `<details open>`으로 한 번 펼쳐 보여 준다. 이후 방문은 접힌 상태
- 원형 맵은 화면 폭 768px 이상이고 인원이 16명 이하일 때만 쓴다(그보다 많으면 이름이 겹치므로 세로 목록 유지)
- 생성자 화면의 맵 링크는 참가자 세션이 있어야 열린다(관리자 세션만으로 들어온 경우 입장 화면으로 감). 스펙에 별도 요구 없음

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/services/manito-cycle.js` (새) | 순수 함수: `buildCycle`, `removeFromCycle`, `insertIntoCycle`, `cycleOrder` |
| `db/migrations/004_manito.sql` (새) | `events.join_closed`, 지연 검사 유일 제약 |
| `src/services/manito.js` (새) | 배정·다시 배정·공개·잠금·개인 조회·확인·맵·요약·관리자 조회·`syncPresence` |
| `src/services/participants.js` | 출석 변경·삭제·생성·새 이름 입장에서 `syncPresence` 호출, 입장 트랜잭션과 마감 검사 |
| `src/services/events.js` | `setJoinClosed` |
| `src/services/format.js` | `manitoStageLabel` |
| `src/routes/participant.js` | 홈 카드 데이터, `/manito`, `/manito/open`, `/manito/map` |
| `src/routes/creator.js` | `/manage/manito*`, `/manage/join-closed` |
| `src/routes/admin.js` | 상세의 마니또·마감 칸, `/manito-lock`, `/join-closed` |
| `src/views/participant/manito.ejs`, `manito-map.ejs` (새) | 봉투, 맵 |
| `src/views/creator/manito.ejs` (새) | 생성자 마니또 관리 |
| `src/views/participant/home.ejs`, `creator/dashboard.ejs`, `admin/event.ejs`, `partials/creator-nav.ejs` | 카드·버튼·메뉴 추가 |
| `src/public/css/app.css` | 봉투·맵 스타일 |
| `tests/helpers.js` | `manitoLinks`, `assertManitoCycle` |

---

### Task 1: 순환 계산 순수 함수

**Files:**
- Create: `src/services/manito-cycle.js`
- Test: `tests/manito-cycle.test.js`

**Interfaces:**
- Consumes: `mulberry32(seed)` from `src/services/draw-assign.js` (테스트에서만)
- Produces (모든 id는 문자열, `links`는 `[{ giver: string, receiver: string }]`, 입력 배열을 바꾸지 않고 새 배열을 돌려준다):
  - `buildCycle(ids: Array<string|number>, random: () => number) → links` — 섞어서 하나의 고리. 2명이면 서로, 0~1명이면 `[]`
  - `removeFromCycle(links, id) → links` — A→X→B를 A→B로. 순환에 없으면 그대로(복사), 2명 순환에서 빼면 `[]`
  - `insertIntoCycle(links, id, random) → links` — 무작위 연결 A→B를 A→id→B로. `links`가 비었거나 이미 있으면 그대로(복사)
  - `cycleOrder(links) → string[]` — 숫자로 가장 작은 giver부터 고리를 따라간 giver 순서. 하나의 고리가 아니면 길이가 `links.length`와 다르다

- [ ] **Step 1: Write the failing test**

`tests/manito-cycle.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCycle, removeFromCycle, insertIntoCycle, cycleOrder } = require('../src/services/manito-cycle');
const { mulberry32 } = require('../src/services/draw-assign');

const idsOf = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

// 하나의 고리이고, 자기 자신이 없고, 모두 한 번씩 주고받는다
function assertCycle(links, ids) {
  const expected = [...ids].map(String).sort();
  assert.deepEqual(links.map((l) => l.giver).sort(), expected);
  assert.deepEqual(links.map((l) => l.receiver).sort(), expected);
  for (const l of links) assert.notEqual(l.giver, l.receiver);
  if (links.length) assert.equal(cycleOrder(links).length, links.length, '하나의 고리가 아니다');
}

// receiver가 바뀐 기존 giver
function changedGivers(before, after) {
  const prev = new Map(before.map((l) => [l.giver, l.receiver]));
  return after.filter((l) => prev.has(l.giver) && prev.get(l.giver) !== l.receiver).map((l) => l.giver);
}

test('buildCycle: 3~40명 모두 하나의 고리', () => {
  for (let n = 3; n <= 40; n++) {
    for (let seed = 1; seed <= 5; seed++) assertCycle(buildCycle(idsOf(n), mulberry32(seed * 100 + n)), idsOf(n));
  }
});

test('buildCycle: 숫자 id도 문자열로 다루고, 2명은 서로, 0~1명은 빈 순환', () => {
  assertCycle(buildCycle([10, 20, 30], mulberry32(1)), ['10', '20', '30']);
  assert.deepEqual(buildCycle(['1', '2'], mulberry32(1)).map((l) => [l.giver, l.receiver]).sort(), [['1', '2'], ['2', '1']]);
  assert.deepEqual(buildCycle(['1'], mulberry32(1)), []);
  assert.deepEqual(buildCycle([], mulberry32(1)), []);
});

test('buildCycle: 시드가 같으면 같은 결과, 입력을 바꾸지 않는다', () => {
  const ids = idsOf(8);
  const copy = [...ids];
  assert.deepEqual(buildCycle(ids, mulberry32(7)), buildCycle(ids, mulberry32(7)));
  assert.deepEqual(ids, copy);
});

test('removeFromCycle: 앞사람만 다음 사람으로 잇는다', () => {
  const links = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '3' }, { giver: '3', receiver: '4' }, { giver: '4', receiver: '1' }];
  const after = removeFromCycle(links, '3');
  assertCycle(after, ['1', '2', '4']);
  assert.deepEqual(after.find((l) => l.giver === '2'), { giver: '2', receiver: '4' });
  assert.deepEqual(changedGivers(links, after), ['2']);
  assert.equal(links.length, 4, '입력을 바꾸면 안 된다');
});

test('removeFromCycle: 3→2명은 서로, 2→빈 순환, 없는 사람은 그대로', () => {
  const three = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '3' }, { giver: '3', receiver: '1' }];
  const two = removeFromCycle(three, 2);
  assertCycle(two, ['1', '3']);
  assert.deepEqual(removeFromCycle(two, '1'), []);
  assert.deepEqual(removeFromCycle(three, '9'), three);
  assert.notEqual(removeFromCycle(three, '9'), three, '복사본을 돌려줘야 한다');
  assert.deepEqual(removeFromCycle([], '1'), []);
});

test('insertIntoCycle: 한 연결 사이에 끼우고 바뀐 기존 giver는 1명', () => {
  const links = buildCycle(idsOf(5), mulberry32(3));
  const after = insertIntoCycle(links, 99, mulberry32(4));
  assertCycle(after, [...idsOf(5), '99']);
  assert.equal(changedGivers(links, after).length, 1);
  const a = changedGivers(links, after)[0];
  assert.equal(after.find((l) => l.giver === a).receiver, '99');
  assert.equal(after.find((l) => l.giver === '99').receiver, links.find((l) => l.giver === a).receiver);
});

test('insertIntoCycle: 2명 순환에 끼우면 3명, 빈 순환과 이미 있는 사람은 그대로', () => {
  const two = buildCycle(['1', '2'], mulberry32(1));
  assertCycle(insertIntoCycle(two, '3', mulberry32(2)), ['1', '2', '3']);
  assert.deepEqual(insertIntoCycle([], '1', mulberry32(1)), []);
  assert.deepEqual(insertIntoCycle(two, '1', mulberry32(1)), two);
});

test('빼기·끼우기를 수백 번 섞어도 항상 하나의 고리이고 바뀐 기존 giver는 최대 1명', () => {
  const random = mulberry32(2026);
  const pool = idsOf(12);
  let present = new Set(pool.slice(0, 6));
  let links = buildCycle([...present], random);
  for (let step = 0; step < 600; step++) {
    const id = pool[Math.floor(random() * pool.length)];
    const before = links;
    if (present.has(id)) {
      present.delete(id);
      links = removeFromCycle(links, id);
    } else {
      present.add(id);
      // 빈 순환에 합류하면 서비스처럼 출석자 전원으로 새로 만든다
      links = links.length === 0 ? buildCycle([...present], random) : insertIntoCycle(links, id, random);
    }
    if (before.length > 0 && links.length > 0) assert.ok(changedGivers(before, links).length <= 1, `step ${step}`);
    assertCycle(links, present.size >= 2 ? [...present] : []);
  }
});

test('cycleOrder: 가장 작은 id부터 고리 순서, 고리가 둘이면 길이가 짧다', () => {
  const links = [{ giver: '30', receiver: '4' }, { giver: '4', receiver: '100' }, { giver: '100', receiver: '30' }];
  assert.deepEqual(cycleOrder(links), ['4', '100', '30']);
  assert.deepEqual(cycleOrder([]), []);
  const broken = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '1' }, { giver: '3', receiver: '4' }, { giver: '4', receiver: '3' }];
  assert.equal(cycleOrder(broken).length, 2);
});
```

Note on the mixing test: when the cycle shrinks to 1 present person, `removeFromCycle` on a 2-person cycle gives `[]`, and `present.size` is 1, so `assertCycle(links, [])` holds. When the second person comes back, the `links.length === 0` branch rebuilds with both.

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/manito-cycle.test.js`
Expected: FAIL with `Cannot find module '../src/services/manito-cycle'`

- [ ] **Step 3: Write minimal implementation**

`src/services/manito-cycle.js`:

```js
// 마니또 순환 계산. DB와 무관한 순수 함수이며 난수 함수를 받아 시드 고정 테스트를 할 수 있다
// links는 [{ giver, receiver }]이고 id는 모두 문자열로 다룬다. 입력 배열은 바꾸지 않는다

function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const copy = (links) => links.map((l) => ({ giver: l.giver, receiver: l.receiver }));

// 섞은 순서대로 이어 하나의 고리를 만든다. 2명이면 서로의 마니또, 1명 이하면 빈 순환
function buildCycle(ids, random) {
  const order = shuffle(ids.map(String), random);
  if (order.length < 2) return [];
  return order.map((giver, i) => ({ giver, receiver: order[(i + 1) % order.length] }));
}

// A→X→B를 A→B로 잇는다. 2명 순환에서 빠지면 남은 1명은 마니또가 없으므로 빈 순환
function removeFromCycle(links, id) {
  const key = String(id);
  const own = links.find((l) => l.giver === key);
  if (!own) return copy(links);
  if (links.length <= 2) return [];
  return links
    .filter((l) => l.giver !== key)
    .map((l) => ({ giver: l.giver, receiver: l.receiver === key ? own.receiver : l.receiver }));
}

// 무작위 연결 A→B를 골라 A→새 사람→B로 만든다. 빈 순환은 서비스가 새로 만든다
function insertIntoCycle(links, id, random) {
  const key = String(id);
  if (links.length === 0 || links.some((l) => l.giver === key)) return copy(links);
  const at = Math.floor(random() * links.length);
  const target = links[at];
  return [
    ...links.map((l, i) => ({ giver: l.giver, receiver: i === at ? key : l.receiver })),
    { giver: key, receiver: target.receiver },
  ];
}

// 숫자로 가장 작은 giver부터 고리를 따라간 순서. 하나의 고리가 아니면 길이가 links.length와 다르다
function cycleOrder(links) {
  if (links.length === 0) return [];
  const next = new Map(links.map((l) => [l.giver, l.receiver]));
  const start = [...next.keys()].reduce((a, b) => (BigInt(a) <= BigInt(b) ? a : b));
  const order = [start];
  for (let cur = next.get(start); cur !== start && cur !== undefined && order.length <= links.length; cur = next.get(cur)) {
    order.push(cur);
  }
  return order;
}

module.exports = { buildCycle, removeFromCycle, insertIntoCycle, cycleOrder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/manito-cycle.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/manito-cycle.js tests/manito-cycle.test.js
git commit -m "feat: 마니또 순환 계산 순수 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 마이그레이션과 마니또 서비스

**Files:**
- Create: `db/migrations/004_manito.sql`
- Create: `src/services/manito.js`
- Modify: `tests/helpers.js` (헬퍼 2개 추가, `module.exports`에 추가)
- Test: `tests/manito.service.test.js`

**Interfaces:**
- Consumes: Task 1의 `buildCycle`, `removeFromCycle`, `insertIntoCycle`, `cycleOrder`; `lockEvent(client, eventId)` from `src/services/event-lock.js`(운동회 행을 `FOR UPDATE`로 읽어 돌려줌, 없거나 id 형식이 틀리면 `ValidationError`); `maskName(name)` from `src/services/mask.js`; `db.tx(fn)`, `db.query`
- Produces (`src/services/manito.js`):
  - `CONFIRM = '다시 배정'`, `MIN_ASSIGN = 3`
  - `assign(eventId, random = Math.random) → Promise<true>` — `none`에서만. 출석 3명 미만이면 `ValidationError`
  - `reassign(eventId, confirm, random = Math.random) → Promise<true>` — `assigned`에서만
  - `open(eventId) → Promise<true>` — `assigned`에서만
  - `setLocked(eventId, locked: boolean) → Promise<true>`
  - `mine(eventId, participantId) → Promise<{ stage, inCycle, acknowledged, receiverName } | null>` — `receiverName`은 확인한 뒤에만 이름, 그 전엔 `null`. id 형식이 틀리면 `null`
  - `acknowledge(eventId, participantId) → Promise<boolean>` — 첫 확인 시각만 기록. 순환에 없으면 `false`
  - `map(eventId) → Promise<string[] | null>` — `opened && !locked`일 때만 고리 순서의 이름 배열(빈 순환이면 `[]`), 아니면 `null`
  - `summary(eventId) → Promise<{ stage, locked, size, acknowledgedCount, presentCount } | null>` — 이름 없음
  - `adminView(eventId) → Promise<{ stage, locked, size, acknowledgedCount, presentCount, cycle: string[] } | null>` — `cycle`은 마스킹한 이름, 고리 순서
  - `syncPresence(client, eventId, participantId, { leaving = false, random = Math.random } = {}) → Promise<void>` — 호출자가 같은 트랜잭션에서 이미 `lockEvent`를 했어야 한다. `leaving: true`는 곧 삭제될 참가자
- Produces (`tests/helpers.js`): `manitoLinks(eventId) → [{ giver, receiver, acknowledged_at }]`(giver 순), `assertManitoCycle(eventId) → links` — 출석자가 2명 이상이면 출석자 전원의 하나의 고리, 아니면 빈 순환임을 검사

- [ ] **Step 1: Add the migration and test helpers**

`db/migrations/004_manito.sql`:

```sql
-- 참가 마감: 켜져 있으면 처음 보는 이름으로는 입장할 수 없다
ALTER TABLE events ADD COLUMN join_closed boolean NOT NULL DEFAULT false;

-- 순환을 이어 붙이는 도중의 일시적 중복을 허용하고 트랜잭션 끝에 검사한다
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_giver_id_key;
ALTER TABLE manito_links DROP CONSTRAINT manito_links_event_id_receiver_id_key;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_giver_unique
  UNIQUE (event_id, giver_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE manito_links ADD CONSTRAINT manito_links_receiver_unique
  UNIQUE (event_id, receiver_id) DEFERRABLE INITIALLY DEFERRED;
```

`tests/helpers.js` — `addParticipant` 아래에 추가하고 `module.exports`에 `manitoLinks, assertManitoCycle`를 더한다:

```js
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
```

- [ ] **Step 2: Write the failing test**

`tests/manito.service.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const { lockEvent } = require('../src/services/event-lock');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

// 생성자 + count명, 모두 출석
async function setup(count = 4) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  return { event, creator, people };
}

const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const ackedGivers = async (eventId) => (await H.manitoLinks(eventId)).filter((l) => l.acknowledged_at).map((l) => l.giver);
const unackedGivers = async (eventId) => (await H.manitoLinks(eventId)).filter((l) => !l.acknowledged_at).map((l) => l.giver).sort();

async function sync(eventId, participantId, options) {
  await H.db.tx(async (client) => {
    await lockEvent(client, eventId);
    await manito.syncPresence(client, eventId, participantId, options);
  });
}
const setAbsent = (id) => H.db.query("UPDATE participants SET attendance = 'absent' WHERE id = $1", [id]);
const setPresent = (id) => H.db.query("UPDATE participants SET attendance = 'present' WHERE id = $1", [id]);

test('마이그레이션: 참가 마감 컬럼과 트랜잭션 끝에 검사하는 유일 제약', async () => {
  const { rows } = await H.db.query(
    `SELECT conname, condeferrable, condeferred FROM pg_constraint
     WHERE conrelid = 'manito_links'::regclass AND contype = 'u' ORDER BY conname`,
  );
  assert.deepEqual(rows.map((r) => [r.conname, r.condeferrable, r.condeferred]), [
    ['manito_links_giver_unique', true, true],
    ['manito_links_receiver_unique', true, true],
  ]);
  const { event } = await H.makeEvent();
  assert.equal(event.join_closed, false);
});

test('배정: 출석 3명 미만이면 거부하고 아무것도 바꾸지 않는다', async () => {
  const { event } = await setup(1);
  await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await assert.rejects(manito.assign(event.id), /출석한 참가자가 3명 이상이어야/);
  assert.equal((await eventRow(event.id)).manito_stage, 'none');
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('배정: 출석자 전원이 하나의 고리가 되고 결석자는 빠지며, 두 번은 안 된다', async () => {
  const { event, people } = await setup(5);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  assert.equal(await manito.assign(event.id, mulberry32(1)), true);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  const links = await H.assertManitoCycle(event.id);
  assert.equal(links.length, people.length);
  assert.ok(!links.some((l) => l.giver === String(absent.id) || l.receiver === String(absent.id)));
  await assert.rejects(manito.assign(event.id), /이미 마니또가 배정되었습니다/);
});

test('개인 조회와 확인: 확인 전에는 이름이 없고, 첫 확인 시각만 기록된다', async () => {
  const { event, people } = await setup(3);
  assert.deepEqual(await manito.mine(event.id, people[0].id),
    { stage: 'none', inCycle: false, acknowledged: false, receiverName: null });
  await manito.assign(event.id, mulberry32(2));
  const me = people[1];
  const link = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id));
  const receiver = people.find((p) => String(p.id) === link.receiver);
  assert.deepEqual(await manito.mine(event.id, me.id),
    { stage: 'assigned', inCycle: true, acknowledged: false, receiverName: null });
  assert.equal(await manito.acknowledge(event.id, me.id), true);
  const first = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id)).acknowledged_at;
  assert.ok(first);
  await manito.acknowledge(event.id, me.id);
  const second = (await H.manitoLinks(event.id)).find((l) => l.giver === String(me.id)).acknowledged_at;
  assert.equal(second.getTime(), first.getTime());
  assert.deepEqual(await manito.mine(event.id, me.id),
    { stage: 'assigned', inCycle: true, acknowledged: true, receiverName: receiver.name });
  assert.deepEqual(await ackedGivers(event.id), [String(me.id)]);
  assert.equal(await manito.mine(event.id, 'abc'), null);
  assert.equal(await manito.acknowledge(event.id, 'abc'), false);
});

test('개인 확인: 순환에 없는 사람은 false', async () => {
  const { event } = await setup(3);
  const absent = await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  await manito.assign(event.id, mulberry32(3));
  assert.equal(await manito.acknowledge(event.id, absent.id), false);
  assert.deepEqual(await manito.mine(event.id, absent.id),
    { stage: 'assigned', inCycle: false, acknowledged: false, receiverName: null });
});

test('다시 배정: 배정 전·확인 문구 불일치·공개 후 거부, 성공하면 확인 기록이 모두 지워진다', async () => {
  const { event, people } = await setup(4);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /마니또를 먼저 배정해 주세요/);
  await manito.assign(event.id, mulberry32(4));
  await manito.acknowledge(event.id, people[0].id);
  await assert.rejects(manito.reassign(event.id, '다시'), /확인 문구/);
  assert.equal(await manito.reassign(event.id, '  다시 배정 ', mulberry32(5)), true);
  await H.assertManitoCycle(event.id);
  assert.deepEqual(await ackedGivers(event.id), []);
  await manito.open(event.id);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /공개한 뒤에는 다시 배정할 수 없습니다/);
});

test('다시 배정: 그사이 출석이 3명 미만이 되면 거부', async () => {
  const { event, people } = await setup(2);
  await manito.assign(event.id, mulberry32(6));
  await setAbsent(people[2].id);
  await assert.rejects(manito.reassign(event.id, '다시 배정'), /출석한 참가자가 3명 이상이어야/);
});

test('공개: 배정 전 거부, 두 번째 거부', async () => {
  const { event } = await setup(3);
  await assert.rejects(manito.open(event.id), /마니또를 먼저 배정해 주세요/);
  await manito.assign(event.id, mulberry32(7));
  assert.equal(await manito.open(event.id), true);
  assert.equal((await eventRow(event.id)).manito_stage, 'opened');
  await assert.rejects(manito.open(event.id), /이미 공개되었습니다/);
});

test('맵: 공개 전·잠금 중에는 null, 공개 후 고리 순서의 이름, 개인 확인은 잠금과 무관', async () => {
  const { event, people } = await setup(3);
  assert.equal(await manito.map(event.id), null);
  await manito.assign(event.id, mulberry32(8));
  assert.equal(await manito.map(event.id), null);
  await manito.open(event.id);
  const cycle = await manito.map(event.id);
  assert.deepEqual([...cycle].sort(), people.map((p) => p.name).sort());
  const { rows } = await H.db.query(
    `SELECT g.name AS giver, r.name AS receiver FROM manito_links l
     JOIN participants g ON g.id = l.giver_id JOIN participants r ON r.id = l.receiver_id
     WHERE l.event_id = $1`,
    [event.id],
  );
  const next = new Map(rows.map((r) => [r.giver, r.receiver]));
  cycle.forEach((name, i) => assert.equal(next.get(name), cycle[(i + 1) % cycle.length]));
  assert.equal(await manito.setLocked(event.id, true), true);
  assert.equal(await manito.map(event.id), null);
  assert.equal((await manito.mine(event.id, people[0].id)).inCycle, true);
  assert.equal(await manito.acknowledge(event.id, people[0].id), true);
  await manito.setLocked(event.id, false);
  assert.ok(Array.isArray(await manito.map(event.id)));
  assert.equal(await manito.map('abc'), null);
});

test('생성자 요약은 집계만, 관리자 조회는 서비스에서 마스킹한 이름만', async () => {
  const { event } = await H.makeEvent({ creatorName: '홍길동' });
  await H.addParticipant(event.id, '남궁민원');
  await H.addParticipant(event.id, '이순신');
  await H.addParticipant(event.id, '결석자', { attendance: 'absent' });
  assert.deepEqual(await manito.summary(event.id),
    { stage: 'none', locked: false, size: 0, acknowledgedCount: 0, presentCount: 3 });
  await manito.assign(event.id, mulberry32(9));
  const [first] = await H.manitoLinks(event.id);
  await manito.acknowledge(event.id, first.giver);
  const summary = await manito.summary(event.id);
  assert.deepEqual(summary, { stage: 'assigned', locked: false, size: 3, acknowledgedCount: 1, presentCount: 3 });
  const admin = await manito.adminView(event.id);
  assert.deepEqual({ ...admin, cycle: undefined },
    { stage: 'assigned', locked: false, size: 3, acknowledgedCount: 1, presentCount: 3, cycle: undefined });
  assert.deepEqual([...admin.cycle].sort(), ['남**원', '이*신', '홍*동'].sort());
  const text = JSON.stringify([summary, admin]);
  for (const name of ['홍길동', '남궁민원', '이순신']) assert.ok(!text.includes(name), `${name}이 노출됨`);
  assert.equal(await manito.summary('abc'), null);
  assert.equal(await manito.adminView('abc'), null);
});

test('자동 반영: 배정 전에는 아무것도 하지 않는다', async () => {
  const { event, people } = await setup(3);
  await setAbsent(people[1].id);
  await sync(event.id, people[1].id);
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('자동 반영: 빠짐은 앞사람만 다음 사람으로 잇고 그 사람의 확인을 비운다', async () => {
  const { event, people } = await setup(4);
  await manito.assign(event.id, mulberry32(10));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  const x = people[2];
  const before = await H.manitoLinks(event.id);
  const a = before.find((l) => l.receiver === String(x.id)).giver;
  const b = before.find((l) => l.giver === String(x.id)).receiver;
  await setAbsent(x.id);
  await sync(event.id, x.id);
  const after = await H.assertManitoCycle(event.id);
  assert.equal(after.find((l) => l.giver === a).receiver, b);
  assert.deepEqual(await unackedGivers(event.id), [a]);
});

test('자동 반영: 합류는 한 연결 사이에 끼우고, 앞사람과 새 사람만 확인 전', async () => {
  const { event, people } = await setup(3);
  await manito.assign(event.id, mulberry32(11));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  const newcomer = await H.addParticipant(event.id, '새사람');
  await sync(event.id, newcomer.id);
  const after = await H.assertManitoCycle(event.id);
  const a = after.find((l) => l.receiver === String(newcomer.id)).giver;
  assert.deepEqual(await unackedGivers(event.id), [a, String(newcomer.id)].sort());
});

test('자동 반영: 3→2명은 서로, 2→1명은 빈 순환, 다시 2명이 되면 새 고리', async () => {
  const { event, people } = await setup(2);
  await manito.assign(event.id, mulberry32(12));
  await setAbsent(people[2].id);
  await sync(event.id, people[2].id);
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
  await setAbsent(people[1].id);
  await sync(event.id, people[1].id);
  assert.deepEqual(await H.assertManitoCycle(event.id), []);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  assert.deepEqual(await manito.mine(event.id, people[0].id),
    { stage: 'assigned', inCycle: false, acknowledged: false, receiverName: null });
  await setPresent(people[1].id);
  await sync(event.id, people[1].id);
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
});

test('자동 반영: 곧 삭제될 참가자는 leaving으로 먼저 이어 붙인다', async () => {
  const { event, people } = await setup(4);
  await manito.assign(event.id, mulberry32(13));
  const x = people[3];
  await H.db.tx(async (client) => {
    await lockEvent(client, event.id);
    await manito.syncPresence(client, event.id, x.id, { leaving: true });
    await client.query('DELETE FROM participants WHERE id = $1', [x.id]);
  });
  assert.equal((await H.assertManitoCycle(event.id)).length, 4);
});

test('자동 반영: 이미 맞는 상태면 연결을 건드리지 않는다', async () => {
  const { event, people } = await setup(3);
  await manito.assign(event.id, mulberry32(14));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  await sync(event.id, people[1].id);
  await sync(event.id, '999999');
  assert.deepEqual(await unackedGivers(event.id), []);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NODE_ENV=test node db/migrate.js && NODE_ENV=test node --test --test-concurrency=1 tests/manito.service.test.js`
(단일 파일 실행에는 `pretest`가 돌지 않으므로 마이그레이션을 먼저 적용한다)
Expected: FAIL with `Cannot find module '../src/services/manito'` (the migration itself must apply cleanly: `적용: 004_manito.sql`)

- [ ] **Step 4: Write minimal implementation**

`src/services/manito.js`:

```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/manito.service.test.js tests/manito-cycle.test.js tests/migrate.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (existing 206 tests + new ones)

- [ ] **Step 7: Commit**

```bash
git add db/migrations/004_manito.sql src/services/manito.js tests/helpers.js tests/manito.service.test.js
git commit -m "feat: 마니또 배정·공개·잠금·자동 반영 서비스와 마이그레이션

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 참가자 변동 자동 반영과 참가 마감

**Files:**
- Modify: `src/services/participants.js` (`join`, `setAttendance`, `deleteParticipant`, `createParticipant`)
- Modify: `src/services/events.js` (`setJoinClosed` 추가)
- Test: `tests/manito-sync.test.js`

**Interfaces:**
- Consumes: Task 2의 `syncPresence(client, eventId, participantId, { leaving })`, `assign`, `acknowledge`; `H.assertManitoCycle`, `H.manitoLinks`; `lockEvent`
- Produces:
  - `participants.JOIN_CLOSED = '참가가 마감되었습니다'` (export)
  - `participants.join(event, input)` — 처음 보는 이름은 트랜잭션에서 운동회 행을 잠그고 다시 읽은 `status`/`join_closed`로 검사한 뒤 생성하고 `syncPresence`. 이미 있는 이름의 재입장은 그대로
  - `setAttendance`, `createParticipant`는 같은 트랜잭션에서 `syncPresence`; `deleteParticipant`는 DELETE 전에 `syncPresence(..., { leaving: true })`
  - `events.setJoinClosed(id, closed: boolean) → Promise<boolean>` — id 형식이 틀리면 `false`, 운동회가 없으면 `ValidationError`(`lockEvent`)

- [ ] **Step 1: Write the failing test**

`tests/manito-sync.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');
const events = require('../src/services/events');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

async function setup(count = 5) {
  const { event, participant: creator } = await H.makeEvent();
  const people = [creator];
  for (let i = 1; i <= count; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  await manito.assign(event.id, mulberry32(1));
  for (const p of people) await manito.acknowledge(event.id, p.id);
  return { event, creator, people };
}

const unackedGivers = async (eventId) => (await H.manitoLinks(eventId))
  .filter((l) => !l.acknowledged_at).map((l) => l.giver).sort();
const giverTo = async (eventId, id) => (await H.manitoLinks(eventId)).find((l) => l.receiver === String(id)).giver;

test('결석·출석 복귀: 한 고리를 유지하고 바뀐 사람만 확인 전', async () => {
  const { event, people } = await setup();
  const x = people[3];
  const a = await giverTo(event.id, x.id);
  await participants.setAttendance(event.id, x.id, 'absent');
  await H.assertManitoCycle(event.id);
  assert.deepEqual(await unackedGivers(event.id), [a]);
  await participants.setAttendance(event.id, x.id, 'present');
  const links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(x.id)));
  const before = await giverTo(event.id, x.id);
  assert.ok((await unackedGivers(event.id)).includes(before));
  assert.ok((await unackedGivers(event.id)).includes(String(x.id)));
});

test('삭제: 순환에 있던 사람을 지워도 앞사람이 다음 사람으로 이어진다', async () => {
  const { event, people } = await setup();
  const x = people[4];
  const a = await giverTo(event.id, x.id);
  const b = (await H.manitoLinks(event.id)).find((l) => l.giver === String(x.id)).receiver;
  assert.equal(await participants.deleteParticipant(event.id, x.id), true);
  const links = await H.assertManitoCycle(event.id);
  assert.equal(links.find((l) => l.giver === a).receiver, b);
  assert.deepEqual(await unackedGivers(event.id), [a]);
  assert.equal(await participants.deleteParticipant(event.id, '999999'), false);
});

test('생성자 직접 추가와 새 이름 입장은 순환에 끼어든다', async () => {
  const { event } = await setup();
  const added = await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  let links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(added.id)));
  const joined = await participants.join(event, { name: '새입장', pin: '1234', authCode: event.auth_code });
  links = await H.assertManitoCycle(event.id);
  assert.ok(links.some((l) => l.giver === String(joined.id)));
});

test('배정 전 변동은 순환을 만들지 않는다', async () => {
  const { event } = await H.makeEvent();
  const p = await H.addParticipant(event.id, '참가자1');
  await participants.setAttendance(event.id, p.id, 'absent');
  await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  assert.deepEqual(await H.manitoLinks(event.id), []);
});

test('2명까지 줄었다가 다시 늘어나도 불변식 유지', async () => {
  const { event, people } = await setup(3);
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  assert.deepEqual(await H.assertManitoCycle(event.id), []);
  await participants.setAttendance(event.id, people[1].id, 'present');
  assert.equal((await H.assertManitoCycle(event.id)).length, 2);
  await participants.setAttendance(event.id, people[2].id, 'present');
  assert.equal((await H.assertManitoCycle(event.id)).length, 3);
});

test('동시 출석 변경·추가·삭제 후에도 한 고리', async () => {
  const { event, people } = await setup(8);
  await Promise.all([
    participants.setAttendance(event.id, people[1].id, 'absent'),
    participants.setAttendance(event.id, people[2].id, 'absent'),
    participants.setAttendance(event.id, people[3].id, 'absent'),
    participants.deleteParticipant(event.id, people[4].id),
    participants.createParticipant(event.id, { name: '동시1', pin: '1234' }),
    participants.createParticipant(event.id, { name: '동시2', pin: '1234' }),
    participants.setAttendance(event.id, people[1].id, 'present'),
  ]);
  await H.assertManitoCycle(event.id);
});

test('참가 마감: 새 이름 거부(마감 전에 읽은 행으로 와도), 재입장·직접 추가는 허용', async () => {
  const { event, creator } = await setup(3);
  assert.equal(await events.setJoinClosed(event.id, true), true);
  const fresh = await events.getEventById(event.id);
  assert.equal(fresh.join_closed, true);
  await assert.rejects(
    participants.join(fresh, { name: '늦은사람', pin: '1234', authCode: fresh.auth_code }),
    /참가가 마감되었습니다/,
  );
  // event는 마감 전에 읽은 행(join_closed=false)이다
  await assert.rejects(
    participants.join(event, { name: '늦은사람', pin: '1234', authCode: event.auth_code }),
    /참가가 마감되었습니다/,
  );
  const again = await participants.join(fresh, { name: '생성자', pin: '1111', authCode: fresh.auth_code });
  assert.equal(String(again.id), String(creator.id));
  await participants.createParticipant(event.id, { name: '직접추가', pin: '1234' });
  await H.assertManitoCycle(event.id);
  await events.setJoinClosed(event.id, false);
  await participants.join(await events.getEventById(event.id), { name: '늦은사람', pin: '1234', authCode: event.auth_code });
  assert.equal(await events.setJoinClosed('abc', true), false);
});

test('참가 마감: 이미 있는 이름에 틀린 PIN은 기존 문구, 같은 이름 동시 입장은 하나만', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(
    participants.join(event, { name: '생성자', pin: '9999', authCode: event.auth_code }),
    /이미 사용 중인 이름이거나 PIN이 틀렸습니다/,
  );
  const results = await Promise.allSettled([
    participants.join(event, { name: '동명', pin: '1234', authCode: event.auth_code }),
    participants.join(event, { name: '동명', pin: '1234', authCode: event.auth_code }),
  ]);
  const { rows } = await H.db.query("SELECT count(*)::int AS n FROM participants WHERE event_id = $1 AND name = '동명'", [event.id]);
  assert.equal(rows[0].n, 1);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
});

test('입장 라우트: 마감 중 새 이름은 400과 안내', async () => {
  const { event } = await H.makeEvent();
  await events.setJoinClosed(event.id, true);
  const res = await H.request(H.getApp()).post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(400);
  assert.match(res.text, /참가가 마감되었습니다/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/manito-sync.test.js`
Expected: FAIL (`events.setJoinClosed is not a function`, cycles not maintained)

- [ ] **Step 3: Implement in `src/services/participants.js`**

Add the require at the top (below the `lockEvent` require):

```js
const { syncPresence } = require('./manito');
```

Add the constants below `ATTENDANCE`:

```js
const JOIN_CLOSED = '참가가 마감되었습니다';
const CLOSED = '종료된 운동회에는 새로 입장할 수 없습니다';
```

Replace `join` with:

```js
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
  if (event.status === 'closed') throw new ValidationError(CLOSED);
  if (event.join_closed) throw new ValidationError(JOIN_CLOSED);

  const pinHash = await hashPin(pin);
  try {
    return await db.tx(async (client) => {
      // 화면을 연 뒤에 마감·종료되었을 수 있으므로 잠근 행으로 다시 확인한다
      const fresh = await lockEvent(client, event.id);
      if (fresh.status === 'closed') throw new ValidationError(CLOSED);
      if (fresh.join_closed) throw new ValidationError(JOIN_CLOSED);
      const { rows } = await client.query(
        'INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, $2, $3) RETURNING *',
        [event.id, name, pinHash],
      );
      await syncPresence(client, event.id, rows[0].id);
      return rows[0];
    });
  } catch (err) {
    if (err.code === '23505' && err.table === 'participants') throw new ValidationError(MISMATCH);
    throw err;
  }
}
```

Replace `setAttendance` and `deleteParticipant` with:

```js
async function setAttendance(eventId, id, attendance) {
  const value = String(attendance ?? '');
  if (!ATTENDANCE.includes(value)) throw new ValidationError('출석 상태 값이 올바르지 않습니다');
  if (!isId(id)) return null;
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    const { rows } = await client.query(
      'UPDATE participants SET attendance = $3 WHERE event_id = $1 AND id = $2 RETURNING *',
      [eventId, id, value],
    );
    if (rows[0]) await syncPresence(client, eventId, rows[0].id);
    return rows[0] || null;
  });
}

async function deleteParticipant(eventId, id) {
  if (!isId(id)) return false;
  return db.tx(async (client) => {
    await lockEvent(client, eventId);
    // 연결이 CASCADE로 지워지기 전에 앞사람을 다음 사람에게 이어 둔다
    await syncPresence(client, eventId, id, { leaving: true });
    const { rowCount } = await client.query('DELETE FROM participants WHERE event_id = $1 AND id = $2', [eventId, id]);
    return rowCount > 0;
  });
}
```

In `createParticipant`, inside the transaction after the INSERT, call sync before returning, and narrow the duplicate check:

```js
    return await db.tx(async (client) => {
      await lockEvent(client, eventId);
      const { rows } = await client.query(
        'INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, $2, $3) RETURNING *',
        [eventId, name, pinHash],
      );
      await syncPresence(client, eventId, rows[0].id);
      return rows[0];
    });
  } catch (err) {
    if (err.code === '23505' && err.table === 'participants') throw duplicateName(name);
    throw err;
  }
```

(`err.table`을 확인하는 이유: `manito_links` 유일 제약은 커밋 시점에 검사되므로 같은 23505 코드가 나올 수 있다. 그 경우를 이름 중복으로 잘못 안내하지 않는다.)

Add `JOIN_CLOSED` to `module.exports`.

- [ ] **Step 4: Implement `setJoinClosed` in `src/services/events.js`**

Add the require at the top:

```js
const { lockEvent } = require('./event-lock');
```

Add before `module.exports` and export it:

```js
// 참가 마감. 켜져 있으면 처음 보는 이름으로는 입장할 수 없다
async function setJoinClosed(id, closed) {
  if (!isId(id)) return false;
  return db.tx(async (client) => {
    await lockEvent(client, id);
    await client.query('UPDATE events SET join_closed = $2 WHERE id = $1', [id, Boolean(closed)]);
    return true;
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/manito-sync.test.js tests/participants.service.test.js tests/public.routes.test.js tests/participant.routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/participants.js src/services/events.js tests/manito-sync.test.js
git commit -m "feat: 출석·삭제·추가·입장 때 마니또 자동 반영, 참가 마감

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 참가자 화면(홈 카드, 봉투, 맵)

**Files:**
- Modify: `src/routes/participant.js`
- Modify: `src/views/participant/home.ejs`
- Create: `src/views/participant/manito.ejs`
- Create: `src/views/participant/manito-map.ejs`
- Modify: `src/public/css/app.css`
- Test: `tests/participant-manito.routes.test.js`

**Interfaces:**
- Consumes: `manito.mine(eventId, participantId)`, `manito.acknowledge(eventId, participantId)`, `manito.map(eventId)` (Task 2); `participants.setAttendance` (Task 3); `requireParticipant`(sets `req.participant`, `req.event` is loaded per request by `loadEvent`)
- Produces: `GET /e/:slug/manito`, `POST /e/:slug/manito/open` (303 → `/e/:slug/manito?opened=1`), `GET /e/:slug/manito/map`. 홈 렌더에 `manito`(mine 결과)와 `mapVisible` 전달

- [ ] **Step 1: Write the failing test**

`tests/participant-manito.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

const NAMES = ['가람', '나래', '다솜', '라온'];
// 생성자 이름은 화면 문구("생성자에게 알려 주세요" 등)와 겹치지 않게 따로 정한다
const ALL = [...NAMES, '마루'];

async function setup() {
  const { event } = await H.makeEvent({ creatorName: '마루' });
  const agents = {};
  for (const name of NAMES) agents[name] = await H.joinAgent(event, { name, pin: '1234' });
  return { event, agents, base: `/e/${event.slug}` };
}

async function receiverOf(eventId, name) {
  const { rows } = await H.db.query(
    `SELECT r.name FROM manito_links l
     JOIN participants g ON g.id = l.giver_id JOIN participants r ON r.id = l.receiver_id
     WHERE l.event_id = $1 AND g.name = $2`,
    [eventId, name],
  );
  return rows[0]?.name ?? null;
}

// 허용한 이름 말고 다른 참가자 이름이 HTML에 있으면 돌려준다
const leaked = (html, allowed) => ALL.filter((n) => !allowed.includes(n) && html.includes(n));

test('홈 카드: 준비 중 → 봉투 도착 → 내 마니또 보기, 결석자는 마니또 없음', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /마니또 준비 중/);
  await manito.assign(event.id, mulberry32(1));
  res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /봉투가 도착했어요/);
  assert.match(res.text, new RegExp(`href="${base}/manito"`));
  assert.deepEqual(leaked(res.text, ['가람']), []);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  res = await agents['가람'].get(`${base}/home`).expect(200);
  assert.match(res.text, /내 마니또 보기/);
  assert.deepEqual(leaked(res.text, ['가람']), [], '홈에는 마니또 이름이 나오지 않는다');
  assert.doesNotMatch(res.text, /마니또 맵 보기/);
  const nare = (await H.db.query("SELECT id FROM participants WHERE event_id = $1 AND name = '나래'", [event.id])).rows[0];
  await participants.setAttendance(event.id, nare.id, 'absent');
  res = await agents['나래'].get(`${base}/home`).expect(200);
  assert.match(res.text, /지금은 마니또가 없어요/);
});

test('봉투: 열기 전에는 이름이 없고, 열면 내 마니또만 보인다', async () => {
  const { event, agents, base } = await setup();
  await manito.assign(event.id, mulberry32(2));
  let res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, new RegExp(`action="${base}/manito/open"`));
  assert.deepEqual(leaked(res.text, ['가람']), []);
  res = await agents['가람'].post(`${base}/manito/open`).expect(303);
  assert.equal(res.headers.location, `${base}/manito?opened=1`);
  const receiver = await receiverOf(event.id, '가람');
  res = await agents['가람'].get(`${base}/manito?opened=1`).expect(200);
  assert.match(res.text, /<details class="envelope" open>/);
  assert.ok(res.text.includes(receiver));
  assert.deepEqual(leaked(res.text, ['가람', receiver]), []);
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /<details class="envelope">/);
  res = await agents['나래'].get(`${base}/manito`).expect(200);
  assert.deepEqual(leaked(res.text, ['나래']), [], '다른 사람이 연 봉투는 내 화면에 영향이 없다');
});

test('봉투: 배정 전과 순환 밖에서는 안내만', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /아직 마니또가 배정되지 않았어요/);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  await manito.assign(event.id, mulberry32(3));
  const gr = (await H.db.query("SELECT id FROM participants WHERE event_id = $1 AND name = '가람'", [event.id])).rows[0];
  await participants.setAttendance(event.id, gr.id, 'absent');
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.match(res.text, /지금은 마니또가 없어요/);
});

test('맵: 공개 전 안내, 공개 후 전체 고리, 잠그면 숨기고 개인 확인은 유지', async () => {
  const { event, agents, base } = await setup();
  let res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  await manito.assign(event.id, mulberry32(4));
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  assert.deepEqual(leaked(res.text, ['가람']), []);
  await manito.open(event.id);
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  for (const name of ALL) {
    const to = await receiverOf(event.id, name);
    assert.ok(res.text.includes(`<span class="manito-from">${name}</span><span class="manito-to">→ ${to}</span>`), `${name} → ${to}`);
  }
  assert.match((await agents['가람'].get(`${base}/home`)).text, /마니또 맵 보기/);
  await manito.setLocked(event.id, true);
  res = await agents['가람'].get(`${base}/manito/map`).expect(200);
  assert.match(res.text, /아직 공개되지 않았어요/);
  assert.deepEqual(leaked(res.text, ['가람']), []);
  assert.doesNotMatch((await agents['가람'].get(`${base}/home`)).text, /마니또 맵 보기/);
  await agents['가람'].post(`${base}/manito/open`).expect(303);
  res = await agents['가람'].get(`${base}/manito`).expect(200);
  assert.ok(res.text.includes(await receiverOf(event.id, '가람')), '잠겨도 개인 확인은 된다');
});

test('맵: 이름의 HTML은 이스케이프된다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.joinAgent(event, { name: '<b>굵게</b>', pin: '1234' });
  await H.addParticipant(event.id, '참가자1');
  await manito.assign(event.id, mulberry32(5));
  await manito.open(event.id);
  const res = await agent.get(`/e/${event.slug}/manito/map`).expect(200);
  assert.ok(res.text.includes('&lt;b&gt;굵게&lt;/b&gt;'));
  assert.ok(!res.text.includes('<b>굵게'));
});

test('입장하지 않은 사람은 마니또 화면에 들어올 수 없다', async () => {
  const { event } = await H.makeEvent();
  const app = H.request(H.getApp());
  for (const path of ['/manito', '/manito/map']) {
    const res = await app.get(`/e/${event.slug}${path}`).expect(302);
    assert.equal(res.headers.location, `/e/${event.slug}`);
  }
  await app.post(`/e/${event.slug}/manito/open`).expect(302);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/participant-manito.routes.test.js`
Expected: FAIL (404 on `/manito`, home lacks the card)

- [ ] **Step 3: Add the routes in `src/routes/participant.js`**

Add the require below `const teams = require('../services/teams');`:

```js
const manito = require('../services/manito');
```

Replace the `/home` handler with:

```js
router.get('/home', requireParticipant, async (req, res) => {
  const [announcementList, scheduleList, mine, hasEnvelope, myManito] = await Promise.all([
    announcements.list(req.event.id),
    schedules.list(req.event.id),
    draw.myResult(req.event.id, req.participant.id),
    draw.hasEnvelope(req.event.id, req.participant.id),
    manito.mine(req.event.id, req.participant.id),
  ]);
  res.render('participant/home', {
    title: req.event.title,
    announcements: announcementList,
    schedules: scheduleList,
    mine,
    hasEnvelope,
    manito: myManito,
    mapVisible: req.event.manito_stage === 'opened' && !req.event.manito_locked,
  });
});
```

Add after the `/teams` route (before `/logout`):

```js
router.get('/manito', requireParticipant, async (req, res) => {
  const myManito = await manito.mine(req.event.id, req.participant.id);
  res.render('participant/manito', { title: '내 마니또', manito: myManito, justOpened: req.query.opened === '1' });
});

router.post('/manito/open', requireParticipant, async (req, res) => {
  const opened = await manito.acknowledge(req.event.id, req.participant.id);
  res.redirect(303, `${res.locals.base}/manito${opened ? '?opened=1' : ''}`);
});

router.get('/manito/map', requireParticipant, async (req, res) => {
  res.render('participant/manito-map', { title: '마니또 맵', cycle: await manito.map(req.event.id) });
});
```

Note: `POST /manito/open` returns 303 to `${base}/manito` (without `?opened=1`) when the participant is not in the cycle; the test for the "배정 전" case only checks the status.

- [ ] **Step 4: Add the home card**

In `src/views/participant/home.ejs`, insert directly after the `팀 뽑기` `</section>` (before the `공지` section):

```ejs
<section class="card stack">
  <h2>💌 내 마니또</h2>
  <% if (!manito || manito.stage === 'none') { %>
  <p class="muted">마니또 준비 중이에요.</p>
  <% } else if (!manito.inCycle) { %>
  <p class="muted">지금은 마니또가 없어요.</p>
  <% } else if (!manito.acknowledged) { %>
  <p><strong>봉투가 도착했어요</strong></p>
  <a class="btn btn-primary btn-block" href="<%= base %>/manito">열어 보기</a>
  <% } else { %>
  <a class="btn btn-block" href="<%= base %>/manito">내 마니또 보기</a>
  <% } %>
  <% if (mapVisible) { %><a class="btn btn-block" href="<%= base %>/manito/map">마니또 맵 보기</a><% } %>
</section>
```

- [ ] **Step 5: Create the envelope and map views**

`src/views/participant/manito.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title">💌 내 마니또</h1>
<section class="card stack center">
  <% if (!manito || manito.stage === 'none') { %>
  <p class="muted">아직 마니또가 배정되지 않았어요.</p>
  <% } else if (!manito.inCycle) { %>
  <p class="muted">지금은 마니또가 없어요. 출석으로 바뀌면 자동으로 들어가요.</p>
  <% } else if (!manito.acknowledged) { %>
  <p class="envelope-icon" aria-hidden="true">✉️</p>
  <p><strong>봉투가 도착했어요</strong></p>
  <form method="post" action="<%= base %>/manito/open">
    <button class="btn btn-primary btn-block">봉투 열기</button>
  </form>
  <p class="hint">주변에 화면을 보는 사람이 없는지 확인하세요.</p>
  <% } else { %>
  <details class="envelope"<%- justOpened ? ' open' : '' %>>
    <summary>봉투를 눌러 펼치기·접기</summary>
    <p class="hint">내가 몰래 챙겨 줄 사람</p>
    <p class="manito-name"><%= manito.receiverName %></p>
  </details>
  <% } %>
</section>
<p><a class="btn btn-small" href="<%= base %>/home">홈으로</a></p>
```

`src/views/participant/manito-map.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title">마니또 맵</h1>
<% if (!cycle) { %>
<section class="card"><p class="muted">아직 공개되지 않았어요.</p></section>
<% } else if (cycle.length === 0) { %>
<section class="card"><p class="muted">지금은 이어진 마니또가 없어요.</p></section>
<% } else { %>
<section class="card stack">
  <p class="hint">화살표 앞사람이 뒷사람을 몰래 챙겨 준 마니또예요.<% if (cycle.length <= 16) { %> 넓은 화면에서는 시계 방향으로 이어져요.<% } %></p>
  <ol class="manito-map<%= cycle.length <= 16 ? ' circle' : '' %>" style="--n: <%= cycle.length %>">
    <% cycle.forEach((name, i) => { %>
    <li style="--i: <%= i %>"><span class="manito-from"><%= name %></span><span class="manito-to">→ <%= cycle[(i + 1) % cycle.length] %></span></li>
    <% }) %>
  </ol>
</section>
<% } %>
<p><a class="btn btn-small" href="<%= base %>/home">홈으로</a></p>
```

- [ ] **Step 6: Add the styles**

Append to `src/public/css/app.css`, directly before the `@media (max-width: 520px)` block:

```css
/* 마니또 */
.envelope-icon { margin: 0; font-size: 64px; line-height: 1; }
.envelope { text-align: center; background: #FFF1E6; border: 2px solid var(--ink); border-radius: 16px; box-shadow: 3px 4px 0 var(--ink); }
.envelope summary { min-height: 52px; padding: 14px 16px; font-weight: 700; cursor: pointer; }
.envelope[open] summary { border-bottom: 1px dashed var(--line); }
.envelope .hint { margin: 12px 0 0; }
.manito-name { margin: 4px 0 16px; font: 400 36px/1.2 'Jua', sans-serif; }
.manito-map { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.manito-map li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.manito-from { font-weight: 700; }
.manito-to { color: var(--muted); }
@media (min-width: 768px) {
  .manito-map.circle { position: relative; display: block; width: 420px; max-width: 100%; aspect-ratio: 1; margin: 16px auto 8px; border: 2px dashed var(--line); border-radius: 50%; }
  .manito-map.circle li { position: absolute; left: 50%; top: 50%; width: 96px; margin: -22px 0 0 -48px; justify-content: center; padding: 8px 4px; text-align: center;
    transform: rotate(calc(360deg / var(--n) * var(--i))) translateY(-175px) rotate(calc(-360deg / var(--n) * var(--i))); }
  .manito-map.circle .manito-to { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/participant-manito.routes.test.js tests/participant.routes.test.js tests/participant-draw.routes.test.js`
Expected: PASS

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/routes/participant.js src/views/participant/home.ejs src/views/participant/manito.ejs src/views/participant/manito-map.ejs src/public/css/app.css tests/participant-manito.routes.test.js
git commit -m "feat: 참가자 마니또 카드·봉투·맵 화면

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 생성자 마니또 관리와 대시보드 참가 마감

**Files:**
- Modify: `src/routes/creator.js`
- Modify: `src/services/format.js` (`manitoStageLabel` 추가)
- Create: `src/views/creator/manito.ejs`
- Modify: `src/views/creator/dashboard.ejs`
- Modify: `src/views/partials/creator-nav.ejs`
- Test: `tests/creator-manito.routes.test.js`, `tests/format.test.js`

**Interfaces:**
- Consumes: `manito.summary`, `manito.assign`, `manito.reassign`, `manito.open` (Task 2); `events.setJoinClosed` (Task 3); `res.locals.event` (fresh per request from `loadEvent`)
- Produces: `GET /e/:slug/manage/manito`, `POST /e/:slug/manage/manito/assign|reassign|open`(성공 302 → `/manage/manito`, 검증 실패 400 같은 화면), `POST /e/:slug/manage/join-closed`(`closed=1|0`, 302 → `/manage`); `format.manitoStageLabel(stage)` — `none→준비`, `assigned→배정됨`, `opened→공개됨` (뷰 locals로 자동 노출: `src/middleware/locals.js`가 `format`의 모든 export를 펼친다)

- [ ] **Step 1: Write the failing tests**

Append to `tests/format.test.js` (uses its existing `test`/`assert` requires; add `manitoStageLabel` to its `require('../src/services/format')` destructuring):

```js
test('manitoStageLabel', () => {
  assert.equal(manitoStageLabel('none'), '준비');
  assert.equal(manitoStageLabel('assigned'), '배정됨');
  assert.equal(manitoStageLabel('opened'), '공개됨');
  assert.equal(manitoStageLabel('x'), 'x');
});
```

`tests/creator-manito.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const participants = require('../src/services/participants');

test.beforeEach(H.resetDb);

const NAMES = ['가람', '나래', '다솜', '라온'];

async function setup() {
  const { event } = await H.makeEvent();
  const people = [];
  for (const name of NAMES) people.push(await H.addParticipant(event.id, name));
  const creator = await H.creatorAgent(event);
  return { event, people, creator, manage: `/e/${event.slug}/manage` };
}
const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const leaked = (html) => NAMES.filter((n) => html.includes(n));

test('일반 참가자는 마니또 관리와 참가 마감에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  for (const name of ['가람', '나래']) await H.addParticipant(event.id, name);
  const agent = await H.joinAgent(event, { name: '다솜', pin: '1234' });
  const manage = `/e/${event.slug}/manage`;
  for (const [method, path] of [['get', '/manito'], ['post', '/manito/assign'], ['post', '/manito/open'], ['post', '/join-closed']]) {
    const url = `${manage}${path}`;
    const req = method === 'get' ? agent.get(url) : agent.post(url).type('form').send({ closed: '1' });
    const res = await req.expect(302);
    assert.equal(res.headers.location, `${manage}/unlock`);
  }
  const row = await eventRow(event.id);
  assert.equal(row.manito_stage, 'none');
  assert.equal(row.join_closed, false);
});

test('배정 → 공개: 단계별 버튼, 공개 전후 모두 짝을 렌더링하지 않는다', async () => {
  const { event, creator, manage } = await setup();
  let res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /마니또 배정/);
  assert.match(res.text, new RegExp(`href="${manage}/manito" aria-current="page"`));
  await creator.post(`${manage}/manito/assign`).expect(302);
  assert.equal((await eventRow(event.id)).manito_stage, 'assigned');
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /배정됨/);
  assert.match(res.text, /마니또 공개/);
  assert.match(res.text, /다시 배정/);
  assert.deepEqual(leaked(res.text), [], '공개 전 생성자 화면에 참가자 이름이 나오면 안 된다');
  await creator.post(`${manage}/manito/open`).expect(302);
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /공개됨/);
  assert.match(res.text, new RegExp(`href="/e/${event.slug}/manito/map"`));
  await manito.setLocked(event.id, true);
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /관리자가 맵을 잠갔습니다/);
});

test('배정 거부와 다시 배정 확인 문구는 같은 화면 400', async () => {
  const { event, people, creator, manage } = await setup();
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  let res = await creator.post(`${manage}/manito/assign`).expect(400);
  assert.match(res.text, /출석한 참가자가 3명 이상이어야/);
  for (const p of people) await participants.setAttendance(event.id, p.id, 'present');
  await creator.post(`${manage}/manito/assign`).expect(302);
  await manito.acknowledge(event.id, people[0].id);
  res = await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시' }).expect(400);
  assert.match(res.text, /확인 문구/);
  await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시 배정' }).expect(302);
  const { rows } = await H.db.query('SELECT count(*)::int AS n FROM manito_links WHERE event_id = $1 AND acknowledged_at IS NOT NULL', [event.id]);
  assert.equal(rows[0].n, 0);
  await creator.post(`${manage}/manito/open`).expect(302);
  res = await creator.post(`${manage}/manito/reassign`).type('form').send({ confirm: '다시 배정' }).expect(400);
  assert.match(res.text, /공개한 뒤에는 다시 배정할 수 없습니다/);
});

test('순환 인원 3명 미만 경고와 집계', async () => {
  const { event, people, creator, manage } = await setup();
  await creator.post(`${manage}/manito/assign`).expect(302);
  await manito.acknowledge(event.id, people[0].id);
  let res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /<strong class="tnum">5<\/strong>순환 인원/);
  assert.match(res.text, /<strong class="tnum">1<\/strong>확인함/);
  assert.doesNotMatch(res.text, /순환 인원이 3명보다 적습니다/);
  for (const p of people.slice(1)) await participants.setAttendance(event.id, p.id, 'absent');
  res = await creator.get(`${manage}/manito`).expect(200);
  assert.match(res.text, /순환 인원이 3명보다 적습니다/);
});

test('대시보드 참가 마감: 켜면 새 이름 입장 거부, 직접 추가는 허용, 끄면 다시 입장', async () => {
  const { event, creator, manage } = await setup();
  let res = await creator.get(manage).expect(200);
  assert.match(res.text, /참가 받는 중/);
  res = await creator.post(`${manage}/join-closed`).type('form').send({ closed: '1' }).expect(302);
  assert.equal(res.headers.location, manage);
  assert.equal((await eventRow(event.id)).join_closed, true);
  res = await creator.get(manage).expect(200);
  assert.match(res.text, /참가 마감됨/);
  const app = H.request(H.getApp());
  await app.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(400);
  await creator.post(`${manage}/participants`).type('form').send({ name: '직접추가', pin: '1234' }).expect(302);
  const { rows } = await H.db.query("SELECT 1 FROM participants WHERE event_id = $1 AND name = '직접추가'", [event.id]);
  assert.equal(rows.length, 1);
  await creator.post(`${manage}/join-closed`).type('form').send({ closed: '0' }).expect(302);
  assert.equal((await eventRow(event.id)).join_closed, false);
  await app.post(`/e/${event.slug}/join`).type('form')
    .send({ name: '늦은사람', pin: '1234', authCode: event.auth_code }).expect(302);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-manito.routes.test.js tests/format.test.js`
Expected: FAIL (404 on `/manage/manito`, `manitoStageLabel is not a function`)

- [ ] **Step 3: Add `manitoStageLabel` to `src/services/format.js`**

Below `statusLabel`:

```js
const MANITO_STAGE_LABELS = { none: '준비', assigned: '배정됨', opened: '공개됨' };
const manitoStageLabel = (stage) => MANITO_STAGE_LABELS[stage] || stage;
```

and change the export to `module.exports = { fmtDate, fmtDateTime, statusLabel, manitoStageLabel };`

- [ ] **Step 4: Add the routes in `src/routes/creator.js`**

Add the require below `const draw = require('../services/draw');`:

```js
const manito = require('../services/manito');
```

Add after the dashboard `/created` route:

```js
router.post('/join-closed', async (req, res) => {
  await events.setJoinClosed(req.event.id, req.body.closed === '1');
  res.redirect(manage(res));
});
```

Append before `module.exports = router;`:

```js
async function renderManito(req, res, { error = null, status = 200 } = {}) {
  const summary = await manito.summary(req.event.id);
  res.status(status).render('creator/manito', { title: '마니또', summary, error });
}

// 마니또 화면의 POST는 모두 같은 방식으로 처리한다
async function manitoAction(req, res, action) {
  try {
    await action();
    res.redirect(manage(res, '/manito'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderManito(req, res, { error: err.message, status: 400 });
  }
}

router.get('/manito', (req, res) => renderManito(req, res));
router.post('/manito/assign', (req, res) => manitoAction(req, res, () => manito.assign(req.event.id)));
router.post('/manito/reassign', (req, res) => manitoAction(req, res, () => manito.reassign(req.event.id, req.body.confirm)));
router.post('/manito/open', (req, res) => manitoAction(req, res, () => manito.open(req.event.id)));
```

- [ ] **Step 5: Create `src/views/creator/manito.ejs`**

```ejs
<h1 class="title">마니또</h1>
<%- include('../partials/alert') %>
<section class="stats">
  <div><strong><%= manitoStageLabel(summary.stage) %></strong>상태</div>
  <div><strong class="tnum"><%= summary.size %></strong>순환 인원</div>
  <div><strong class="tnum"><%= summary.acknowledgedCount %></strong>확인함</div>
</section>
<p class="hint">출석 <%= summary.presentCount %>명 · 누가 누구의 마니또인지는 공개 전에는 생성자에게도 보이지 않습니다.</p>
<% if (summary.stage !== 'none' && summary.size < 3) { %>
<p class="alert alert-error">순환 인원이 3명보다 적습니다</p>
<% } %>
<% if (summary.stage === 'none') { %>
<section class="card stack">
  <h2>마니또 배정</h2>
  <p>출석한 참가자 전원을 하나의 순환으로 무작위 배정합니다. 출석이 3명 이상이어야 합니다.</p>
  <form method="post" action="<%= base %>/manage/manito/assign"><button class="btn btn-primary">마니또 배정</button></form>
  <p class="hint">배정 뒤에 결석·추가·삭제가 생기면 순환이 자동으로 고쳐집니다.</p>
</section>
<% } else if (summary.stage === 'assigned') { %>
<section class="card stack">
  <h2>전체 공개</h2>
  <p>공개하면 참가자 모두가 마니또 맵을 볼 수 있습니다. 되돌릴 수 없습니다.</p>
  <form method="post" action="<%= base %>/manage/manito/open"><button class="btn btn-primary">마니또 공개</button></form>
</section>
<section class="card stack">
  <h2>다시 배정</h2>
  <p class="hint">지금 출석한 사람으로 순환을 새로 만들고 모두의 확인 기록을 지웁니다. 계속하려면 "다시 배정"이라고 입력하세요.</p>
  <form class="stack" method="post" action="<%= base %>/manage/manito/reassign">
    <label>확인 문구<input name="confirm" autocomplete="off"></label>
    <button class="btn btn-danger">다시 배정</button>
  </form>
</section>
<% } else { %>
<section class="card stack">
  <h2>공개됨</h2>
  <% if (summary.locked) { %>
  <p>관리자가 맵을 잠갔습니다. 각자 자기 마니또 확인은 계속 됩니다.</p>
  <% } else { %>
  <p>참가자 모두가 마니또 맵을 볼 수 있습니다.</p>
  <div><a class="btn" href="<%= base %>/manito/map">마니또 맵 보기</a></div>
  <% } %>
</section>
<% } %>
```

- [ ] **Step 6: Add the dashboard card and menu item**

In `src/views/creator/dashboard.ejs`, append at the end:

```ejs
<section class="card stack">
  <h2>참가 마감</h2>
  <% if (event.join_closed) { %>
  <p><strong>참가 마감됨</strong> · 처음 보는 이름으로는 입장할 수 없습니다. 이미 등록한 사람은 다시 들어올 수 있습니다.</p>
  <form method="post" action="<%= base %>/manage/join-closed"><input type="hidden" name="closed" value="0"><button class="btn">마감 풀기</button></form>
  <% } else { %>
  <p><strong>참가 받는 중</strong> · 초대 링크와 인증코드로 새로 입장할 수 있습니다.</p>
  <form method="post" action="<%= base %>/manage/join-closed"><input type="hidden" name="closed" value="1"><button class="btn">참가 마감</button></form>
  <% } %>
  <p class="hint">마감 중에도 참가자 관리에서 직접 추가할 수 있습니다.</p>
</section>
```

In `src/views/partials/creator-nav.ejs`, add `['/manito', '마니또']` right after `['/draw', '팀 뽑기']` in `navItems`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-manito.routes.test.js tests/format.test.js tests/creator.routes.test.js tests/manage-layout.routes.test.js`
Expected: PASS

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/routes/creator.js src/services/format.js src/views/creator/manito.ejs src/views/creator/dashboard.ejs src/views/partials/creator-nav.ejs tests/creator-manito.routes.test.js tests/format.test.js
git commit -m "feat: 생성자 마니또 관리 화면과 참가 마감

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 관리자 마니또 칸, 맵 잠금, 참가 마감

**Files:**
- Modify: `src/routes/admin.js`
- Modify: `src/views/admin/event.ejs`
- Test: `tests/admin-manito.routes.test.js`

**Interfaces:**
- Consumes: `manito.adminView(eventId)`, `manito.setLocked(eventId, locked)` (Task 2); `events.setJoinClosed(id, closed)` (Task 3); `manitoStageLabel` (Task 5, view local)
- Produces: `POST /admin/events/:id/manito-lock`(`locked=1|0`, 302 → `?done=manitoLock|manitoUnlock`), `POST /admin/events/:id/join-closed`(`closed=1|0`, 302 → `?done=joinClosed|joinOpen`); 상세 화면 `<section class="card stack" id="manito">`, `<section class="card stack" id="join">`

- [ ] **Step 1: Write the failing test**

`tests/admin-manito.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const manito = require('../src/services/manito');
const { mulberry32 } = require('../src/services/draw-assign');

test.beforeEach(H.resetDb);

const REAL = ['홍길동', '남궁민원', '이순신'];
const MASKED = ['홍*동', '남**원', '이*신'];

async function setup() {
  const { event } = await H.makeEvent({ creatorName: '홍길동' });
  await H.addParticipant(event.id, '남궁민원');
  await H.addParticipant(event.id, '이순신');
  return { event, admin: await H.adminAgent(), path: `/admin/events/${event.id}` };
}
const sectionOf = (html, id) => {
  const m = html.match(new RegExp(`<section class="card stack" id="${id}">([\\s\\S]*?)</section>`));
  assert.ok(m, `${id} 칸이 없다`);
  return m[1];
};
const eventRow = async (id) => (await H.db.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];

test('관리자 상세: 마니또 칸은 공개 전에도 마스킹된 고리만 보인다', async () => {
  const { event, admin, path } = await setup();
  let section = sectionOf((await admin.get(path).expect(200)).text, 'manito');
  assert.match(section, /준비/);
  await manito.assign(event.id, mulberry32(1));
  const html = (await admin.get(path).expect(200)).text;
  section = sectionOf(html, 'manito');
  assert.match(section, /배정됨/);
  for (const name of MASKED) assert.ok(section.includes(name), `${name}이 없다`);
  for (const name of REAL) assert.ok(!section.includes(name), `${name}이 마니또 칸에 노출됨`);
  for (const a of REAL) for (const b of REAL) assert.ok(!html.includes(`${a} → ${b}`), '원래 이름 쌍이 노출됨');
});

test('관리자 맵 잠금: 잠그면 참가자 맵이 숨겨지고 풀면 다시 보인다', async () => {
  const { event, admin, path } = await setup();
  await manito.assign(event.id, mulberry32(2));
  await manito.open(event.id);
  let res = await admin.post(`${path}/manito-lock`).type('form').send({ locked: '1' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=manitoLock`);
  assert.equal((await eventRow(event.id)).manito_locked, true);
  assert.equal(await manito.map(event.id), null);
  res = await admin.get(`${path}?done=manitoLock`).expect(200);
  assert.match(res.text, /마니또 맵을 잠갔습니다/);
  assert.match(sectionOf(res.text, 'manito'), /잠금 해제/);
  res = await admin.post(`${path}/manito-lock`).type('form').send({ locked: '0' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=manitoUnlock`);
  assert.equal((await eventRow(event.id)).manito_locked, false);
  assert.ok(await manito.map(event.id));
});

test('관리자 참가 마감 켜기·끄기', async () => {
  const { event, admin, path } = await setup();
  assert.match(sectionOf((await admin.get(path)).text, 'join'), /참가 받는 중/);
  let res = await admin.post(`${path}/join-closed`).type('form').send({ closed: '1' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=joinClosed`);
  assert.equal((await eventRow(event.id)).join_closed, true);
  res = await admin.get(`${path}?done=joinClosed`).expect(200);
  assert.match(res.text, /참가를 마감했습니다/);
  assert.match(sectionOf(res.text, 'join'), /참가 마감됨/);
  res = await admin.post(`${path}/join-closed`).type('form').send({ closed: '0' }).expect(302);
  assert.equal(res.headers.location, `${path}?done=joinOpen`);
  assert.equal((await eventRow(event.id)).join_closed, false);
});

test('관리자가 아니면 잠금·마감을 바꿀 수 없고, 없는 운동회는 404', async () => {
  const { event, path } = await setup();
  const app = H.request(H.getApp());
  for (const [suffix, body] of [['/manito-lock', { locked: '1' }], ['/join-closed', { closed: '1' }]]) {
    const res = await app.post(`${path}${suffix}`).type('form').send(body).expect(302);
    assert.equal(res.headers.location, '/admin/login');
  }
  const row = await eventRow(event.id);
  assert.equal(row.manito_locked, false);
  assert.equal(row.join_closed, false);
  const admin = await H.adminAgent();
  await admin.post('/admin/events/999999/manito-lock').type('form').send({ locked: '1' }).expect(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/admin-manito.routes.test.js`
Expected: FAIL (`manito 칸이 없다`, 404 on POST)

- [ ] **Step 3: Update `src/routes/admin.js`**

Add the require below `const schedules = require('../services/schedules');`:

```js
const manito = require('../services/manito');
```

Extend `DONE_MESSAGES`:

```js
const DONE_MESSAGES = {
  pin: '참가자 PIN을 재설정했습니다',
  creator: '생성자 PIN을 재설정했습니다',
  manitoLock: '마니또 맵을 잠갔습니다',
  manitoUnlock: '마니또 맵 잠금을 풀었습니다',
  joinClosed: '참가를 마감했습니다',
  joinOpen: '참가 마감을 풀었습니다',
};
```

Replace `renderDetail` with:

```js
async function renderDetail(req, res, { message = null, error = null, status = 200 } = {}) {
  const [list, manitoView] = await Promise.all([
    participants.listParticipants(req.event.id),
    manito.adminView(req.event.id),
  ]);
  res.status(status).render('admin/event', {
    title: `관리: ${req.event.title}`,
    wide: true,
    event: req.event,
    list,
    manito: manitoView,
    inviteUrl: inviteUrl(req, req.event),
    message,
    error,
  });
}
```

Add after the `/creator-pin` route:

```js
router.post('/events/:id/manito-lock', loadAdminEvent, async (req, res) => {
  const locked = req.body.locked === '1';
  await manito.setLocked(req.event.id, locked);
  res.redirect(`/admin/events/${req.event.id}?done=${locked ? 'manitoLock' : 'manitoUnlock'}`);
});

router.post('/events/:id/join-closed', loadAdminEvent, async (req, res) => {
  const closed = req.body.closed === '1';
  await events.setJoinClosed(req.event.id, closed);
  res.redirect(`/admin/events/${req.event.id}?done=${closed ? 'joinClosed' : 'joinOpen'}`);
});
```

- [ ] **Step 4: Add the sections to `src/views/admin/event.ejs`**

Insert directly after the `생성자 PIN 재설정` `</section>`:

```ejs
<section class="card stack" id="manito">
  <h2>마니또</h2>
  <p>상태 <strong><%= manitoStageLabel(manito.stage) %></strong> · 순환 <%= manito.size %>명 · 확인 <%= manito.acknowledgedCount %>명 · 맵 <%= manito.locked ? '잠김' : '열림' %></p>
  <% if (manito.cycle.length) { %>
  <p class="copy"><%= manito.cycle.join(' → ') %> → <%= manito.cycle[0] %></p>
  <% } else if (manito.stage !== 'none') { %>
  <p class="muted">이어진 순환이 없습니다.</p>
  <% } %>
  <form method="post" action="/admin/events/<%= event.id %>/manito-lock">
    <input type="hidden" name="locked" value="<%= manito.locked ? '0' : '1' %>">
    <button class="btn btn-small"><%= manito.locked ? '잠금 해제' : '맵 잠그기' %></button>
  </form>
  <p class="hint">잠그면 공개된 전체 맵만 숨겨집니다. 각자 자기 마니또 확인은 계속 됩니다. 이름은 항상 가려서 보여 줍니다.</p>
</section>
<section class="card stack" id="join">
  <h2>참가 마감</h2>
  <p><strong><%= event.join_closed ? '참가 마감됨' : '참가 받는 중' %></strong></p>
  <form method="post" action="/admin/events/<%= event.id %>/join-closed">
    <input type="hidden" name="closed" value="<%= event.join_closed ? '0' : '1' %>">
    <button class="btn btn-small"><%= event.join_closed ? '마감 풀기' : '참가 마감' %></button>
  </form>
</section>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/admin-manito.routes.test.js tests/admin.routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/admin.js src/views/admin/event.ejs tests/admin-manito.routes.test.js
git commit -m "feat: 관리자 마니또 마스킹 조회, 맵 잠금, 참가 마감

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
