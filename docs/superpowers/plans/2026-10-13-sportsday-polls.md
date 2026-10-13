# 명량운동회 4단계(투표) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 생성자가 투표를 만들고(익명/비익명, 다중 선택, 기타) 참가자가 마감 전까지 투표·다시 투표하며, 생성자가 마감 후 결과를 공개하고, 공개 전에는 득표가 누구에게도 보이지 않게 한다.

**Architecture:** 결과 계산은 순수 함수(`poll-tally.js`)로, 상태 변경·투표는 `polls.js` 서비스가 투표 행을 `FOR UPDATE`로 잠근 트랜잭션에서 처리한다. 득표는 `revealed`일 때만 서비스가 반환하고, 이름은 비익명 투표일 때만 쿼리에서 가져온다. 결과 화면은 참가자·생성자가 같은 partial(`partials/poll-results.ejs`)을 쓴다.

**Tech Stack:** Node 24(CommonJS), Express 5, EJS + express-ejs-layouts, PostgreSQL 17(`pg`), node:test + supertest

**Spec:** `docs/superpowers/specs/2026-10-13-sportsday-polls-design.md`

## Global Constraints

- Node.js 24 이상, CommonJS(`require`), TypeScript 사용 안 함, 새 의존성 추가 없음
- 실시간 갱신(폴링, SSE, 소켓) 없음. 상태 변경은 모두 POST. 사용자에게 보이는 문구는 모두 한국어
- 디자인은 기존 `src/public/css/app.css` 변수와 클래스(`card`, `stack`, `row`, `btn`, `btn-primary`, `btn-danger`, `btn-small`, `btn-block`, `stats`, `hint`, `muted`, `badge`, `list`, `alert`, `label.check`)를 따른다. 터치 영역 44px 이상
- 투표 상태: `open` 진행 중 / `closed` 마감 / `revealed` 결과 공개. 허용 전환: `open→closed`, `closed→open`, `closed→revealed`. `revealed`는 되돌릴 수 없다
- 입력 한도: 제목 1~50자, 항목 2~20개(각 1~50자, 빈 줄 무시, 중복 불가), 최대 선택 수 1~항목 수, 기타 내용 1~50자. 새 투표 기본값: 익명, 기타 비허용, 최대 선택 1
- 득표(항목별 수·기타 내용)는 `revealed` 전에는 누구에게도(생성자 포함) 반환·렌더링하지 않는다. 익명 투표는 공개 후에도 이름을 반환·렌더링하지 않는다. 관리자 화면에는 응답·이름이 없다
- 수정은 투표자 0명이고 `revealed`가 아닐 때만. 삭제 확인 문구 `삭제`(앞뒤 공백 무시). 마감된 투표에 투표하면 `마감된 투표입니다`
- 모든 서비스: id는 `/^[1-9]\d{0,17}$/`로 검증, 모든 쿼리는 `event_id`로 범위 제한, 검증 실패는 `ValidationError`, 잘못된 형식·다른 운동회의 id는 `null`/`false`(라우트에서 404)
- 투표·상태 전환·수정·삭제는 `db.tx` 안에서 투표 행을 `SELECT ... FOR UPDATE`로 잠그고 상태를 다시 확인한다
- 테스트는 원격 공유 테스트 DB를 쓰므로 반드시 `npm test`(이미 `--test-concurrency=1`)로 실행한다. 단일 파일은 `NODE_ENV=test node db/migrate.js && NODE_ENV=test node --test --test-concurrency=1 tests/<file>`
- `.env`는 읽지도, 출력하지도, 수정하지도 않는다
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **공개 전 득표 누출**: 진행 중·마감 상태의 참가자 상세와 생성자 상세 HTML에 결과 영역(`poll-results`)이나 `N표 ·` 같은 득표가 없어야 한다 → Task 3, Task 4 테스트
2. **마감과 동시에 들어온 투표**: 각 투표는 반영되거나 `마감된 투표입니다`로 거부되고, 투표자 수와 성공한 투표 수가 같아야 한다 → Task 2 테스트
3. **최대 1개 투표에서 항목 → 기타로 바꾸기**: 라디오는 체크를 풀 수 없으므로 "기타"도 같은 라디오 그룹의 선택지(`option=other`)여야 바꿀 수 있다 → Task 2(서비스), Task 3(화면) 테스트
4. **수정 전에 연 투표 화면으로 투표**: 항목이 바뀌어 없어진 항목 id로 투표하면 `투표 항목이 올바르지 않습니다` → Task 2 테스트
5. **제목·항목·기타 내용의 HTML 문자**: 목록·상세·결과에서 이스케이프되어야 한다 → Task 3 테스트

## Rulings carried into the plan

- 투표 폼의 "기타"는 항목과 같은 `name="option"` 그룹의 선택지(`value="other"`)로 두고, 텍스트는 `name="other"`로 받는다. 서비스는 `option` 목록에 `other`가 있을 때만 기타 내용을 센다(체크하지 않은 기타 칸의 글자는 무시)
- 공개 후 1등 강조는 일반 항목끼리만 비교한다(기타 응답은 별도 목록)
- 관리자·생성자 목록의 "N/M명"에서 M은 운동회 참가자 전체 수(결석 포함)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/services/poll-tally.js` (새) | 순수 함수 `tally` |
| `db/migrations/005_polls.sql` (새) | 조회용 인덱스 3개 |
| `src/services/polls.js` (새) | 만들기·수정·삭제·상태 전환·투표·목록·상세·홈 요약 |
| `src/services/format.js` | `pollStatusLabel` |
| `src/routes/participant.js` | 홈 카드 데이터, `/polls`, `/polls/:id`, `/polls/:id/vote` |
| `src/views/participant/polls.ejs`, `poll.ejs` (새) | 참가자 목록·상세 |
| `src/views/partials/poll-results.ejs` (새) | 결과(참가자·생성자 공용) |
| `src/views/partials/poll-form.ejs` (새) | 만들기·수정 폼 필드(생성자) |
| `src/routes/creator.js`, `src/views/creator/polls.ejs`, `poll.ejs` (새) | 생성자 투표 관리 |
| `src/views/partials/creator-nav.ejs` | 메뉴 "투표" |
| `src/routes/admin.js`, `src/views/admin/event.ejs` | 관리자 투표 칸 |
| `src/views/participant/home.ejs` | 홈 카드 |
| `src/public/css/app.css` | 라디오, 결과 막대 |

---

### Task 1: 결과 계산 순수 함수

**Files:**
- Create: `src/services/poll-tally.js`
- Test: `tests/poll-tally.test.js`

**Interfaces:**
- Produces: `tally({ anonymous: boolean, options: [{ id: string, label: string }], answers: [{ option_id: string|null, other_text: string|null, name?: string }], voterCount: number }) → { voterCount, options: [{ id, label, count, percent, top, names }], others: [{ text, count, names }], otherCount }`
  - `percent = voterCount ? Math.round(count * 100 / voterCount) : 0`
  - `top`: 일반 항목 중 최다 득표(동점 모두), 최다가 0이면 모두 `false`
  - `names`: 비익명일 때만 이름순(`localeCompare(…, 'ko')`), 익명이면 항상 `[]`(입력에 이름이 있어도)
  - `others`: 같은 `other_text`끼리 묶어 개수 많은 순, 같으면 내용순

- [ ] **Step 1: Write the failing test**

`tests/poll-tally.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { tally } = require('../src/services/poll-tally');

const options = [{ id: '1', label: '짜장면' }, { id: '2', label: '짬뽕' }, { id: '3', label: '볶음밥' }];
const pick = (optionId, name) => ({ option_id: optionId, other_text: null, name });
const other = (text, name) => ({ option_id: null, other_text: text, name });

test('표 수, 반올림 비율, 최다 강조, 비익명 이름순', () => {
  const r = tally({ anonymous: false, options, answers: [pick('1', '철수'), pick('1', '영희'), pick('2', '민수')], voterCount: 3 });
  assert.deepEqual(r.options.map((o) => [o.id, o.label, o.count, o.percent, o.top]), [
    ['1', '짜장면', 2, 67, true], ['2', '짬뽕', 1, 33, false], ['3', '볶음밥', 0, 0, false],
  ]);
  assert.deepEqual(r.options[0].names, ['영희', '철수']);
  assert.equal(r.voterCount, 3);
});

test('동점이면 모두 최다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1'), pick('2')], voterCount: 2 });
  assert.deepEqual(r.options.map((o) => o.top), [true, true, false]);
});

test('익명이면 이름이 들어와도 결과에 넣지 않는다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1', '철수'), other('탕수육', '영희')], voterCount: 2 });
  assert.deepEqual(r.options[0].names, []);
  assert.deepEqual(r.others, [{ text: '탕수육', count: 1, names: [] }]);
  assert.ok(!JSON.stringify(r).includes('철수'));
  assert.ok(!JSON.stringify(r).includes('영희'));
});

test('기타는 같은 내용끼리 묶어 많은 순, 같으면 내용순', () => {
  const r = tally({
    anonymous: false,
    options,
    answers: [other('탕수육', '철수'), other('냉면', '민수'), other('탕수육', '영희'), other('군만두', '지수')],
    voterCount: 4,
  });
  assert.deepEqual(r.others, [
    { text: '탕수육', count: 2, names: ['영희', '철수'] },
    { text: '군만두', count: 1, names: ['지수'] },
    { text: '냉면', count: 1, names: ['민수'] },
  ]);
  assert.equal(r.otherCount, 4);
  assert.deepEqual(r.options.map((o) => o.top), [false, false, false], '기타만 있으면 강조할 항목이 없다');
});

test('투표자 0명', () => {
  const r = tally({ anonymous: true, options, answers: [], voterCount: 0 });
  assert.deepEqual(r.options.map((o) => [o.count, o.percent, o.top]), [[0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(r.others, []);
  assert.equal(r.otherCount, 0);
});

test('다중 선택은 항목별 비율이 투표자 수 기준이다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1'), pick('2'), pick('1')], voterCount: 2 });
  assert.deepEqual(r.options.map((o) => o.percent), [100, 50, 0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/poll-tally.test.js`
Expected: FAIL with `Cannot find module '../src/services/poll-tally'`

- [ ] **Step 3: Write minimal implementation**

`src/services/poll-tally.js`:

```js
// 투표 결과 계산. DB와 무관한 순수 함수이며 익명 투표에는 이름을 넣지 않는다

const byKo = (a, b) => a.localeCompare(b, 'ko');

function tally({ anonymous, options, answers, voterCount }) {
  const percent = (n) => (voterCount ? Math.round((n * 100) / voterCount) : 0);
  const namesOf = (list) => (anonymous ? [] : list.map((a) => a.name).sort(byKo));

  const rows = options.map((o) => {
    const picked = answers.filter((a) => a.option_id != null && String(a.option_id) === String(o.id));
    return { id: String(o.id), label: o.label, count: picked.length, percent: percent(picked.length), top: false, names: namesOf(picked) };
  });
  const best = Math.max(0, ...rows.map((r) => r.count));
  for (const r of rows) r.top = best > 0 && r.count === best;

  const groups = new Map();
  for (const a of answers) {
    if (a.other_text == null) continue;
    if (!groups.has(a.other_text)) groups.set(a.other_text, []);
    groups.get(a.other_text).push(a);
  }
  const others = [...groups.entries()]
    .map(([text, list]) => ({ text, count: list.length, names: namesOf(list) }))
    .sort((x, y) => y.count - x.count || byKo(x.text, y.text));

  return { voterCount, options: rows, others, otherCount: others.reduce((sum, g) => sum + g.count, 0) };
}

module.exports = { tally };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/poll-tally.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the full suite, then commit**

Run: `npm test` — Expected: PASS

```bash
git add src/services/poll-tally.js tests/poll-tally.test.js
git commit -m "feat: 투표 결과 계산 순수 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 마이그레이션과 투표 서비스

**Files:**
- Create: `db/migrations/005_polls.sql`
- Create: `src/services/polls.js`
- Test: `tests/polls.service.test.js`

**Interfaces:**
- Consumes: Task 1 `tally(...)`; `db.tx`, `db.query`; `ValidationError`; `H.makeEvent`, `H.addParticipant`, `H.db` from `tests/helpers.js`
- Produces (`src/services/polls.js`; poll row는 DB 그대로 — `id`, `event_id`, `title`, `anonymous`, `max_choices`, `allow_other`, `status`, `created_at`, id는 문자열):
  - `CLOSED = '마감된 투표입니다'`, `CONFIRM = '삭제'`
  - `createPoll(eventId, input) → poll` — input 필드: `title`, `options`(줄바꿈 구분 문자열), `maxChoices`(문자열/숫자, 빈 값이면 1), `anonymous`(`'0'`이면 비익명, 그 외·없음은 익명), `allowOther`(`'on'`/`'1'`/`true`이면 허용)
  - `updatePoll(eventId, pollId, input) → poll | null`
  - `deletePoll(eventId, pollId, confirm) → boolean` (확인 문구가 틀리면 `ValidationError`)
  - `setStatus(eventId, pollId, status) → poll | null`
  - `vote(eventId, pollId, participantId, input) → true | null` — input 필드: `option`(문자열 또는 배열, 항목 id 또는 `'other'`), `other`(기타 내용)
  - `selectionFromInput(input) → { optionIds: string[], other: string|null }` — 400 재렌더링 시 입력 유지용
  - `getForParticipant(eventId, pollId, participantId) → { poll, options: [{id,label}], mine: { voted, optionIds, other }, results: tallyResult|null } | null`
  - `getForCreator(eventId, pollId) → { poll, options, voterCount, participantCount, nonVoters: [{ name, attendance }]|null, results: tallyResult|null } | null` — `nonVoters`는 공개 전에만 배열, 공개 후 `null`
  - `formValues(poll, options) → { title, options, maxChoices, anonymous: '1'|'0', allowOther: 'on'|'' }`
  - `listForParticipant(eventId, participantId) → [{ id, title, status, voted }]` 최신순
  - `listWithCounts(eventId) → [{ id, title, status, voter_count, participant_count }]` 최신순 (생성자·관리자 공용)
  - `homeSummary(eventId, participantId) → { total, open, pending }`

- [ ] **Step 1: Add the migration**

`db/migrations/005_polls.sql`:

```sql
-- 투표 조회용 인덱스. 테이블은 001_init.sql에서 만들었다
CREATE INDEX polls_event_idx ON polls (event_id);
CREATE INDEX poll_options_poll_idx ON poll_options (poll_id, sort_order);
CREATE INDEX poll_answers_poll_idx ON poll_answers (poll_id);
```

- [ ] **Step 2: Write the failing test**

`tests/polls.service.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/services/polls');

test.beforeEach(H.resetDb);

const BASE = { title: '점심 메뉴', options: '짜장면\n짬뽕\n볶음밥', maxChoices: '1' };
const makePoll = (eventId, over = {}) => polls.createPoll(eventId, { ...BASE, ...over });
const optionIds = async (pollId) => (await H.db.query(
  'SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order, id', [pollId],
)).rows.map((r) => r.id);
const answersOf = async (pollId) => (await H.db.query(
  'SELECT option_id::text AS option_id, other_text, participant_id::text AS participant_id FROM poll_answers WHERE poll_id = $1 ORDER BY option_id NULLS LAST',
  [pollId],
)).rows;
const voterCount = async (pollId) => (await H.db.query(
  'SELECT count(*)::int AS n FROM poll_voters WHERE poll_id = $1', [pollId],
)).rows[0].n;

async function setup() {
  const { event, participant: creator } = await H.makeEvent();
  const a = await H.addParticipant(event.id, '가람');
  const b = await H.addParticipant(event.id, '나래');
  const c = await H.addParticipant(event.id, '다솜', { attendance: 'absent' });
  return { event, creator, a, b, c };
}

test('마이그레이션: 조회용 인덱스', async () => {
  const { rows } = await H.db.query(
    "SELECT indexname FROM pg_indexes WHERE indexname IN ('polls_event_idx', 'poll_options_poll_idx', 'poll_answers_poll_idx') ORDER BY indexname",
  );
  assert.deepEqual(rows.map((r) => r.indexname), ['poll_answers_poll_idx', 'poll_options_poll_idx', 'polls_event_idx']);
});

test('만들기: 기본값과 항목 순서', async () => {
  const { event } = await setup();
  const poll = await makePoll(event.id, { options: ' 짜장면 \n\n짬뽕\r\n볶음밥\n' });
  assert.equal(poll.status, 'open');
  assert.equal(poll.anonymous, true);
  assert.equal(poll.allow_other, false);
  assert.equal(poll.max_choices, 1);
  const { rows } = await H.db.query('SELECT label FROM poll_options WHERE poll_id = $1 ORDER BY sort_order', [poll.id]);
  assert.deepEqual(rows.map((r) => r.label), ['짜장면', '짬뽕', '볶음밥']);
  const named = await makePoll(event.id, { anonymous: '0', allowOther: 'on', maxChoices: '2' });
  assert.equal(named.anonymous, false);
  assert.equal(named.allow_other, true);
  assert.equal(named.max_choices, 2);
  assert.equal((await makePoll(event.id, { maxChoices: '' })).max_choices, 1);
});

test('만들기: 입력 검증', async () => {
  const { event } = await setup();
  await assert.rejects(makePoll(event.id, { title: ' ' }), /제목은 1~50자/);
  await assert.rejects(makePoll(event.id, { title: 'ㄱ'.repeat(51) }), /제목은 1~50자/);
  await assert.rejects(makePoll(event.id, { options: '하나' }), /항목은 2~20개/);
  await assert.rejects(makePoll(event.id, { options: Array.from({ length: 21 }, (_, i) => `항목${i}`).join('\n') }), /항목은 2~20개/);
  await assert.rejects(makePoll(event.id, { options: `가\n${'ㄴ'.repeat(51)}` }), /항목은 50자 이하/);
  await assert.rejects(makePoll(event.id, { options: '가\n나\n가' }), /같은 항목이 두 번/);
  await assert.rejects(makePoll(event.id, { maxChoices: '0' }), /최대 선택 수는 1~3/);
  await assert.rejects(makePoll(event.id, { maxChoices: '4' }), /최대 선택 수는 1~3/);
  await assert.rejects(makePoll(event.id, { maxChoices: '1.5' }), /최대 선택 수는 1~3/);
  await assert.rejects(polls.createPoll('abc', BASE), /운동회를 찾을 수 없습니다/);
});

test('상태 전환: 허용된 것만', async () => {
  const { event } = await setup();
  const poll = await makePoll(event.id);
  await assert.rejects(polls.setStatus(event.id, poll.id, 'revealed'), /결과 공개는 마감한 뒤에/);
  await assert.rejects(polls.setStatus(event.id, poll.id, 'open'), /이미 그 상태입니다/);
  await assert.rejects(polls.setStatus(event.id, poll.id, 'x'), /상태 값이 올바르지 않습니다/);
  assert.equal((await polls.setStatus(event.id, poll.id, 'closed')).status, 'closed');
  assert.equal((await polls.setStatus(event.id, poll.id, 'open')).status, 'open');
  await polls.setStatus(event.id, poll.id, 'closed');
  assert.equal((await polls.setStatus(event.id, poll.id, 'revealed')).status, 'revealed');
  await assert.rejects(polls.setStatus(event.id, poll.id, 'open'), /결과를 공개한 투표는 바꿀 수 없습니다/);
  assert.equal(await polls.setStatus(event.id, 'abc', 'closed'), null);
  const { event: other } = await H.makeEvent();
  assert.equal(await polls.setStatus(other.id, poll.id, 'closed'), null);
});

test('투표: 입력 검증', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  const ids = await optionIds(poll.id);
  const otherPoll = await makePoll(event.id);
  const foreign = (await optionIds(otherPoll.id))[0];
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: foreign }), /투표 항목이 올바르지 않습니다/);
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: 'abc' }), /투표 항목이 올바르지 않습니다/);
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: [ids[0], ids[1]] }), /최대 1개까지/);
  await assert.rejects(polls.vote(event.id, poll.id, a.id, {}), /하나 이상 골라 주세요/);
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: 'other', other: '탕수육' }), /기타 입력을 받지 않습니다/);
  const open = await makePoll(event.id, { allowOther: 'on', maxChoices: '2' });
  await assert.rejects(polls.vote(event.id, open.id, a.id, { option: 'other', other: '  ' }), /기타 내용을 입력해 주세요/);
  await assert.rejects(polls.vote(event.id, open.id, a.id, { option: 'other', other: 'ㄱ'.repeat(51) }), /기타 내용은 50자 이하/);
  assert.equal(await voterCount(poll.id), 0);
  assert.equal(await voterCount(open.id), 0);
});

test('투표: 같은 항목 중복은 하나로, 체크하지 않은 기타 글자는 무시', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id, { allowOther: 'on', maxChoices: '2' });
  const ids = await optionIds(poll.id);
  assert.equal(await polls.vote(event.id, poll.id, a.id, { option: [ids[0], ids[0]], other: '무시됨' }), true);
  assert.deepEqual(await answersOf(poll.id), [{ option_id: ids[0], other_text: null, participant_id: String(a.id) }]);
});

test('다시 투표는 이전 응답을 통째로 바꾸고 투표자는 한 명', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id, { allowOther: 'on', maxChoices: '2' });
  const ids = await optionIds(poll.id);
  await polls.vote(event.id, poll.id, a.id, { option: [ids[0], ids[1]] });
  await polls.vote(event.id, poll.id, a.id, { option: [ids[2], 'other'], other: ' 탕수육 ' });
  assert.deepEqual(await answersOf(poll.id), [
    { option_id: ids[2], other_text: null, participant_id: String(a.id) },
    { option_id: null, other_text: '탕수육', participant_id: String(a.id) },
  ]);
  assert.equal(await voterCount(poll.id), 1);
});

test('최대 1개 투표에서 항목 → 기타로 바꿀 수 있다', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id, { allowOther: 'on' });
  const ids = await optionIds(poll.id);
  await polls.vote(event.id, poll.id, a.id, { option: ids[0] });
  await polls.vote(event.id, poll.id, a.id, { option: 'other', other: '냉면' });
  assert.deepEqual((await answersOf(poll.id)).map((r) => [r.option_id, r.other_text]), [[null, '냉면']]);
});

test('마감·공개된 투표에는 투표할 수 없고, 다시 열면 된다', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  const ids = await optionIds(poll.id);
  await polls.setStatus(event.id, poll.id, 'closed');
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: ids[0] }), /마감된 투표입니다/);
  await polls.setStatus(event.id, poll.id, 'open');
  assert.equal(await polls.vote(event.id, poll.id, a.id, { option: ids[0] }), true);
  await polls.setStatus(event.id, poll.id, 'closed');
  await polls.setStatus(event.id, poll.id, 'revealed');
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: ids[1] }), /마감된 투표입니다/);
});

test('투표: 다른 운동회 참가자·없는 투표·잘못된 id는 null', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  const ids = await optionIds(poll.id);
  const { participant: stranger } = await H.makeEvent();
  assert.equal(await polls.vote(event.id, poll.id, stranger.id, { option: ids[0] }), null);
  assert.equal(await polls.vote(event.id, '999999', a.id, { option: ids[0] }), null);
  assert.equal(await polls.vote(event.id, 'abc', a.id, { option: ids[0] }), null);
  assert.equal(await polls.vote(event.id, poll.id, 'abc', { option: ids[0] }), null);
  assert.equal(await voterCount(poll.id), 0);
});

test('수정: 투표자 0명일 때만, 공개 후 불가, 수정 전 항목 id로는 투표할 수 없다', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  const oldIds = await optionIds(poll.id);
  const updated = await polls.updatePoll(event.id, poll.id, { title: '저녁 메뉴', options: '고기\n회', maxChoices: '2', anonymous: '0' });
  assert.equal(updated.title, '저녁 메뉴');
  assert.equal(updated.anonymous, false);
  assert.equal(updated.max_choices, 2);
  const newIds = await optionIds(poll.id);
  assert.equal(newIds.length, 2);
  await assert.rejects(polls.vote(event.id, poll.id, a.id, { option: oldIds[0] }), /투표 항목이 올바르지 않습니다/);
  await polls.vote(event.id, poll.id, a.id, { option: newIds[0] });
  await assert.rejects(polls.updatePoll(event.id, poll.id, BASE), /이미 투표한 사람이 있어 수정할 수 없습니다/);
  const empty = await makePoll(event.id);
  await polls.setStatus(event.id, empty.id, 'closed');
  await polls.setStatus(event.id, empty.id, 'revealed');
  await assert.rejects(polls.updatePoll(event.id, empty.id, BASE), /결과를 공개한 투표는 수정할 수 없습니다/);
  assert.equal(await polls.updatePoll(event.id, 'abc', BASE), null);
});

test('삭제: 확인 문구, 응답까지 지움, 다른 운동회는 false', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  await polls.vote(event.id, poll.id, a.id, { option: (await optionIds(poll.id))[0] });
  await assert.rejects(polls.deletePoll(event.id, poll.id, '지워'), /확인 문구 "삭제"/);
  const { event: other } = await H.makeEvent();
  assert.equal(await polls.deletePoll(other.id, poll.id, '삭제'), false);
  assert.equal(await polls.deletePoll(event.id, poll.id, ' 삭제 '), true);
  assert.equal(await voterCount(poll.id), 0);
  assert.deepEqual(await answersOf(poll.id), []);
  assert.equal(await polls.deletePoll(event.id, poll.id, '삭제'), false);
});

test('참가자 조회: 공개 전에는 결과 없음, 내 선택만', async () => {
  const { event, a, b } = await setup();
  const poll = await makePoll(event.id, { allowOther: 'on', maxChoices: '2' });
  const ids = await optionIds(poll.id);
  await polls.vote(event.id, poll.id, a.id, { option: [ids[0], 'other'], other: '탕수육' });
  await polls.vote(event.id, poll.id, b.id, { option: ids[1] });
  const view = await polls.getForParticipant(event.id, poll.id, a.id);
  assert.equal(view.results, null);
  assert.deepEqual(view.mine, { voted: true, optionIds: [ids[0]], other: '탕수육' });
  assert.deepEqual(view.options.map((o) => o.label), ['짜장면', '짬뽕', '볶음밥']);
  const fresh = await polls.getForParticipant(event.id, poll.id, (await H.addParticipant(event.id, '라온')).id);
  assert.deepEqual(fresh.mine, { voted: false, optionIds: [], other: null });
  assert.equal(await polls.getForParticipant(event.id, 'abc', a.id), null);
  const { event: other } = await H.makeEvent();
  assert.equal(await polls.getForParticipant(other.id, poll.id, a.id), null);
});

test('공개 후 결과: 익명은 이름 없음, 비익명은 이름 있음', async () => {
  const { event, a, b } = await setup();
  const anon = await makePoll(event.id);
  const named = await makePoll(event.id, { anonymous: '0' });
  for (const poll of [anon, named]) {
    const ids = await optionIds(poll.id);
    await polls.vote(event.id, poll.id, a.id, { option: ids[0] });
    await polls.vote(event.id, poll.id, b.id, { option: ids[0] });
    await polls.setStatus(event.id, poll.id, 'closed');
    await polls.setStatus(event.id, poll.id, 'revealed');
  }
  const anonView = await polls.getForParticipant(event.id, anon.id, a.id);
  assert.deepEqual(anonView.results.options.map((o) => [o.count, o.percent]), [[2, 100], [0, 0], [0, 0]]);
  assert.ok(!JSON.stringify(anonView.results).includes('가람'));
  assert.ok(!JSON.stringify(anonView.results).includes('나래'));
  const namedView = await polls.getForCreator(event.id, named.id);
  assert.deepEqual(namedView.results.options[0].names, ['가람', '나래']);
  assert.equal(namedView.nonVoters, null);
});

test('생성자 조회: 공개 전에는 인원과 안 한 사람만(출석자 먼저, 이름순)', async () => {
  const { event, a } = await setup();
  const poll = await makePoll(event.id);
  await polls.vote(event.id, poll.id, a.id, { option: (await optionIds(poll.id))[0] });
  const view = await polls.getForCreator(event.id, poll.id);
  assert.equal(view.results, null);
  assert.equal(view.voterCount, 1);
  assert.equal(view.participantCount, 4);
  assert.deepEqual(view.nonVoters, [
    { name: '나래', attendance: 'present' },
    { name: '생성자', attendance: 'present' },
    { name: '다솜', attendance: 'absent' },
  ]);
  assert.deepEqual(polls.formValues(view.poll, view.options),
    { title: '점심 메뉴', options: '짜장면\n짬뽕\n볶음밥', maxChoices: 1, anonymous: '1', allowOther: '' });
});

test('목록과 홈 요약', async () => {
  const { event, a } = await setup();
  assert.deepEqual(await polls.homeSummary(event.id, a.id), { total: 0, open: 0, pending: 0 });
  const first = await makePoll(event.id, { title: '첫째' });
  const second = await makePoll(event.id, { title: '둘째' });
  const closed = await makePoll(event.id, { title: '셋째' });
  await polls.setStatus(event.id, closed.id, 'closed');
  await polls.vote(event.id, first.id, a.id, { option: (await optionIds(first.id))[0] });
  assert.deepEqual(await polls.homeSummary(event.id, a.id), { total: 3, open: 2, pending: 1 });
  const list = await polls.listForParticipant(event.id, a.id);
  assert.deepEqual(list.map((p) => [p.title, p.status, p.voted]), [['셋째', 'closed', false], ['둘째', 'open', false], ['첫째', 'open', true]]);
  const counts = await polls.listWithCounts(event.id);
  assert.deepEqual(counts.map((p) => [p.title, p.voter_count, p.participant_count]), [['셋째', 0, 4], ['둘째', 0, 4], ['첫째', 1, 4]]);
  assert.equal(String(list[1].id), String(second.id));
  assert.deepEqual(await polls.listWithCounts('abc'), []);
});

test('selectionFromInput: 400 재렌더링용 입력 유지', () => {
  assert.deepEqual(polls.selectionFromInput({ option: ['3', 'other'], other: '냉면' }), { optionIds: ['3'], other: '냉면' });
  assert.deepEqual(polls.selectionFromInput({ option: '2', other: '무시' }), { optionIds: ['2'], other: null });
  assert.deepEqual(polls.selectionFromInput({}), { optionIds: [], other: null });
});

test('마감과 동시에 들어온 투표는 반영되거나 거부되고, 투표자 수와 성공 수가 같다', async () => {
  const { event } = await H.makeEvent();
  const people = [];
  for (let i = 1; i <= 6; i++) people.push(await H.addParticipant(event.id, `참가자${i}`));
  const poll = await makePoll(event.id);
  const [first] = await optionIds(poll.id);
  const results = await Promise.allSettled([
    ...people.slice(0, 3).map((p) => polls.vote(event.id, poll.id, p.id, { option: first })),
    polls.setStatus(event.id, poll.id, 'closed'),
    ...people.slice(3).map((p) => polls.vote(event.id, poll.id, p.id, { option: first })),
  ]);
  const votes = results.filter((_, i) => i !== 3);
  for (const r of votes) {
    if (r.status === 'rejected') assert.match(r.reason.message, /마감된 투표입니다/);
  }
  assert.equal(results[3].status, 'fulfilled');
  assert.equal(await voterCount(poll.id), votes.filter((r) => r.status === 'fulfilled').length);
  assert.equal((await answersOf(poll.id)).length, await voterCount(poll.id));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NODE_ENV=test node db/migrate.js && NODE_ENV=test node --test --test-concurrency=1 tests/polls.service.test.js`
Expected: migration prints `적용: 005_polls.sql`; tests FAIL with `Cannot find module '../src/services/polls'`

- [ ] **Step 4: Write the implementation**

`src/services/polls.js`:

```js
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
  const p = cleanPoll(input);
  if (!isId(eventId) || !isId(pollId)) return null;
  return db.tx(async (client) => {
    const poll = await lockPoll(client, eventId, pollId);
    if (!poll) return null;
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
  if (!STATUSES.includes(next)) throw new ValidationError('상태 값이 올바르지 않습니다');
  if (!isId(eventId) || !isId(pollId)) return null;
  return db.tx(async (client) => {
    const poll = await lockPoll(client, eventId, pollId);
    if (!poll) return null;
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
    `SELECT v.id AS voter_id, a.option_id::text AS option_id, a.other_text
     FROM poll_voters v LEFT JOIN poll_answers a ON a.poll_id = v.poll_id AND a.participant_id = v.participant_id
     WHERE v.poll_id = $1 AND v.participant_id = $2`,
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

async function getForParticipant(eventId, pollId, participantId) {
  if (!isId(participantId)) return null;
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
  if (!isId(eventId) || !isId(participantId)) return [];
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
```

Note on the `nonVoters` ordering test: `생성자`·`나래` order depends on `ORDER BY p.name` collation. The test expects `나래` before `생성자` (ㄴ < ㅅ), which holds in both the C and ko collations for these names.

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/polls.service.test.js tests/poll-tally.test.js tests/migrate.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — Expected: PASS

```bash
git add db/migrations/005_polls.sql src/services/polls.js tests/polls.service.test.js
git commit -m "feat: 투표 서비스와 조회용 인덱스

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 참가자 화면(홈 카드, 목록, 투표, 결과)

**Files:**
- Modify: `src/services/format.js` (`pollStatusLabel`)
- Modify: `src/routes/participant.js`
- Modify: `src/views/participant/home.ejs`
- Create: `src/views/participant/polls.ejs`, `src/views/participant/poll.ejs`, `src/views/partials/poll-results.ejs`
- Modify: `src/public/css/app.css`
- Test: `tests/participant-polls.routes.test.js`, `tests/format.test.js`

**Interfaces:**
- Consumes: Task 2 `polls.homeSummary`, `listForParticipant`, `getForParticipant`, `vote`, `selectionFromInput`, `createPoll`, `setStatus`; `requireParticipant`, `notFound`
- Produces: `format.pollStatusLabel(status)` — `open→진행 중`, `closed→마감`, `revealed→결과 공개`, 그 외는 그대로 (뷰 locals로 자동 노출); `partials/poll-results.ejs`(locals `poll`, `results`) — Task 4가 재사용; `GET /e/:slug/polls`, `GET /e/:slug/polls/:id`, `POST /e/:slug/polls/:id/vote`(성공 303 → `/polls/:id`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/format.test.js` and add `pollStatusLabel` to its `require('../src/services/format')` destructuring:

```js
test('pollStatusLabel', () => {
  assert.equal(pollStatusLabel('open'), '진행 중');
  assert.equal(pollStatusLabel('closed'), '마감');
  assert.equal(pollStatusLabel('revealed'), '결과 공개');
  assert.equal(pollStatusLabel('x'), 'x');
});
```

`tests/participant-polls.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/services/polls');

test.beforeEach(H.resetDb);

const BASE = { title: '점심 메뉴', options: '짜장면\n짬뽕\n볶음밥', maxChoices: '1' };

async function setup(pollInput = null) {
  const { event } = await H.makeEvent({ creatorName: '마루' });
  const agent = await H.joinAgent(event, { name: '가람', pin: '1234' });
  const other = await H.joinAgent(event, { name: '나래', pin: '1234' });
  const poll = pollInput ? await polls.createPoll(event.id, { ...BASE, ...pollInput }) : null;
  const ids = poll ? (await H.db.query(
    'SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order', [poll.id],
  )).rows.map((r) => r.id) : [];
  return { event, agent, other, poll, ids, base: `/e/${event.slug}` };
}
const reveal = async (event, poll) => {
  await polls.setStatus(event.id, poll.id, 'closed');
  await polls.setStatus(event.id, poll.id, 'revealed');
};

test('홈 카드: 투표 없음 → 투표할 게 있음 → 다 했음', async () => {
  const { event, agent, base } = await setup();
  let res = await agent.get(`${base}/home`).expect(200);
  assert.match(res.text, /아직 투표가 없어요/);
  const poll = await polls.createPoll(event.id, BASE);
  res = await agent.get(`${base}/home`).expect(200);
  assert.match(res.text, /투표할 게 1개 있어요/);
  assert.match(res.text, new RegExp(`href="${base}/polls"`));
  const [first] = (await H.db.query('SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order', [poll.id])).rows;
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: first.id }).expect(303);
  res = await agent.get(`${base}/home`).expect(200);
  assert.doesNotMatch(res.text, /투표할 게/);
  assert.match(res.text, /진행 중 1개/);
});

test('목록·상세·투표·다시 투표', async () => {
  const { agent, poll, ids, base } = await setup({});
  let res = await agent.get(`${base}/polls`).expect(200);
  assert.match(res.text, /점심 메뉴/);
  assert.match(res.text, /안 함/);
  res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /익명 투표예요/);
  assert.equal((res.text.match(/type="radio" name="option"/g) || []).length, 3);
  assert.match(res.text, /투표하기/);
  res = await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[1] }).expect(303);
  assert.equal(res.headers.location, `${base}/polls/${poll.id}`);
  res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /다시 투표/);
  assert.match(res.text, new RegExp(`value="${ids[1]}" checked`));
  assert.match((await agent.get(`${base}/polls`)).text, /투표함/);
});

test('다중 선택과 기타: 체크박스, 초과하면 400과 입력 유지, 항목에서 기타로 바꾸기', async () => {
  const { agent, poll, ids, base } = await setup({ maxChoices: '2', allowOther: 'on', anonymous: '0' });
  let res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /이름이 공개되는 투표예요/);
  assert.match(res.text, /최대 2개/);
  assert.equal((res.text.match(/type="checkbox" name="option"/g) || []).length, 4, '항목 3개 + 기타');
  assert.match(res.text, /name="other"/);
  res = await agent.post(`${base}/polls/${poll.id}/vote`).type('form')
    .send({ option: [ids[0], ids[1], 'other'], other: '탕수육' }).expect(400);
  assert.match(res.text, /최대 2개까지 고를 수 있습니다/);
  assert.match(res.text, new RegExp(`value="${ids[0]}" checked`));
  assert.match(res.text, /value="other" checked/);
  assert.match(res.text, /value="탕수육"/);
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[0] }).expect(303);
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: 'other', other: '냉면' }).expect(303);
  res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /value="other" checked/);
  assert.doesNotMatch(res.text, new RegExp(`value="${ids[0]}" checked`));
});

test('최대 1개 + 기타: 기타도 같은 라디오 그룹', async () => {
  const { agent, poll, base } = await setup({ allowOther: 'on' });
  const res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.equal((res.text.match(/type="radio" name="option"/g) || []).length, 4);
  assert.match(res.text, /type="radio" name="option" value="other"/);
});

test('공개 전에는 득표가 없고, 마감되면 안내와 400', async () => {
  const { event, agent, other, poll, ids, base } = await setup({});
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[0] }).expect(303);
  await other.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[1] }).expect(303);
  let res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.doesNotMatch(res.text, /poll-results/);
  assert.doesNotMatch(res.text, /\d+표 ·/);
  await polls.setStatus(event.id, poll.id, 'closed');
  res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /마감됐어요/);
  assert.match(res.text, /내 선택/);
  assert.match(res.text, /짜장면/);
  assert.doesNotMatch(res.text, /poll-results/);
  assert.doesNotMatch(res.text, /\d+표 ·/);
  res = await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[2] }).expect(400);
  assert.match(res.text, /마감된 투표입니다/);
});

test('공개 후: 익명은 이름 없이 결과, 비익명은 이름', async () => {
  const { event, agent, other, ids, poll, base } = await setup({});
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[0] }).expect(303);
  await other.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: ids[0] }).expect(303);
  await reveal(event, poll);
  let res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /poll-results/);
  assert.match(res.text, /2표 · 100%/);
  assert.ok(!res.text.includes('나래'), '익명 결과에 다른 사람 이름이 없다');

  const named = await polls.createPoll(event.id, { ...BASE, title: '저녁 메뉴', anonymous: '0' });
  const namedIds = (await H.db.query('SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order', [named.id])).rows.map((r) => r.id);
  await other.post(`${base}/polls/${named.id}/vote`).type('form').send({ option: namedIds[1] }).expect(303);
  await reveal(event, named);
  res = await agent.get(`${base}/polls/${named.id}`).expect(200);
  assert.match(res.text, /나래/);
});

test('HTML 문자는 이스케이프된다', async () => {
  const { event, agent, base } = await setup();
  const poll = await polls.createPoll(event.id, {
    title: '<b>제목</b>', options: '<i>가</i>\n나', allowOther: 'on', maxChoices: '2',
  });
  await agent.post(`${base}/polls/${poll.id}/vote`).type('form').send({ option: 'other', other: '<script>x</script>' }).expect(303);
  await reveal(event, poll);
  for (const path of ['/polls', `/polls/${poll.id}`]) {
    const res = await agent.get(`${base}${path}`).expect(200);
    assert.ok(!res.text.includes('<b>제목</b>'));
    assert.ok(res.text.includes('&lt;b&gt;제목&lt;/b&gt;'));
  }
  const res = await agent.get(`${base}/polls/${poll.id}`).expect(200);
  assert.ok(!res.text.includes('<i>가</i>'));
  assert.ok(!res.text.includes('<script>x</script>'));
  assert.ok(res.text.includes('&lt;script&gt;x&lt;/script&gt;'));
});

test('다른 운동회 투표는 404, 입장 안 하면 입장 화면으로', async () => {
  const { base, agent } = await setup();
  const { event: otherEvent } = await H.makeEvent();
  const foreign = await polls.createPoll(otherEvent.id, BASE);
  await agent.get(`${base}/polls/${foreign.id}`).expect(404);
  await agent.post(`${base}/polls/${foreign.id}/vote`).type('form').send({ option: '1' }).expect(404);
  await agent.get(`${base}/polls/abc`).expect(404);
  const anon = H.request(H.getApp());
  for (const path of ['/polls', `/polls/${foreign.id}`]) {
    const res = await anon.get(`${base}${path}`).expect(302);
    assert.equal(res.headers.location, base);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/participant-polls.routes.test.js tests/format.test.js`
Expected: FAIL (404 on `/polls`, `pollStatusLabel is not a function`)

- [ ] **Step 3: Add `pollStatusLabel` to `src/services/format.js`**

Below the existing label helpers:

```js
const POLL_STATUS_LABELS = { open: '진행 중', closed: '마감', revealed: '결과 공개' };
const pollStatusLabel = (status) => POLL_STATUS_LABELS[status] || status;
```

Add `pollStatusLabel` to `module.exports`.

- [ ] **Step 4: Add the routes in `src/routes/participant.js`**

Add the require below the other service requires:

```js
const polls = require('../services/polls');
```

In the `/home` handler, add `polls.homeSummary(req.event.id, req.participant.id)` to the `Promise.all` list and pass it to the view as `pollSummary`.

Add before the `/logout` route:

```js
router.get('/polls', requireParticipant, async (req, res) => {
  res.render('participant/polls', { title: '투표', list: await polls.listForParticipant(req.event.id, req.participant.id) });
});

async function renderPoll(req, res, { error = null, status = 200, selected = null } = {}) {
  const data = await polls.getForParticipant(req.event.id, req.params.id, req.participant.id);
  if (!data) return notFound(res);
  res.status(status).render('participant/poll', { title: data.poll.title, ...data, selected: selected || data.mine, error });
}

router.get('/polls/:id', requireParticipant, (req, res) => renderPoll(req, res));

router.post('/polls/:id/vote', requireParticipant, async (req, res) => {
  try {
    const ok = await polls.vote(req.event.id, req.params.id, req.participant.id, req.body);
    if (!ok) return notFound(res);
    res.redirect(303, `${res.locals.base}/polls/${req.params.id}`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderPoll(req, res, { error: err.message, status: 400, selected: polls.selectionFromInput(req.body) });
  }
});
```

- [ ] **Step 5: Add the home card**

In `src/views/participant/home.ejs`, insert directly after the `💌 내 마니또` `</section>`:

```ejs
<section class="card stack">
  <h2>🗳️ 투표</h2>
  <% if (!pollSummary.total) { %>
  <p class="muted">아직 투표가 없어요.</p>
  <% } else { %>
  <p>진행 중 <%= pollSummary.open %>개<% if (pollSummary.pending) { %> · <strong>투표할 게 <%= pollSummary.pending %>개 있어요</strong><% } %></p>
  <a class="btn btn-block<%= pollSummary.pending ? ' btn-primary' : '' %>" href="<%= base %>/polls">투표 보기</a>
  <% } %>
</section>
```

- [ ] **Step 6: Create the views**

`src/views/partials/poll-results.ejs`:

```ejs
<section class="card stack">
  <h2>결과</h2>
  <p class="hint"><%= results.voterCount %>명 투표<%= poll.anonymous ? ' · 익명' : '' %></p>
  <% if (results.voterCount === 0) { %><p class="muted">투표한 사람이 없어요.</p><% } %>
  <ul class="poll-results">
    <% results.options.forEach((o) => { %>
    <li<%- o.top ? ' class="top"' : '' %>>
      <div class="poll-result-head"><span><%= o.top ? '🏆 ' : '' %><%= o.label %></span><span class="tnum"><%= o.count %>표 · <%= o.percent %>%</span></div>
      <div class="poll-bar"><span style="width: <%= o.percent %>%"></span></div>
      <% if (o.names.length) { %><p class="hint"><%= o.names.join(', ') %></p><% } %>
    </li>
    <% }) %>
  </ul>
  <% if (results.others.length) { %>
  <h3>기타 (<%= results.otherCount %>)</h3>
  <ul class="list">
    <% results.others.forEach((g) => { %>
    <li><%= g.text %><% if (g.count > 1) { %> <span class="muted">×<%= g.count %></span><% } %><% if (g.names.length) { %> <span class="hint">— <%= g.names.join(', ') %></span><% } %></li>
    <% }) %>
  </ul>
  <% } %>
</section>
```

`src/views/participant/polls.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title">🗳️ 투표</h1>
<section class="card">
  <% if (!list.length) { %><p class="muted">아직 투표가 없어요.</p><% } %>
  <ul class="list">
    <% list.forEach((p) => { %>
    <li class="row" style="justify-content: space-between">
      <a href="<%= base %>/polls/<%= p.id %>"><span class="badge"><%= pollStatusLabel(p.status) %></span><%= p.title %></a>
      <% if (p.status === 'open') { %><span class="hint"><%= p.voted ? '투표함' : '안 함' %></span><% } %>
    </li>
    <% }) %>
  </ul>
</section>
<p><a class="btn btn-small" href="<%= base %>/home">홈으로</a></p>
```

`src/views/participant/poll.ejs`:

```ejs
<%- include('../partials/topbar') %>
<h1 class="title"><%= poll.title %></h1>
<%- include('../partials/alert') %>
<p class="row"><span class="badge"><%= pollStatusLabel(poll.status) %></span><span class="hint"><%= poll.anonymous ? '익명 투표예요' : '이름이 공개되는 투표예요' %><% if (poll.max_choices > 1) { %> · 최대 <%= poll.max_choices %>개<% } %></span></p>
<% if (poll.status === 'open') { %>
<% const type = poll.max_choices > 1 ? 'checkbox' : 'radio'; %>
<form method="post" action="<%= base %>/polls/<%= poll.id %>/vote" class="card stack">
  <% options.forEach((o) => { %>
  <label class="check poll-option"><input type="<%= type %>" name="option" value="<%= o.id %>"<%- selected.optionIds.includes(o.id) ? ' checked' : '' %>> <%= o.label %></label>
  <% }) %>
  <% if (poll.allow_other) { %>
  <label class="check poll-option"><input type="<%= type %>" name="option" value="other"<%- selected.other !== null ? ' checked' : '' %>> 기타</label>
  <label>기타 내용<input name="other" maxlength="50" value="<%= selected.other || '' %>"></label>
  <% } %>
  <button class="btn btn-primary btn-block"><%= mine.voted ? '다시 투표' : '투표하기' %></button>
  <% if (mine.voted) { %><p class="hint">마감 전까지 다시 고를 수 있어요.</p><% } %>
</form>
<% } else { %>
<% if (poll.status === 'closed') { %><p class="card muted">마감됐어요. 결과 공개를 기다려 주세요.</p><% } %>
<% if (results) { %><%- include('../partials/poll-results', { poll, results }) %><% } %>
<section class="card">
  <h2>내 선택</h2>
  <% if (!mine.voted) { %>
  <p class="muted">투표하지 않았어요.</p>
  <% } else { %>
  <ul class="list">
    <% options.filter((o) => mine.optionIds.includes(o.id)).forEach((o) => { %><li><%= o.label %></li><% }) %>
    <% if (mine.other !== null) { %><li>기타: <%= mine.other %></li><% } %>
  </ul>
  <% } %>
</section>
<% } %>
<p><a class="btn btn-small" href="<%= base %>/polls">목록으로</a></p>
```

- [ ] **Step 7: Add the styles**

Append to `src/public/css/app.css`, directly above the manito block (`/* 마니또 */`):

```css
/* 투표 */
input[type=radio] { width: 22px; height: 22px; min-height: 22px; accent-color: var(--orange); }
.poll-option { font-size: 16px; }
.poll-results { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.poll-result-head { display: flex; justify-content: space-between; gap: 8px; }
.poll-bar { height: 12px; margin-top: 6px; overflow: hidden; background: #F2E8DD; border-radius: 999px; }
.poll-bar span { display: block; height: 100%; background: var(--sky); border-radius: inherit; }
.poll-results .top .poll-result-head { font-weight: 700; }
.poll-results .top .poll-bar span { background: var(--orange); }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/participant-polls.routes.test.js tests/format.test.js tests/participant.routes.test.js tests/participant-manito.routes.test.js`
Expected: PASS

- [ ] **Step 9: Run the full suite, then commit**

Run: `npm test` — Expected: PASS

```bash
git add src/services/format.js src/routes/participant.js src/views/participant/home.ejs src/views/participant/polls.ejs src/views/participant/poll.ejs src/views/partials/poll-results.ejs src/public/css/app.css tests/participant-polls.routes.test.js tests/format.test.js
git commit -m "feat: 참가자 투표 화면과 결과

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 생성자 투표 관리

**Files:**
- Modify: `src/routes/creator.js`
- Create: `src/views/creator/polls.ejs`, `src/views/creator/poll.ejs`, `src/views/partials/poll-form.ejs`
- Modify: `src/views/partials/creator-nav.ejs`
- Test: `tests/creator-polls.routes.test.js`

**Interfaces:**
- Consumes: Task 2 `polls.createPoll`, `updatePoll`, `deletePoll`, `setStatus`, `getForCreator`, `formValues`, `listWithCounts`, `vote`; Task 3 `partials/poll-results.ejs`, `pollStatusLabel`; `manage(res, path)` helper and `requireCreator` (already applied to all routes below it in creator.js)
- Produces: `GET/POST /e/:slug/manage/polls`, `GET /e/:slug/manage/polls/:id`, `POST /e/:slug/manage/polls/:id/edit|status|delete`

- [ ] **Step 1: Write the failing test**

`tests/creator-polls.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/services/polls');

test.beforeEach(H.resetDb);

const FORM = { title: '점심 메뉴', options: '짜장면\n짬뽕\n볶음밥', maxChoices: '1', anonymous: '1' };

async function setup() {
  const { event } = await H.makeEvent();
  const a = await H.addParticipant(event.id, '가람');
  await H.addParticipant(event.id, '나래', { attendance: 'absent' });
  const creator = await H.creatorAgent(event);
  return { event, a, creator, manage: `/e/${event.slug}/manage` };
}
const firstOption = async (pollId) => (await H.db.query(
  'SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order LIMIT 1', [pollId],
)).rows[0].id;
const pollRow = async (id) => (await H.db.query('SELECT * FROM polls WHERE id = $1', [id])).rows[0];

test('일반 참가자는 투표 관리에 접근할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const poll = await polls.createPoll(event.id, FORM);
  const agent = await H.joinAgent(event, { name: '가람', pin: '1234' });
  const manage = `/e/${event.slug}/manage`;
  for (const [method, path] of [['get', '/polls'], ['post', '/polls'], ['get', `/polls/${poll.id}`],
    ['post', `/polls/${poll.id}/status`], ['post', `/polls/${poll.id}/delete`], ['post', `/polls/${poll.id}/edit`]]) {
    const url = `${manage}${path}`;
    const req = method === 'get' ? agent.get(url) : agent.post(url).type('form').send({ ...FORM, status: 'closed', confirm: '삭제' });
    const res = await req.expect(302);
    assert.equal(res.headers.location, `${manage}/unlock`);
  }
  assert.equal((await pollRow(poll.id)).status, 'open');
});

test('만들기: 성공하면 상세로, 실패하면 400과 입력 유지', async () => {
  const { creator, manage } = await setup();
  let res = await creator.get(`${manage}/polls`).expect(200);
  assert.match(res.text, /아직 투표가 없습니다/);
  assert.match(res.text, new RegExp(`href="${manage}/polls" aria-current="page"`));
  res = await creator.post(`${manage}/polls`).type('form').send({ ...FORM, options: '하나만' }).expect(400);
  assert.match(res.text, /항목은 2~20개/);
  assert.match(res.text, /점심 메뉴/);
  res = await creator.post(`${manage}/polls`).type('form').send(FORM).expect(302);
  const { rows } = await H.db.query('SELECT id FROM polls');
  assert.equal(res.headers.location, `${manage}/polls/${rows[0].id}`);
  res = await creator.get(`${manage}/polls`).expect(200);
  assert.match(res.text, /점심 메뉴/);
  assert.match(res.text, /0\/3명 투표/);
});

test('상세: 공개 전에는 인원과 안 한 사람만, 득표는 없다', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  const res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, new RegExp(`href="${manage}/polls" aria-current="page"`));
  assert.match(res.text, /<strong class="tnum">1\/3<\/strong>투표/);
  assert.match(res.text, /아직 안 한 사람 \(2명\)/);
  assert.match(res.text, /나래 <span class="muted">결석<\/span>/);
  assert.doesNotMatch(res.text, /poll-results/);
  assert.doesNotMatch(res.text, /\d+표 ·/);
});

test('상태 전환: 마감 → 다시 열기 → 마감 → 결과 공개, 잘못된 전환은 400', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  let res = await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'revealed' }).expect(400);
  assert.match(res.text, /결과 공개는 마감한 뒤에/);
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'closed' }).expect(302);
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /결과 공개/);
  assert.match(res.text, /다시 열기/);
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'open' }).expect(302);
  assert.equal((await pollRow(poll.id)).status, 'open');
  await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'closed' }).expect(302);
  res = await creator.post(`${manage}/polls/${poll.id}/status`).type('form').send({ status: 'revealed' }).expect(302);
  assert.equal(res.headers.location, `${manage}/polls/${poll.id}`);
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, /poll-results/);
  assert.match(res.text, /1표 · 100%/);
  assert.doesNotMatch(res.text, /아직 안 한 사람/);
});

test('수정: 투표자 0명이면 폼이 있고 저장되며, 투표가 생기면 폼이 사라지고 400', async () => {
  const { event, a, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  let res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.match(res.text, new RegExp(`action="${manage}/polls/${poll.id}/edit"`));
  await creator.post(`${manage}/polls/${poll.id}/edit`).type('form').send({ ...FORM, title: '저녁 메뉴' }).expect(302);
  assert.equal((await pollRow(poll.id)).title, '저녁 메뉴');
  await polls.vote(event.id, poll.id, a.id, { option: await firstOption(poll.id) });
  res = await creator.get(`${manage}/polls/${poll.id}`).expect(200);
  assert.doesNotMatch(res.text, new RegExp(`action="${manage}/polls/${poll.id}/edit"`));
  res = await creator.post(`${manage}/polls/${poll.id}/edit`).type('form').send(FORM).expect(400);
  assert.match(res.text, /이미 투표한 사람이 있어 수정할 수 없습니다/);
});

test('삭제: 확인 문구가 틀리면 400, 맞으면 목록으로', async () => {
  const { event, creator, manage } = await setup();
  const poll = await polls.createPoll(event.id, FORM);
  let res = await creator.post(`${manage}/polls/${poll.id}/delete`).type('form').send({ confirm: '지워' }).expect(400);
  assert.match(res.text, /확인 문구 "삭제"/);
  res = await creator.post(`${manage}/polls/${poll.id}/delete`).type('form').send({ confirm: '삭제' }).expect(302);
  assert.equal(res.headers.location, `${manage}/polls`);
  assert.equal(await pollRow(poll.id), undefined);
});

test('다른 운동회 투표와 잘못된 id는 404', async () => {
  const { creator, manage } = await setup();
  const { event: other } = await H.makeEvent();
  const foreign = await polls.createPoll(other.id, FORM);
  await creator.get(`${manage}/polls/${foreign.id}`).expect(404);
  await creator.get(`${manage}/polls/abc`).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/status`).type('form').send({ status: 'closed' }).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/edit`).type('form').send(FORM).expect(404);
  await creator.post(`${manage}/polls/${foreign.id}/delete`).type('form').send({ confirm: '삭제' }).expect(404);
  assert.equal((await pollRow(foreign.id)).status, 'open');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-polls.routes.test.js`
Expected: FAIL (404 on `/manage/polls`)

- [ ] **Step 3: Add the routes in `src/routes/creator.js`**

Add the require below `const manito = require('../services/manito');`:

```js
const polls = require('../services/polls');
```

Append before `module.exports = router;`:

```js
async function renderPolls(req, res, { error = null, status = 200, values = {} } = {}) {
  const list = await polls.listWithCounts(req.event.id);
  res.status(status).render('creator/polls', { title: '투표 관리', list, error, values });
}

router.get('/polls', (req, res) => renderPolls(req, res));

router.post('/polls', async (req, res) => {
  try {
    const poll = await polls.createPoll(req.event.id, req.body);
    res.redirect(manage(res, `/polls/${poll.id}`));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderPolls(req, res, { error: err.message, status: 400, values: req.body });
  }
});

async function renderPoll(req, res, { error = null, status = 200, values = null } = {}) {
  const data = await polls.getForCreator(req.event.id, req.params.id);
  if (!data) return notFound(res);
  res.status(status).render('creator/poll', {
    title: data.poll.title, ...data, values: values || polls.formValues(data.poll, data.options), error,
  });
}

// 투표 상세의 POST는 모두 같은 방식으로 처리한다. 결과가 null·false면 없는 투표다
async function pollAction(req, res, action, { values = null, done = null } = {}) {
  try {
    const result = await action();
    if (result === null || result === false) return notFound(res);
    res.redirect(manage(res, done || `/polls/${req.params.id}`));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderPoll(req, res, { error: err.message, status: 400, values });
  }
}

router.get('/polls/:id', (req, res) => renderPoll(req, res));
router.post('/polls/:id/edit', (req, res) => pollAction(req, res,
  () => polls.updatePoll(req.event.id, req.params.id, req.body), { values: req.body }));
router.post('/polls/:id/status', (req, res) => pollAction(req, res,
  () => polls.setStatus(req.event.id, req.params.id, req.body.status)));
router.post('/polls/:id/delete', (req, res) => pollAction(req, res,
  () => polls.deletePoll(req.event.id, req.params.id, req.body.confirm), { done: '/polls' }));
```

Note: when a validation error happens for a poll that belongs to another event (or a malformed id), `renderPoll` returns 404 because `getForCreator` returns `null`. `updatePoll`/`setStatus` validate input before looking up the poll, so a foreign poll with valid input returns `null` → 404, which the test relies on. `deletePoll` checks the confirm text first; the foreign-poll test sends the correct text.

- [ ] **Step 4: Create the views**

`src/views/partials/poll-form.ejs`:

```ejs
<label>제목<input name="title" maxlength="50" required value="<%= values.title || '' %>"></label>
<label>항목 (한 줄에 하나, 2~20개)<textarea name="options" rows="5" required><%= values.options || '' %></textarea></label>
<label>최대 선택 수<input name="maxChoices" type="number" min="1" max="20" inputmode="numeric" value="<%= values.maxChoices || 1 %>" style="width: 7em"></label>
<div class="row">
  <label class="check"><input type="radio" name="anonymous" value="1"<%- values.anonymous === '0' ? '' : ' checked' %>> 익명</label>
  <label class="check"><input type="radio" name="anonymous" value="0"<%- values.anonymous === '0' ? ' checked' : '' %>> 이름 공개</label>
</div>
<label class="check"><input type="checkbox" name="allowOther"<%- values.allowOther ? ' checked' : '' %>> 기타 직접 입력 허용</label>
```

`src/views/creator/polls.ejs`:

```ejs
<h1 class="title">투표 관리</h1>
<%- include('../partials/alert') %>
<section class="card">
  <h2>투표 목록</h2>
  <% if (!list.length) { %><p class="muted">아직 투표가 없습니다.</p><% } %>
  <ul class="list">
    <% list.forEach((p) => { %>
    <li class="row" style="justify-content: space-between">
      <a href="<%= base %>/manage/polls/<%= p.id %>"><span class="badge"><%= pollStatusLabel(p.status) %></span><%= p.title %></a>
      <span class="hint tnum"><%= p.voter_count %>/<%= p.participant_count %>명 투표</span>
    </li>
    <% }) %>
  </ul>
</section>
<form method="post" action="<%= base %>/manage/polls" class="card stack">
  <h2>새 투표</h2>
  <%- include('../partials/poll-form', { values }) %>
  <button class="btn btn-primary">만들기</button>
  <p class="hint">만들면 바로 진행 중이 됩니다. 결과는 마감한 뒤 "결과 공개"를 눌러야 모두에게 보입니다.</p>
</form>
```

`src/views/creator/poll.ejs`:

```ejs
<h1 class="title"><%= poll.title %></h1>
<%- include('../partials/alert') %>
<section class="stats">
  <div><strong><%= pollStatusLabel(poll.status) %></strong>상태</div>
  <div><strong class="tnum"><%= voterCount %>/<%= participantCount %></strong>투표</div>
  <div><strong><%= poll.anonymous ? '익명' : '이름 공개' %></strong>방식</div>
</section>
<p class="hint">항목 <%= options.length %>개 · 최대 <%= poll.max_choices %>개 선택<%= poll.allow_other ? ' · 기타 입력 허용' : '' %></p>
<section class="card stack">
  <h2>상태 바꾸기</h2>
  <% if (poll.status === 'open') { %>
  <form method="post" action="<%= base %>/manage/polls/<%= poll.id %>/status"><input type="hidden" name="status" value="closed"><button class="btn btn-primary">마감</button></form>
  <% } else if (poll.status === 'closed') { %>
  <div class="row">
    <form method="post" action="<%= base %>/manage/polls/<%= poll.id %>/status"><input type="hidden" name="status" value="revealed"><button class="btn btn-primary">결과 공개</button></form>
    <form method="post" action="<%= base %>/manage/polls/<%= poll.id %>/status"><input type="hidden" name="status" value="open"><button class="btn">다시 열기</button></form>
  </div>
  <p class="hint">결과를 공개하면 모두에게 보이고 되돌릴 수 없습니다.</p>
  <% } else { %>
  <p>결과가 공개되었습니다.</p>
  <% } %>
</section>
<% if (results) { %>
<%- include('../partials/poll-results', { poll, results }) %>
<% } else { %>
<section class="card stack">
  <h2>아직 안 한 사람 (<%= nonVoters.length %>명)</h2>
  <p class="hint">득표는 결과를 공개할 때 모두와 함께 확인합니다.</p>
  <% if (!nonVoters.length) { %><p class="muted">모두 투표했어요.</p><% } %>
  <ul class="list">
    <% nonVoters.forEach((p) => { %><li><%= p.name %><% if (p.attendance === 'absent') { %> <span class="muted">결석</span><% } %></li><% }) %>
  </ul>
</section>
<% } %>
<section class="card">
  <h2>항목</h2>
  <ol><% options.forEach((o) => { %><li><%= o.label %></li><% }) %></ol>
</section>
<% if (voterCount === 0 && poll.status !== 'revealed') { %>
<form method="post" action="<%= base %>/manage/polls/<%= poll.id %>/edit" class="card stack">
  <h2>수정</h2>
  <%- include('../partials/poll-form', { values }) %>
  <button class="btn">저장</button>
  <p class="hint">한 명이라도 투표하면 더 이상 수정할 수 없습니다.</p>
</form>
<% } %>
<section class="card stack">
  <h2>삭제</h2>
  <p class="hint">투표와 응답이 모두 지워집니다. 계속하려면 "삭제"라고 입력하세요.</p>
  <form class="stack" method="post" action="<%= base %>/manage/polls/<%= poll.id %>/delete">
    <label>확인 문구<input name="confirm" autocomplete="off"></label>
    <button class="btn btn-danger">삭제</button>
  </form>
</section>
<p><a class="btn btn-small" href="<%= base %>/manage/polls">목록으로</a></p>
```

In `src/views/partials/creator-nav.ejs`, add `['/polls', '투표']` right after `['/manito', '마니또']` in `navItems`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/creator-polls.routes.test.js tests/creator.routes.test.js tests/manage-layout.routes.test.js tests/creator-manito.routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — Expected: PASS

```bash
git add src/routes/creator.js src/views/creator/polls.ejs src/views/creator/poll.ejs src/views/partials/poll-form.ejs src/views/partials/creator-nav.ejs tests/creator-polls.routes.test.js
git commit -m "feat: 생성자 투표 관리 화면

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 관리자 투표 칸

**Files:**
- Modify: `src/routes/admin.js` (`renderDetail`)
- Modify: `src/views/admin/event.ejs`
- Test: `tests/admin-polls.routes.test.js`

**Interfaces:**
- Consumes: Task 2 `polls.listWithCounts(eventId)`, `createPoll`, `vote`, `setStatus`; Task 3 `pollStatusLabel`
- Produces: 관리자 상세의 `<section class="card stack" id="polls">`

- [ ] **Step 1: Write the failing test**

`tests/admin-polls.routes.test.js`:

```js
const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const polls = require('../src/services/polls');

test.beforeEach(H.resetDb);

const sectionOf = (html, id) => {
  const m = html.match(new RegExp(`<section class="card stack" id="${id}">([\\s\\S]*?)</section>`));
  assert.ok(m, `${id} 칸이 없다`);
  return m[1];
};

test('관리자 상세: 투표 제목·상태·인원만, 응답과 이름은 없다', async () => {
  const { event } = await H.makeEvent();
  const a = await H.addParticipant(event.id, '가람');
  const admin = await H.adminAgent();
  let section = sectionOf((await admin.get(`/admin/events/${event.id}`).expect(200)).text, 'polls');
  assert.match(section, /투표가 없습니다/);
  const poll = await polls.createPoll(event.id, { title: '점심 메뉴', options: '짜장면\n짬뽕', anonymous: '0', allowOther: 'on', maxChoices: '2' });
  const [first] = (await H.db.query('SELECT id::text AS id FROM poll_options WHERE poll_id = $1 ORDER BY sort_order', [poll.id])).rows;
  await polls.vote(event.id, poll.id, a.id, { option: [first.id, 'other'], other: '탕수육' });
  await polls.setStatus(event.id, poll.id, 'closed');
  await polls.setStatus(event.id, poll.id, 'revealed');
  section = sectionOf((await admin.get(`/admin/events/${event.id}`).expect(200)).text, 'polls');
  assert.match(section, /점심 메뉴/);
  assert.match(section, /결과 공개/);
  assert.match(section, /1\/2명/);
  for (const hidden of ['짜장면', '짬뽕', '탕수육', '가람']) assert.ok(!section.includes(hidden), `${hidden}이 투표 칸에 노출됨`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/admin-polls.routes.test.js`
Expected: FAIL with `polls 칸이 없다`

- [ ] **Step 3: Update `src/routes/admin.js`**

Add the require below `const manito = require('../services/manito');`:

```js
const polls = require('../services/polls');
```

In `renderDetail`, add `polls.listWithCounts(req.event.id)` to the `Promise.all` (destructure as `pollList`) and pass `pollList` to the view.

- [ ] **Step 4: Add the section to `src/views/admin/event.ejs`**

Insert directly after the `참가 마감` section (`id="join"`):

```ejs
<section class="card stack" id="polls">
  <h2>투표</h2>
  <% if (!pollList.length) { %>
  <p class="muted">투표가 없습니다.</p>
  <% } else { %>
  <ul class="list">
    <% pollList.forEach((p) => { %>
    <li class="row" style="justify-content: space-between"><span><span class="badge"><%= pollStatusLabel(p.status) %></span><%= p.title %></span><span class="hint tnum"><%= p.voter_count %>/<%= p.participant_count %>명</span></li>
    <% }) %>
  </ul>
  <% } %>
  <p class="hint">응답 내용과 투표한 사람은 관리자 화면에 보이지 않습니다.</p>
</section>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NODE_ENV=test node --test --test-concurrency=1 tests/admin-polls.routes.test.js tests/admin.routes.test.js tests/admin-manito.routes.test.js`
Expected: PASS

- [ ] **Step 6: Run the full suite, then commit**

Run: `npm test` — Expected: PASS

```bash
git add src/routes/admin.js src/views/admin/event.ejs tests/admin-polls.routes.test.js
git commit -m "feat: 관리자 상세에 투표 칸

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
