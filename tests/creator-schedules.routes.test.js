const H = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schedules = require('../src/services/schedules');

test.beforeEach(H.resetDb);

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const uploaded = (name) => path.join(process.env.UPLOAD_DIR, name);
const uploadCount = () => fs.readdirSync(process.env.UPLOAD_DIR).length;

test('이미지를 올리면 파일이 저장되고 참가자 홈에 보인다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  await creator.post(`/e/${event.slug}/manage/schedules`)
    .field('caption', '3회 시간표')
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(302);
  const [s] = await schedules.list(event.id);
  assert.match(s.file_name, /^[0-9a-f-]{36}\.png$/);
  assert.equal(s.caption, '3회 시간표');
  assert.equal(fs.existsSync(uploaded(s.file_name)), true);
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  const home = await member.get(`/e/${event.slug}/home`).expect(200);
  assert.match(home.text, new RegExp(s.file_name));
  await H.request(H.getApp()).get(`/uploads/${s.file_name}`).expect(200);
});

test('이미지가 아니면 400이고 파일이 남지 않는다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  const res = await creator.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
    .expect(400);
  assert.match(res.text, /jpg, png, webp, gif/);
  assert.deepEqual(await schedules.list(event.id), []);
  assert.equal(uploadCount(), before);
});

test('5MB를 넘으면 400이고 파일이 남지 않는다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  const res = await creator.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'big.png', contentType: 'image/png' })
    .expect(400);
  assert.match(res.text, /5MB/);
  assert.equal(uploadCount(), before);
});

test('파일 없이 올리면 400', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const res = await creator.post(`/e/${event.slug}/manage/schedules`).field('caption', '설명만').expect(400);
  assert.match(res.text, /이미지를 선택해 주세요/);
});

test('설명이 너무 길면 400이고 올린 파일은 지운다', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  const before = uploadCount();
  await creator.post(`/e/${event.slug}/manage/schedules`)
    .field('caption', '가'.repeat(101))
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(400);
  assert.equal(uploadCount(), before);
});

test('설명 수정, 순서 변경, 삭제', async () => {
  const { event } = await H.makeEvent();
  const creator = await H.creatorAgent(event);
  fs.writeFileSync(uploaded('route-a.png'), 'a');
  fs.writeFileSync(uploaded('route-b.png'), 'b');
  const a = await schedules.add(event.id, { fileName: 'route-a.png', caption: 'A' });
  const b = await schedules.add(event.id, { fileName: 'route-b.png', caption: 'B' });
  await creator.post(`/e/${event.slug}/manage/schedules/${a.id}`).type('form').send({ caption: '새 설명' }).expect(302);
  await creator.post(`/e/${event.slug}/manage/schedules/${b.id}/move`).type('form').send({ direction: 'up' }).expect(302);
  const list = await schedules.list(event.id);
  assert.deepEqual(list.map((s) => s.id), [b.id, a.id]);
  assert.equal(list[1].caption, '새 설명');
  await creator.post(`/e/${event.slug}/manage/schedules/${a.id}/delete`).expect(302);
  assert.equal(fs.existsSync(uploaded('route-a.png')), false);
  assert.deepEqual((await schedules.list(event.id)).map((s) => s.id), [b.id]);
});

test('일반 참가자는 시간표를 올릴 수 없다', async () => {
  const { event } = await H.makeEvent();
  const member = await H.joinAgent(event, { name: '참가자', pin: '2222' });
  await member.post(`/e/${event.slug}/manage/schedules`)
    .attach('image', PNG, { filename: 'poster.png', contentType: 'image/png' })
    .expect(302);
  assert.deepEqual(await schedules.list(event.id), []);
});
