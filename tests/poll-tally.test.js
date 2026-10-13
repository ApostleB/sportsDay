const test = require('node:test');
const assert = require('node:assert/strict');
const { tally } = require('../src/services/poll-tally');

const options = [{ id: '1', label: '짜장면' }, { id: '2', label: '짬뽕' }, { id: '3', label: '볶음밥' }];
const pick = (optionId, name) => ({ option_id: optionId, other_text: null, name });
const other = (text, name) => ({ option_id: null, other_text: text, name });

test('표 수, 반올림 비율, 최다 강조, 비익명 이름순', () => {
  const r = tally({ anonymous: false, options, answers: [pick('1', '철수'), pick('1', '영희'), pick('2', '민수')], voterCount: 3 });
  assert.deepEqual(r.options.map((o) => [o.id, o.label, o.count, o.percent, o.top]), [
    ['1', '짜장면', 2, 67, true], ['2', '짬뽕', 1, 33, false], ['3', '볶음밥', 0, 0, false],
  ]);
  assert.deepEqual(r.options[0].names, ['영희', '철수']);
  assert.equal(r.voterCount, 3);
});

test('동점이면 모두 최다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1'), pick('2')], voterCount: 2 });
  assert.deepEqual(r.options.map((o) => o.top), [true, true, false]);
});

test('익명이면 이름이 들어와도 결과에 넣지 않는다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1', '철수'), other('탕수육', '영희')], voterCount: 2 });
  assert.deepEqual(r.options[0].names, []);
  assert.deepEqual(r.others, [{ text: '탕수육', count: 1, names: [] }]);
  assert.ok(!JSON.stringify(r).includes('철수'));
  assert.ok(!JSON.stringify(r).includes('영희'));
});

test('기타는 같은 내용끼리 묶어 많은 순, 같으면 내용순', () => {
  const r = tally({
    anonymous: false,
    options,
    answers: [other('탕수육', '철수'), other('냉면', '민수'), other('탕수육', '영희'), other('군만두', '지수')],
    voterCount: 4,
  });
  assert.deepEqual(r.others, [
    { text: '탕수육', count: 2, names: ['영희', '철수'] },
    { text: '군만두', count: 1, names: ['지수'] },
    { text: '냉면', count: 1, names: ['민수'] },
  ]);
  assert.equal(r.otherCount, 4);
  assert.deepEqual(r.options.map((o) => o.top), [false, false, false], '기타만 있으면 강조할 항목이 없다');
});

test('투표자 0명', () => {
  const r = tally({ anonymous: true, options, answers: [], voterCount: 0 });
  assert.deepEqual(r.options.map((o) => [o.count, o.percent, o.top]), [[0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(r.others, []);
  assert.equal(r.otherCount, 0);
});

test('다중 선택은 항목별 비율이 투표자 수 기준이다', () => {
  const r = tally({ anonymous: true, options, answers: [pick('1'), pick('2'), pick('1')], voterCount: 2 });
  assert.deepEqual(r.options.map((o) => o.percent), [100, 50, 0]);
});
