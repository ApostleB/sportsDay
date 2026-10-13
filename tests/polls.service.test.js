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
