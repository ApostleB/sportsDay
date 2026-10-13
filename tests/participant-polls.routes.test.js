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
