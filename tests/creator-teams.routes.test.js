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
