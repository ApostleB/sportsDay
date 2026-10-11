const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

test('홈에 일시, 집합 안내, 고정 우선 공지, 시간표 이미지가 보인다', async () => {
  const { event } = await H.makeEvent();
  await announcements.create(event.id, { title: '일반 공지', body: 'a' });
  await announcements.create(event.id, { title: '고정 공지', body: 'b', pinned: true });
  await schedules.add(event.id, { fileName: 'abc.png', caption: '제3회 시간표' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/home`).expect(200);
  assert.match(res.text, /2026년 10월 10일 \(토\)/);
  assert.match(res.text, /이촌동 한강맨션 앞/);
  assert.ok(res.text.indexOf('고정 공지') < res.text.indexOf('일반 공지'));
  assert.match(res.text, /\/uploads\/abc\.png/);
  assert.match(res.text, /제3회 시간표/);
});

test('공지 내용은 HTML로 해석되지 않는다', async () => {
  const { event } = await H.makeEvent();
  const a = await announcements.create(event.id, { title: '<b>굵게</b>', body: '<script>alert(1)</script>' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const res = await agent.get(`/e/${event.slug}/announcements/${a.id}`).expect(200);
  assert.doesNotMatch(res.text, /<script>alert/);
  assert.match(res.text, /&lt;script&gt;/);
});

test('다른 운동회의 공지는 404', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(other.id, { title: '남의 공지', body: '' });
  const agent = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await agent.get(`/e/${event.slug}/announcements/${a.id}`).expect(404);
  await agent.get(`/e/${event.slug}/announcements/abc`).expect(404);
});
