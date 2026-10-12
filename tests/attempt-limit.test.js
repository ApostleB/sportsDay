const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttemptLimiter, MAX_KEYS } = require('../src/middleware/attempt-limit');

test('hit은 max번까지 허용하고 그 뒤로는 올리지 않고 거부하며 clear하면 풀린다', () => {
  const limiter = createAttemptLimiter({ max: 3, windowMs: 1000 });
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), false);
  assert.equal(limiter.hit('k'), false);
  assert.equal(limiter.hit('other'), true);
  limiter.clear('k');
  assert.equal(limiter.hit('k'), true);
});

test('undo는 횟수를 1 내리고 0이 되면 기록을 지운다', () => {
  const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 });
  limiter.hit('k');
  limiter.hit('k');
  assert.equal(limiter.hit('k'), false);
  limiter.undo('k');
  assert.equal(limiter.hit('k'), true);
  limiter.undo('k');
  limiter.undo('k');
  assert.equal(limiter.size(), 0);
  limiter.undo('없는 키');
  assert.equal(limiter.size(), 0);
});

test('첫 시도로부터 windowMs가 지나면 기록이 만료된다', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 });
  limiter.hit('k');
  t.mock.timers.tick(500);
  assert.equal(limiter.hit('k'), true);
  assert.equal(limiter.hit('k'), false);
  t.mock.timers.tick(501);
  assert.equal(limiter.hit('k'), true);
  t.mock.timers.tick(1000);
  assert.equal(limiter.size(), 0);
});

test('키가 상한을 넘으면 가장 오래된 키부터 제거된다', () => {
  const limiter = createAttemptLimiter({ max: 1, windowMs: 60000 });
  for (let i = 0; i < MAX_KEYS + 5; i++) limiter.hit(`k${i}`);
  assert.equal(limiter.size(), MAX_KEYS);
  // 가장 오래된 키는 제거되어 다시 허용되고, 최근 키는 그대로 차단된다
  assert.equal(limiter.hit('k0'), true);
  assert.equal(limiter.hit(`k${MAX_KEYS + 4}`), false);
});
