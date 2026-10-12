// 마니또 순환 계산. DB와 무관한 순수 함수이며 난수 함수를 받아 시드 고정 테스트를 할 수 있다
// links는 [{ giver, receiver }]이고 id는 모두 문자열로 다룬다. 입력 배열은 바꾸지 않는다

function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const copy = (links) => links.map((l) => ({ giver: l.giver, receiver: l.receiver }));

// 섞은 순서대로 이어 하나의 고리를 만든다. 2명이면 서로의 마니또, 1명 이하면 빈 순환
function buildCycle(ids, random) {
  const order = shuffle(ids.map(String), random);
  if (order.length < 2) return [];
  return order.map((giver, i) => ({ giver, receiver: order[(i + 1) % order.length] }));
}

// A→X→B를 A→B로 잇는다. 2명 순환에서 빠지면 남은 1명은 마니또가 없으므로 빈 순환
function removeFromCycle(links, id) {
  const key = String(id);
  const own = links.find((l) => l.giver === key);
  if (!own) return copy(links);
  if (links.length <= 2) return [];
  return links
    .filter((l) => l.giver !== key)
    .map((l) => ({ giver: l.giver, receiver: l.receiver === key ? own.receiver : l.receiver }));
}

// 무작위 연결 A→B를 골라 A→새 사람→B로 만든다. 빈 순환은 서비스가 새로 만든다
function insertIntoCycle(links, id, random) {
  const key = String(id);
  if (links.length === 0 || links.some((l) => l.giver === key)) return copy(links);
  const at = Math.floor(random() * links.length);
  const target = links[at];
  return [
    ...links.map((l, i) => ({ giver: l.giver, receiver: i === at ? key : l.receiver })),
    { giver: key, receiver: target.receiver },
  ];
}

// 숫자로 가장 작은 giver부터 고리를 따라간 순서. 닫히지 않은 고리(잃어버린 연결)는 빈 배열을 돌려준다. 다중 고리는 한 고리만 돌려주며 길이가 links.length와 다르다
function cycleOrder(links) {
  if (links.length === 0) return [];
  const next = new Map(links.map((l) => [l.giver, l.receiver]));
  const start = [...next.keys()].reduce((a, b) => (BigInt(a) <= BigInt(b) ? a : b));
  const order = [start];
  let cur = next.get(start);

  while (cur !== start && cur !== undefined && order.length < links.length) {
    order.push(cur);
    cur = next.get(cur);
  }

  // 연결이 끊어진 경우 undefined를 만난다
  if (cur === undefined) {
    return [];
  }

  // 고리가 시작점으로 돌아오지 않는 경우 (잃어버린 연결)
  if (cur !== start) {
    return [];
  }

  // 유효한 고리: 하나의 고리이면 길이가 links.length와 같고, 다중 고리면 다르다
  return order;
}

module.exports = { buildCycle, removeFromCycle, insertIntoCycle, cycleOrder };
