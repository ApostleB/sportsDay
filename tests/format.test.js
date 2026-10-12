const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtDate, fmtDateTime, statusLabel, manitoStageLabel } = require('../src/services/format');

test('날짜는 요일과 함께 한국어로 표시한다', () => {
  assert.equal(fmtDate('2026-10-10'), '2026년 10월 10일 (토)');
  assert.equal(fmtDate(null), '');
});

test('일시는 서울 시간으로 표시한다', () => {
  assert.match(fmtDateTime(new Date('2026-10-10T00:00:00Z')), /2026\. 10\. 10\. 09:00/);
  assert.equal(fmtDateTime(null), '');
});

test('상태 라벨', () => {
  assert.equal(statusLabel('ready'), '준비중');
  assert.equal(statusLabel('live'), '진행중');
  assert.equal(statusLabel('closed'), '종료');
});

test('manitoStageLabel', () => {
  assert.equal(manitoStageLabel('none'), '준비');
  assert.equal(manitoStageLabel('assigned'), '배정됨');
  assert.equal(manitoStageLabel('opened'), '공개됨');
  assert.equal(manitoStageLabel('x'), 'x');
});
