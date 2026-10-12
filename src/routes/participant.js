const express = require('express');
const participants = require('../services/participants');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const { ValidationError } = require('../services/errors');
const { loadEvent, requireParticipant, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, clearEventEntry } = require('./helpers');
const { createAttemptLimiter, TOO_MANY } = require('../middleware/attempt-limit');

const router = express.Router({ mergeParams: true });
const JOIN_WINDOW = 15 * 60 * 1000;
const joinNameLimiter = createAttemptLimiter({ max: 10, windowMs: JOIN_WINDOW });
const joinIpLimiter = createAttemptLimiter({ max: 30, windowMs: JOIN_WINDOW });

// 서비스와 같은 규칙(공백 정리)으로 이름을 정규화해야 같은 사람이 공백만 바꿔 한도를 피하지 못한다
function nameLimitKey(value) {
  try {
    return participants.cleanName(value).toLowerCase();
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    // 어차피 거부될 입력은 별도 접두어로 묶어 정상 이름의 한도와 섞이지 않게 한다
    return `invalid|${String(value ?? '').trim().slice(0, 40).toLowerCase()}`;
  }
}

router.use(loadEvent);

router.get('/', (req, res) => {
  if (req.session.events?.[req.event.id]) return res.redirect(`${res.locals.base}/home`);
  res.render('public/join', { title: req.event.title, values: { authCode: req.query.code || '' } });
});

function renderJoin(req, res, status, error) {
  res.status(status).render('public/join', {
    title: req.event.title,
    values: { name: req.body.name, authCode: req.body.authCode },
    error,
  });
}

router.post('/join', async (req, res) => {
  // 이름 기준으로 센다: 같은 IP의 다른 이름 성공이 피해자 이름의 실패 기록을 지우지 못하게 한다
  const nameKey = `join|${req.event.id}|${nameLimitKey(req.body.name)}`;
  const ipKey = `join-ip|${req.event.id}|${req.ip}`;
  // 검증 전에 시도를 먼저 선점해 동시 요청으로 한도를 넘기지 못하게 한다
  if (!joinNameLimiter.hit(nameKey)) return renderJoin(req, res, 429, TOO_MANY);
  if (!joinIpLimiter.hit(ipKey)) {
    joinNameLimiter.undo(nameKey);
    return renderJoin(req, res, 429, TOO_MANY);
  }
  let participant;
  try {
    participant = await participants.join(req.event, req.body);
  } catch (err) {
    // 검증 실패(ValidationError)는 선점한 시도를 그대로 둔다. 서버 오류는 사용자 잘못이 아니므로 되돌린다
    if (!(err instanceof ValidationError)) {
      joinNameLimiter.undo(nameKey);
      joinIpLimiter.undo(ipKey);
      throw err;
    }
    return renderJoin(req, res, 400, err.message);
  }
  // 성공 처리는 join 호출 밖에서 한다. 이후 오류가 나도 한도 기록을 다시 건드리지 않는다
  joinNameLimiter.clear(nameKey);
  // 성공은 IP 횟수에 세지 않는다. clear하지 않으므로 다른 계정 성공으로 실패 기록이 지워지지 않는다
  joinIpLimiter.undo(ipKey);
  const previous = req.session.events?.[req.event.id];
  // 같은 사람이 다시 입장했고 그 사이 생성자 PIN과 개인 PIN이 재설정되지 않았을 때만 생성자 권한을 유지한다
  const keepCreator = Boolean(previous?.isCreator
    && String(previous.participantId) === String(participant.id)
    && (previous.pinVersion ?? 0) === participant.pin_version
    && (previous.creatorPinVersion ?? 0) === req.event.creator_pin_version);
  await regenerate(req);
  setEventEntry(req, req.event.id, {
    participantId: participant.id,
    isCreator: keepCreator,
    pinVersion: participant.pin_version,
    ...(keepCreator && { creatorPinVersion: req.event.creator_pin_version }),
  });
  res.redirect(`${res.locals.base}/home`);
});

router.get('/home', requireParticipant, async (req, res) => {
  const [announcementList, scheduleList] = await Promise.all([
    announcements.list(req.event.id),
    schedules.list(req.event.id),
  ]);
  res.render('participant/home', { title: req.event.title, announcements: announcementList, schedules: scheduleList });
});

router.get('/announcements/:id', requireParticipant, async (req, res) => {
  const announcement = await announcements.get(req.event.id, req.params.id);
  if (!announcement) return notFound(res);
  res.render('participant/announcement', { title: announcement.title, announcement });
});

router.post('/logout', async (req, res) => {
  await regenerate(req);
  clearEventEntry(req, req.event.id);
  res.redirect(res.locals.base);
});

router.use('/manage', require('./creator'));

module.exports = router;
