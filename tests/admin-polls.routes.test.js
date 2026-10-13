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
