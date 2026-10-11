const test = require('node:test');
const assert = require('node:assert/strict');
const codes = require('../src/services/codes');

test('slug는 혼동 문자를 뺀 소문자·숫자 8자다', () => {
  for (let i = 0; i < 200; i++) assert.match(codes.generateSlug(), /^[a-hj-km-np-z2-9]{8}$/);
});

test('인증코드는 혼동 문자를 뺀 대문자·숫자 6자다', () => {
  for (let i = 0; i < 200; i++) assert.match(codes.generateAuthCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('인증코드 정규화는 공백을 지우고 대문자로 바꾼다', () => {
  assert.equal(codes.normalizeAuthCode(' ab12cd '), 'AB12CD');
  assert.equal(codes.normalizeAuthCode(undefined), '');
});

test('PIN 형식 검사', () => {
  assert.equal(codes.isPin4('1234'), true);
  assert.equal(codes.isPin4('123'), false);
  assert.equal(codes.isPin4('12345'), false);
  assert.equal(codes.isPin4('12a4'), false);
  assert.equal(codes.isPin4(undefined), false);
  assert.equal(codes.isPin6('123456'), true);
  assert.equal(codes.isPin6('1234'), false);
});
