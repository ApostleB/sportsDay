const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const participants = require('../src/services/participants');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

const isVE = (pattern) => (e) => e instanceof ValidationError && pattern.test(e.message);

test('신규 입장 후 같은 이름과 PIN으로 재입장하면 같은 참가자다', async () => {
  const { event } = await H.makeEvent();
  const p = await participants.join(event, { name: '홍길동', pin: '1234', authCode: event.auth_code });
  const again = await participants.join(event, {
    name: '  홍길동 ', pin: '1234', authCode: ` ${event.auth_code.toLowerCase()} `,
  });
  assert.equal(again.id, p.id);
});

test('같은 이름에 다른 PIN이면 거부한다', async () => {
  const { event } = await H.makeEvent();
  await participants.join(event, { name: '홍길동', pin: '1234', authCode: event.auth_code });
  await assert.rejects(
    participants.join(event, { name: '홍길동', pin: '0000', authCode: event.auth_code }),
    isVE(/이미 사용 중인 이름이거나 PIN이 틀렸습니다/),
  );
});

test('인증코드가 틀리면 거부한다', async () => {
  const { event } = await H.makeEvent();
  await assert.rejects(participants.join(event, { name: '홍길동', pin: '1234', authCode: 'WRONG1' }), isVE(/인증코드/));
});

test('이름과 PIN 형식을 검증한다', async () => {
  const { event } = await H.makeEvent();
  const base = { pin: '1234', authCode: event.auth_code };
  await assert.rejects(participants.join(event, { ...base, name: ' ' }), isVE(/이름/));
  await assert.rejects(participants.join(event, { ...base, name: '가'.repeat(21) }), isVE(/이름/));
  await assert.rejects(participants.join(event, { name: '홍길동', pin: '12a4', authCode: event.auth_code }), isVE(/4자리/));
});

test('종료된 운동회는 신규 입장만 막는다', async () => {
  const { event } = await H.makeEvent();
  const closed = { ...event, status: 'closed' };
  const existing = await participants.join(closed, { name: '생성자', pin: '1111', authCode: event.auth_code });
  assert.equal(existing.name, '생성자');
  await assert.rejects(participants.join(closed, { name: '새사람', pin: '1234', authCode: event.auth_code }), isVE(/종료/));
});

test('출석 상태를 바꾸고 잘못된 값은 거부한다', async () => {
  const { event, participant } = await H.makeEvent();
  const absent = await participants.setAttendance(event.id, participant.id, 'absent');
  assert.equal(absent.attendance, 'absent');
  const present = await participants.setAttendance(event.id, participant.id, 'present');
  assert.equal(present.attendance, 'present');
  await assert.rejects(participants.setAttendance(event.id, participant.id, 'gone'), ValidationError);
  await assert.rejects(participants.setAttendance(event.id, participant.id, undefined), ValidationError);
});

test('다른 운동회의 참가자는 수정·삭제·PIN 재설정되지 않는다', async () => {
  const { event: e1 } = await H.makeEvent();
  const { participant: other } = await H.makeEvent({ roundNo: '4' });
  assert.equal(await participants.setAttendance(e1.id, other.id, 'absent'), null);
  assert.equal(await participants.deleteParticipant(e1.id, other.id), false);
  assert.equal(await participants.resetPin(e1.id, other.id, '9999'), false);
  assert.equal(await participants.getParticipant(e1.id, other.id), null);
});

test('PIN을 재설정하면 새 PIN으로 입장한다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(await participants.resetPin(event.id, participant.id, '9999'), true);
  const p = await participants.join(event, { name: '생성자', pin: '9999', authCode: event.auth_code });
  assert.equal(p.id, participant.id);
  await assert.rejects(participants.resetPin(event.id, participant.id, '99'), ValidationError);
});

test('참가자를 삭제한다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(await participants.deleteParticipant(event.id, participant.id), true);
  assert.deepEqual(await participants.listParticipants(event.id), []);
});

test('bigint 범위를 초과하는 id는 null/false', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await participants.getParticipant(event.id, '99999999999999999999'), null);
  assert.equal(await participants.setAttendance(event.id, '99999999999999999999', 'absent'), null);
  assert.equal(await participants.deleteParticipant(event.id, '99999999999999999999'), false);
  assert.equal(await participants.resetPin(event.id, '99999999999999999999', '9999'), false);
});

test('앞자리 0이 붙은 id는 거부한다', async () => {
  const { event, participant } = await H.makeEvent();
  assert.equal(await participants.getParticipant(event.id, '0' + participant.id), null);
  assert.equal(await participants.deleteParticipant(event.id, '0' + participant.id), false);
  assert.ok(await participants.getParticipant(event.id, participant.id));
});
