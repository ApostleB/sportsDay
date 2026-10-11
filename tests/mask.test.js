const test = require('node:test');
const assert = require('node:assert/strict');
const { maskName } = require('../src/services/mask');

test('이름 마스킹 규칙', () => {
  assert.equal(maskName('홍길동'), '홍*동');
  assert.equal(maskName('남궁민원'), '남**원');
  assert.equal(maskName('홍길'), '홍*');
  assert.equal(maskName('김'), '*');
  assert.equal(maskName(''), '');
  assert.equal(maskName(null), '');
});
