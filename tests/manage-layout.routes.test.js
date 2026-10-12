const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

test.beforeEach(H.resetDb);

const PAGES = ['', '/event', '/participants', '/teams', '/groups', '/draw', '/announcements', '/schedules'];

test('생성자 관리 화면은 모두 넓은 폭과 관리 막대를 쓴다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  for (const path of PAGES) {
    const res = await agent.get(`/e/${event.slug}/manage${path}`).expect(200);
    assert.match(res.text, /<body class="wide area-manage">/, `${path || '/'} 폭`);
    assert.match(res.text, /class="manage-bar"/, `${path || '/'} 막대`);
    assert.match(res.text, /운동회 관리/);
    assert.match(res.text, new RegExp(`href="/e/${event.slug}/home">참가자 화면으로`));
  }
});

test('관리 메뉴는 관리 막대의 햄버거 메뉴 하나뿐이고 현재 메뉴가 강조된다', async () => {
  const { event } = await H.makeEvent();
  const agent = await H.creatorAgent(event);
  const teamsPage = await agent.get(`/e/${event.slug}/manage/teams`).expect(200);
  assert.match(teamsPage.text, /<details class="manage-menu">/);
  assert.match(teamsPage.text, /☰ 메뉴/);
  assert.equal((teamsPage.text.match(/aria-label="관리 메뉴"/g) || []).length, 1);
  assert.match(teamsPage.text, new RegExp(`<a href="/e/${event.slug}/manage/teams" aria-current="page">팀 설정</a>`));
  assert.equal((teamsPage.text.match(/aria-current="page"/g) || []).length, 1);
  const dash = await agent.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(dash.text, new RegExp(`<a href="/e/${event.slug}/manage" aria-current="page">대시보드</a>`));
  const admin = await H.adminAgent();
  const list = await admin.get('/admin').expect(200);
  assert.doesNotMatch(list.text, /manage-menu/);
});

test('참가자 화면의 나가기 버튼 문구는 로그아웃이다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, />로그아웃</);
  assert.doesNotMatch(home.text, /이 기기에서 나가기/);
});

test('참가자 화면과 PIN 확인 화면은 관리 화면이 아니다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, /<body class="">/);
  assert.doesNotMatch(home.text, /manage-bar/);
  const unlock = await member.get(`/e/${event.slug}/manage/unlock`).expect(200);
  assert.doesNotMatch(unlock.text, /manage-bar/);
});

test('플랫폼 관리자 화면도 관리 막대를 쓰고 로그인 화면은 쓰지 않는다', async () => {
  const login = await H.request(H.getApp()).get('/admin/login').expect(200);
  assert.doesNotMatch(login.text, /manage-bar/);
  const admin = await H.adminAgent();
  const list = await admin.get('/admin').expect(200);
  assert.match(list.text, /<body class="wide area-manage">/);
  assert.match(list.text, /플랫폼 관리자/);
  const { event } = await H.makeEvent();
  const detail = await admin.get(`/admin/events/${event.id}`).expect(200);
  assert.match(detail.text, /class="manage-bar"/);
  const manage = await admin.get(`/e/${event.slug}/manage`).expect(200);
  assert.match(manage.text, /href="\/admin">플랫폼 관리</);
  assert.doesNotMatch(manage.text, /참가자 화면으로/);
});
