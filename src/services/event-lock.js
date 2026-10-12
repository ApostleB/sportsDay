const { ValidationError } = require('./errors');

const LOCKED = '팀 뽑기가 진행 중이라 바꿀 수 없습니다. 팀 뽑기 화면에서 초기화한 뒤 다시 시도해 주세요';

// 운동회 행을 잠가 같은 운동회의 팀·그룹·뽑기 작업이 동시에 엇갈리지 않게 한다
async function lockEvent(client, eventId) {
  if (!/^[1-9]\d{0,17}$/.test(String(eventId))) throw new ValidationError('운동회를 찾을 수 없습니다');
  const { rows } = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  if (!rows[0]) throw new ValidationError('운동회를 찾을 수 없습니다');
  return rows[0];
}

// 뽑기가 진행 중이면 팀·그룹 편집을 막는다
async function lockEditable(client, eventId) {
  const event = await lockEvent(client, eventId);
  if (event.draw_open) throw new ValidationError(LOCKED);
  return event;
}

module.exports = { LOCKED, lockEvent, lockEditable };
