const express = require('express');
const participants = require('../services/participants');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const { ValidationError } = require('../services/errors');
const { loadEvent, requireParticipant, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, clearEventEntry } = require('./helpers');
const { createAttemptLimiter, TOO_MANY } = require('../middleware/attempt-limit');

const router = express.Router({ mergeParams: true });
const joinLimiter = createAttemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

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
  const limitKey = `${req.ip}|join|${req.event.id}`;
  if (joinLimiter.isBlocked(limitKey)) return renderJoin(req, res, 429, TOO_MANY);
  try {
    const participant = await participants.join(req.event, req.body);
    joinLimiter.clear(limitKey);
    const previous = req.session.events?.[req.event.id];
    // 같은 사람이 다시 입장했고 그 사이 생성자 PIN이 재설정되지 않았을 때만 생성자 권한을 유지한다
    const keepCreator = Boolean(previous?.isCreator
      && String(previous.participantId) === String(participant.id)
      && (previous.creatorPinVersion ?? 0) === req.event.creator_pin_version);
    await regenerate(req);
    setEventEntry(req, req.event.id, {
      participantId: participant.id,
      isCreator: keepCreator,
      pinVersion: participant.pin_version,
      ...(keepCreator && { creatorPinVersion: req.event.creator_pin_version }),
    });
    res.redirect(`${res.locals.base}/home`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    joinLimiter.recordFailure(limitKey);
    renderJoin(req, res, 400, err.message);
  }
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
