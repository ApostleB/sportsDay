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
