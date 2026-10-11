const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');

test.beforeEach(H.resetDb);

test('공지를 등록하면 참가자 홈에 고정 표시와 함께 보인다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  await creator.post(`/e/${event.slug}/manage/announcements`).type('form')
    .send({ title: '집합 시간 변경', body: '7시 50분까지', pinned: 'on' }).expect(302);
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, /집합 시간 변경/);
  assert.match(home.text, /고정/);
});

test('제목이 비면 400과 입력한 내용 유지', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const res = await creator.post(`/e/${event.slug}/manage/announcements`).type('form')
    .send({ title: ' ', body: '남겨둘 내용' }).expect(400);
  assert.match(res.text, /제목은 1~100자/);
  assert.match(res.text, /남겨둘 내용/);
});

test('공지를 수정하고 삭제한다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const a = await announcements.create(event.id, { title: '원래 제목', body: '' });
  await creator.get(`/e/${event.slug}/manage/announcements/${a.id}/edit`).expect(200);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form')
    .send({ title: '바뀐 제목', body: '본문' }).expect(302);
  assert.equal((await announcements.get(event.id, a.id)).title, '바뀐 제목');
  const bad = await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form')
    .send({ title: '', body: '' }).expect(400);
  assert.match(bad.text, /제목은 1~100자/);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}/delete`).expect(302);
  assert.equal(await announcements.get(event.id, a.id), null);
});

test('다른 운동회의 공지는 수정 화면과 수정 요청이 404', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(other.id, { title: '남의 공지', body: '' });
  const creator = await H.creatorAgent(event);
  await creator.get(`/e/${event.slug}/manage/announcements/${a.id}/edit`).expect(404);
  await creator.post(`/e/${event.slug}/manage/announcements/${a.id}`).type('form').send({ title: '탈취', body: '' }).expect(404);
  assert.equal((await announcements.get(other.id, a.id)).title, '남의 공지');
});

test('일반 참가자는 공지를 등록할 수 없다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await member.post(`/e/${event.slug}/manage/announcements`).type('form').send({ title: '몰래', body: '' }).expect(302);
  assert.deepEqual(await announcements.list(event.id), []);
});
