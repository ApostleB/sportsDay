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
  // 상단바의 내 이름은 제외하고 팀 목록만 본다
  const cut0 = board.text.indexOf('</header>');
  assert.ok(cut0 > 0);
  assert.doesNotMatch(board.text.slice(cut0), /철수/);
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
  const cut = board.text.indexOf('</header>');
  assert.ok(cut > 0);
  const cards = [...board.text.slice(cut).matchAll(/<section class="card team-card[^"]*">[\s\S]*?<\/section>/g)].map((m) => m[0]);
  const withMe = cards.filter((c) => c.includes('철수'));
  assert.equal(withMe.length, 1, '철수는 정확히 한 팀 카드에만 있어야 한다');
  assert.match(withMe[0], new RegExp(`<span class="badge team-[^"]*">[^<]*${expected}</span>`));
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
  assert.equal(form.text.split('결석으로 표시되어 있어요').length - 1, 1);
  const page = await agent.get(`${base}/draw`).expect(200);
  assert.doesNotMatch(page.text, /id="drawForm"/);
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
  const json = page.text.match(/<script type="application\/json" id="drawTeams">([\s\S]*?)<\/script>/)[1];
  assert.ok(!json.includes('</script>'));
  assert.ok(JSON.parse(json).some((t) => t.name === '</script><b>x'));
  assert.match(page.text, /&lt;\/script&gt;&lt;b&gt;x/);
  assert.doesNotMatch(page.text, /<b>x/);
});
