const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttemptLimiter } = require('../src/middleware/attempt-limit');

test('최대 실패 횟수에 도달하면 차단되고 clear하면 풀린다', () => {
  const limiter = createAttemptLimiter({ max: 3, windowMs: 1000 });
  assert.equal(limiter.isBlocked('k'), false);
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  assert.equal(limiter.isBlocked('k'), false);
  limiter.recordFailure('k');
  assert.equal(limiter.isBlocked('k'), true);
  assert.equal(limiter.isBlocked('other'), false);
  limiter.clear('k');
  assert.equal(limiter.isBlocked('k'), false);
});

test('첫 실패로부터 windowMs가 지나면 기록이 만료된다', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const limiter = createAttemptLimiter({ max: 2, windowMs: 1000 });
  limiter.recordFailure('k');
  t.mock.timers.tick(500);
  limiter.recordFailure('k');
  assert.equal(limiter.isBlocked('k'), true);
  t.mock.timers.tick(501);
  assert.equal(limiter.isBlocked('k'), false);
  assert.equal(limiter.size(), 0);
});
