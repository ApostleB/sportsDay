// 메모리 기반 시도 횟수 제한. 첫 시도로부터 windowMs가 지나면 기록이 사라진다.
// 검증이 끝나기 전에 hit()로 시도를 먼저 선점하므로, 동시에 보낸 요청도 max를 넘길 수 없다.
const limiters = new Set();

const TOO_MANY = '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
const MAX_KEYS = 10000;

function createAttemptLimiter({ max, windowMs }) {
  const entries = new Map();
  let lastPrune = 0;

  const isExpired = (entry, now) => now - entry.first >= windowMs;

  // 전체 순회는 windowMs/10마다 한 번만 한다. 개별 키는 조회할 때 만료 여부를 따로 확인한다
  function prune(now) {
    if (now - lastPrune < windowMs / 10) return;
    lastPrune = now;
    for (const [key, entry] of entries) {
      if (isExpired(entry, now)) entries.delete(key);
    }
  }

  function live(key, now) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (isExpired(entry, now)) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  const limiter = {
    // 시도를 1 올리고 허용 여부를 돌려준다. 이미 한도에 닿았으면 올리지 않고 false
    hit(key) {
      const now = Date.now();
      prune(now);
      const entry = live(key, now);
      if (!entry) {
        entries.set(key, { first: now, count: 1 });
        // 키가 너무 많아지면 가장 오래 전에 들어온 키부터 버린다
        while (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value);
        return max >= 1;
      }
      if (entry.count >= max) return false;
      entry.count += 1;
      return true;
    },
    // 성공한 시도를 되돌린다. 0이 되면 기록을 지운다
    undo(key) {
      const entry = live(key, Date.now());
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) entries.delete(key);
    },
    clear(key) {
      entries.delete(key);
    },
    size() {
      const now = Date.now();
      lastPrune = 0;
      prune(now);
      return entries.size;
    },
    reset() {
      entries.clear();
      lastPrune = 0;
    },
  };
  limiters.add(limiter);
  return limiter;
}

function resetAllLimiters() {
  for (const limiter of limiters) limiter.reset();
}

module.exports = { createAttemptLimiter, resetAllLimiters, TOO_MANY, MAX_KEYS };
