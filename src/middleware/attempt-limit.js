// 메모리 기반 실패 횟수 제한. 첫 실패로부터 windowMs가 지나면 기록이 사라진다.
const limiters = new Set();

const TOO_MANY = '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';

function createAttemptLimiter({ max, windowMs }) {
  const entries = new Map();

  // 호출될 때마다 만료된 기록을 정리해 메모리가 무한히 늘지 않게 한다
  function prune(now) {
    for (const [key, entry] of entries) {
      if (now - entry.first >= windowMs) entries.delete(key);
    }
  }

  const limiter = {
    isBlocked(key) {
      prune(Date.now());
      return (entries.get(key)?.count ?? 0) >= max;
    },
    recordFailure(key) {
      const now = Date.now();
      prune(now);
      const entry = entries.get(key);
      if (entry) entry.count += 1;
      else entries.set(key, { first: now, count: 1 });
    },
    clear(key) {
      prune(Date.now());
      entries.delete(key);
    },
    size() {
      prune(Date.now());
      return entries.size;
    },
    reset() {
      entries.clear();
    },
  };
  limiters.add(limiter);
  return limiter;
}

function resetAllLimiters() {
  for (const limiter of limiters) limiter.reset();
}

module.exports = { createAttemptLimiter, resetAllLimiters, TOO_MANY };
