const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCycle, removeFromCycle, insertIntoCycle, cycleOrder } = require('../src/services/manito-cycle');
const { mulberry32 } = require('../src/services/draw-assign');

const idsOf = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

// 하나의 고리이고, 자기 자신이 없고, 모두 한 번씩 주고받는다
function assertCycle(links, ids) {
  const expected = [...ids].map(String).sort();
  assert.deepEqual(links.map((l) => l.giver).sort(), expected);
  assert.deepEqual(links.map((l) => l.receiver).sort(), expected);
  for (const l of links) assert.notEqual(l.giver, l.receiver);
  if (links.length) assert.equal(cycleOrder(links).length, links.length, '하나의 고리가 아니다');
}

// receiver가 바뀐 기존 giver
function changedGivers(before, after) {
  const prev = new Map(before.map((l) => [l.giver, l.receiver]));
  return after.filter((l) => prev.has(l.giver) && prev.get(l.giver) !== l.receiver).map((l) => l.giver);
}

test('buildCycle: 3~40명 모두 하나의 고리', () => {
  for (let n = 3; n <= 40; n++) {
    for (let seed = 1; seed <= 5; seed++) assertCycle(buildCycle(idsOf(n), mulberry32(seed * 100 + n)), idsOf(n));
  }
});

test('buildCycle: 숫자 id도 문자열로 다루고, 2명은 서로, 0~1명은 빈 순환', () => {
  assertCycle(buildCycle([10, 20, 30], mulberry32(1)), ['10', '20', '30']);
  assert.deepEqual(buildCycle(['1', '2'], mulberry32(1)).map((l) => [l.giver, l.receiver]).sort(), [['1', '2'], ['2', '1']]);
  assert.deepEqual(buildCycle(['1'], mulberry32(1)), []);
  assert.deepEqual(buildCycle([], mulberry32(1)), []);
});

test('buildCycle: 시드가 같으면 같은 결과, 입력을 바꾸지 않는다', () => {
  const ids = idsOf(8);
  const copy = [...ids];
  assert.deepEqual(buildCycle(ids, mulberry32(7)), buildCycle(ids, mulberry32(7)));
  assert.deepEqual(ids, copy);
});

test('removeFromCycle: 앞사람만 다음 사람으로 잇는다', () => {
  const links = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '3' }, { giver: '3', receiver: '4' }, { giver: '4', receiver: '1' }];
  const after = removeFromCycle(links, '3');
  assertCycle(after, ['1', '2', '4']);
  assert.deepEqual(after.find((l) => l.giver === '2'), { giver: '2', receiver: '4' });
  assert.deepEqual(changedGivers(links, after), ['2']);
  assert.equal(links.length, 4, '입력을 바꾸면 안 된다');
});

test('removeFromCycle: 3→2명은 서로, 2→빈 순환, 없는 사람은 그대로', () => {
  const three = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '3' }, { giver: '3', receiver: '1' }];
  const two = removeFromCycle(three, 2);
  assertCycle(two, ['1', '3']);
  assert.deepEqual(removeFromCycle(two, '1'), []);
  assert.deepEqual(removeFromCycle(three, '9'), three);
  assert.notEqual(removeFromCycle(three, '9'), three, '복사본을 돌려줘야 한다');
  assert.deepEqual(removeFromCycle([], '1'), []);
});

test('insertIntoCycle: 한 연결 사이에 끼우고 바뀐 기존 giver는 1명', () => {
  const links = buildCycle(idsOf(5), mulberry32(3));
  const after = insertIntoCycle(links, 99, mulberry32(4));
  assertCycle(after, [...idsOf(5), '99']);
  assert.equal(changedGivers(links, after).length, 1);
  const a = changedGivers(links, after)[0];
  assert.equal(after.find((l) => l.giver === a).receiver, '99');
  assert.equal(after.find((l) => l.giver === '99').receiver, links.find((l) => l.giver === a).receiver);
});

test('insertIntoCycle: 2명 순환에 끼우면 3명, 빈 순환과 이미 있는 사람은 그대로', () => {
  const two = buildCycle(['1', '2'], mulberry32(1));
  assertCycle(insertIntoCycle(two, '3', mulberry32(2)), ['1', '2', '3']);
  assert.deepEqual(insertIntoCycle([], '1', mulberry32(1)), []);
  assert.deepEqual(insertIntoCycle(two, '1', mulberry32(1)), two);
  assert.notEqual(insertIntoCycle(two, '1', mulberry32(1)), two, '복사본을 돌려줘야 한다');
});

test('빼기·끼우기를 수백 번 섞어도 항상 하나의 고리이고 바뀐 기존 giver는 최대 1명', () => {
  const random = mulberry32(2026);
  const pool = idsOf(12);
  let present = new Set(pool.slice(0, 6));
  let links = buildCycle([...present], random);
  for (let step = 0; step < 600; step++) {
    const id = pool[Math.floor(random() * pool.length)];
    const before = links;
    if (present.has(id)) {
      present.delete(id);
      links = removeFromCycle(links, id);
    } else {
      present.add(id);
      // 빈 순환에 합류하면 서비스처럼 출석자 전원으로 새로 만든다
      links = links.length === 0 ? buildCycle([...present], random) : insertIntoCycle(links, id, random);
    }
    if (before.length > 0 && links.length > 0) assert.ok(changedGivers(before, links).length <= 1, `step ${step}`);
    assertCycle(links, present.size >= 2 ? [...present] : []);
  }
});

test('cycleOrder: 가장 작은 id부터 고리 순서, 고리가 둘이면 길이가 짧다', () => {
  const links = [{ giver: '30', receiver: '4' }, { giver: '4', receiver: '100' }, { giver: '100', receiver: '30' }];
  assert.deepEqual(cycleOrder(links), ['4', '100', '30']);
  assert.deepEqual(cycleOrder([]), []);
  const broken = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '1' }, { giver: '3', receiver: '4' }, { giver: '4', receiver: '3' }];
  assert.equal(cycleOrder(broken).length, 2);
});

test('cycleOrder: 닫히지 않은 고리는 빈 배열을 돌려준다', () => {
  // 두 개의 분리된 연결: 1→2, 3→4
  const separated = [{ giver: '1', receiver: '2' }, { giver: '3', receiver: '4' }];
  assert.deepEqual(cycleOrder(separated), [], '분리된 연결은 고리가 아니다');

  // 잃어버린 연결이 있는 체인: 1→2→3 (3의 다음이 없음)
  const missingLink = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '3' }];
  assert.deepEqual(cycleOrder(missingLink), [], '잃어버린 연결이 있는 체인은 고리가 아니다');

  // 다중 고리: 1→2, 2→1, 3→4, 4→3 (두 개의 분리된 고리)
  const multiCycle = [{ giver: '1', receiver: '2' }, { giver: '2', receiver: '1' }, { giver: '3', receiver: '4' }, { giver: '4', receiver: '3' }];
  assert.ok(cycleOrder(multiCycle).length !== multiCycle.length, '다중 고리는 links.length와 길이가 다르다');
});
