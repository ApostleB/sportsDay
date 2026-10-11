const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const events = require('../src/services/events');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

test('운동회를 만들면 기본 제목, slug, 인증코드, 생성자 참가자가 생긴다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(event.title, '제 3회 명량운동회');
  assert.match(event.slug, /^[a-hj-km-np-z2-9]{8}$/);
  assert.match(event.auth_code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(event.event_date, '2026-10-10');
  assert.equal(event.meet_info, '이촌동 한강맨션 앞');
  assert.equal(event.status, 'ready');
  assert.notEqual(event.creator_pin_hash, '123456');
  assert.equal(participant.name, '생성자');
  assert.equal(participant.event_id, event.id);
});

test('제목을 입력하면 그대로 쓴다', async () => {
  const { event } = await H.makeEvent({ title: '  가을 운동회 ' });
  assert.equal(event.title, '가을 운동회');
});

test('생성자 PIN을 검증한다', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await events.verifyCreatorPin(event, '123456'), true);
  assert.equal(await events.verifyCreatorPin(event, '000000'), false);
  assert.equal(await events.verifyCreatorPin(event, undefined), false);
});

test('생성 입력을 검증한다', async () => {
  const cases = [
    [{ creatorPin: '12345', creatorPinConfirm: '12345' }, /숫자 6자리/],
    [{ creatorPinConfirm: '654321' }, /확인이 일치/],
    [{ roundNo: '0' }, /회차/],
    [{ roundNo: 'abc' }, /회차/],
    [{ eventDate: '2026-13-01' }, /날짜/],
    [{ creatorName: '   ' }, /이름/],
    [{ creatorPersonalPin: '12' }, /개인 PIN/],
    [{ title: '가'.repeat(51) }, /제목/],
  ];
  for (const [patch, message] of cases) {
    await assert.rejects(H.makeEvent(patch), (e) => e instanceof ValidationError && message.test(e.message));
  }
});

test('updateEvent는 인증코드를 정규화하고 값을 검증한다', async () => {
  const { event } = await H.makeEvent();
  const updated = await events.updateEvent(event.id, {
    roundNo: '3', title: '', eventDate: '', meetInfo: '', authCode: ' abcd12 ', status: 'live',
  });
  assert.equal(updated.auth_code, 'ABCD12');
  assert.equal(updated.title, '제 3회 명량운동회');
  assert.equal(updated.event_date, null);
  assert.equal(updated.status, 'live');
  await assert.rejects(events.updateEvent(event.id, { roundNo: '3', authCode: 'ABCD12', status: 'done' }), ValidationError);
  await assert.rejects(events.updateEvent(event.id, { roundNo: '3', authCode: 'a!', status: 'live' }), ValidationError);
});

test('listEvents는 최신순이며 참가자 수를 포함한다', async () => {
  const { event: first } = await H.makeEvent();
  const { event: second } = await H.makeEvent({ roundNo: '4' });
  await H.db.query("INSERT INTO participants (event_id, name, pin_hash) VALUES ($1, '추가', 'x')", [first.id]);
  const list = await events.listEvents();
  assert.deepEqual(list.map((e) => e.id), [second.id, first.id]);
  assert.equal(list[1].participant_count, 2);
});

test('setCreatorPin은 6자리만 받는다', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await events.setCreatorPin(event.id, '999999'), true);
  const reloaded = await events.getEventById(event.id);
  assert.equal(await events.verifyCreatorPin(reloaded, '999999'), true);
  await assert.rejects(events.setCreatorPin(event.id, '99'), ValidationError);
});

test('deleteEvent는 하위 데이터를 지우고 시간표 파일명을 돌려준다', async () => {
  const { event } = await H.makeEvent();
  await H.db.query("INSERT INTO schedule_images (event_id, file_name) VALUES ($1, 'x.png')", [event.id]);
  assert.deepEqual(await events.deleteEvent(event.id), ['x.png']);
  assert.equal(await events.getEventById(event.id), null);
  const { rows } = await H.db.query('SELECT count(*)::int AS n FROM participants');
  assert.equal(rows[0].n, 0);
  assert.equal(await events.deleteEvent(event.id), null);
});

test('잘못된 id와 slug는 null', async () => {
  assert.equal(await events.getEventById('abc'), null);
  assert.equal(await events.getEventBySlug('nothere1'), null);
});
