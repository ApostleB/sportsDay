const WEEKDAYS = '일월화수목금토';
const STATUS_LABELS = { ready: '준비중', live: '진행중', closed: '종료' };

const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function fmtDate(value) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

function fmtDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : '';
}

const statusLabel = (status) => STATUS_LABELS[status] || status;

const MANITO_STAGE_LABELS = { none: '준비', assigned: '배정됨', opened: '공개됨' };
const manitoStageLabel = (stage) => MANITO_STAGE_LABELS[stage] || stage;

module.exports = { fmtDate, fmtDateTime, statusLabel, manitoStageLabel };
