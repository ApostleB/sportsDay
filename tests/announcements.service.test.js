const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const announcements = require('../src/services/announcements');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

test('목록은 고정 공지가 먼저, 그다음 최신순이다', async () => {
  const { event } = await H.makeEvent();
  await announcements.create(event.id, { title: '첫 공지', body: '' });
  await announcements.create(event.id, { title: '고정', body: '', pinned: 'on' });
  await announcements.create(event.id, { title: '둘째 공지', body: '' });
  const list = await announcements.list(event.id);
  assert.deepEqual(list.map((a) => a.title), ['고정', '둘째 공지', '첫 공지']);
});

test('제목과 내용을 검증한다', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(announcements.create(event.id, { title: '  ', body: '' }), ValidationError);
  await assert.rejects(announcements.create(event.id, { title: '가'.repeat(101), body: '' }), ValidationError);
  await assert.rejects(announcements.create(event.id, { title: '제목', body: 'a'.repeat(5001) }), ValidationError);
});

test('수정과 삭제는 같은 운동회의 공지에만 적용된다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const a = await announcements.create(event.id, { title: '원래', body: '본문' });
  const updated = await announcements.update(event.id, a.id, { title: '바뀜', body: '새 본문' });
  assert.equal(updated.title, '바뀜');
  assert.equal(updated.pinned, false);
  assert.equal(await announcements.update(other.id, a.id, { title: 'x', body: '' }), null);
  assert.equal(await announcements.get(other.id, a.id), null);
  assert.equal(await announcements.remove(other.id, a.id), false);
  assert.equal(await announcements.remove(event.id, a.id), true);
  assert.equal(await announcements.get(event.id, a.id), null);
});

test('bigint 범위를 초과하는 id는 null/false', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await announcements.get(event.id, '99999999999999999999'), null);
  assert.equal(await announcements.update(event.id, '99999999999999999999', { title: 'x', body: '' }), null);
  assert.equal(await announcements.remove(event.id, '99999999999999999999'), false);
});
