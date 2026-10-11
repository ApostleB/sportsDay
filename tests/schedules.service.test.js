const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedules = require('../src/services/schedules');
const { ValidationError } = require('../src/services/errors');

test.beforeEach(H.resetDb);

function touch(name) {
  const file = path.join(process.env.UPLOAD_DIR, name);
  fs.writeFileSync(file, 'x');
  return file;
}

test('추가한 순서대로 정렬되고 위아래로 옮길 수 있다', async () => {
  const { event } = await H.makeEvent();
  const a = await schedules.add(event.id, { fileName: 'a.png', caption: 'A' });
  const b = await schedules.add(event.id, { fileName: 'b.png', caption: 'B' });
  const c = await schedules.add(event.id, { fileName: 'c.png', caption: '' });
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, b.id, c.id]);
  assert.equal(await schedules.move(event.id, c.id, 'up'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, c.id, b.id]);
  assert.equal(await schedules.move(event.id, a.id, 'up'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [a.id, c.id, b.id]);
  assert.equal(await schedules.move(event.id, a.id, 'down'), true);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [c.id, a.id, b.id]);
});

test('설명을 수정하고 길이를 검증한다', async () => {
  const { event } = await H.makeEvent();
  const s = await schedules.add(event.id, { fileName: 'a.png', caption: '' });
  assert.equal(await schedules.updateCaption(event.id, s.id, ' 3회 시간표 '), true);
  assert.equal((await schedules.list(event.id))[0].caption, '3회 시간표');
  await assert.rejects(schedules.updateCaption(event.id, s.id, '가'.repeat(101)), ValidationError);
});

test('삭제하면 파일도 지워지고 다른 운동회의 시간표는 지울 수 없다', async () => {
  const { event } = await H.makeEvent();
  const { event: other } = await H.makeEvent({ roundNo: '4' });
  const file = touch('del-test.png');
  const s = await schedules.add(event.id, { fileName: 'del-test.png', caption: '' });
  assert.equal(await schedules.remove(other.id, s.id), false);
  assert.equal(fs.existsSync(file), true);
  assert.equal(await schedules.remove(event.id, s.id), true);
  assert.equal(fs.existsSync(file), false);
});

test('removeFile은 경로 조작 파일명을 무시한다', async () => {
  const escapePath = path.join(process.env.UPLOAD_DIR, '..', 'escape.png');
  fs.writeFileSync(escapePath, 'x');
  await schedules.removeFile('../escape.png');
  assert.equal(fs.existsSync(escapePath), true, 'escape.png should not be deleted');
  fs.unlinkSync(escapePath);
  await schedules.removeFile('missing-file.png');
});

test('bigint 범위를 초과하는 id는 false', async () => {
  const { event } = await H.makeEvent();
  assert.equal(await schedules.updateCaption(event.id, '99999999999999999999', 'x'), false);
  assert.equal(await schedules.move(event.id, '99999999999999999999', 'up'), false);
  assert.equal(await schedules.remove(event.id, '99999999999999999999'), false);
});

test('remove는 파일 삭제 실패를 처리하고 행은 여전히 삭제된다', async () => {
  const { event } = await H.makeEvent();
  const dirPath = path.join(process.env.UPLOAD_DIR, 'dir-as-file.png');
  fs.mkdirSync(dirPath);
  fs.writeFileSync(path.join(dirPath, 'nested.txt'), 'x');
  const s = await schedules.add(event.id, { fileName: 'dir-as-file.png', caption: '' });
  const originalError = console.error;
  let errorCalled = false;
  console.error = () => { errorCalled = true; };
  const result = await schedules.remove(event.id, s.id);
  console.error = originalError;
  assert.equal(result, true, 'remove should return true despite file deletion failure');
  assert.equal(await schedules.list(event.id).then((list) => list.length), 0, 'row should be deleted');
  assert.equal(errorCalled, true, 'console.error should have been called');
  fs.rmSync(dirPath, { recursive: true, force: true });
});
