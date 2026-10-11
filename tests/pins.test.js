require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPin, comparePin } = require('../src/services/pins');

test('PIN은 해시로 저장되고 비교할 수 있다', async () => {
  const hash = await hashPin('1234');
  assert.notEqual(hash, '1234');
  assert.equal(await comparePin('1234', hash), true);
  assert.equal(await comparePin('4321', hash), false);
});
