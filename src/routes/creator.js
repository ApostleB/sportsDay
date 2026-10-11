const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const { ValidationError } = require('../services/errors');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const { scheduleUpload } = require('./upload');
const { requireParticipant, requireCreator, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, inviteUrl } = require('./helpers');
const { createAttemptLimiter, TOO_MANY } = require('../middleware/attempt-limit');

const router = express.Router({ mergeParams: true });
const UNLOCK_WINDOW = 15 * 60 * 1000;
const unlockIpLimiter = createAttemptLimiter({ max: 5, windowMs: UNLOCK_WINDOW });
const unlockEventLimiter = createAttemptLimiter({ max: 20, windowMs: UNLOCK_WINDOW });
const manage = (res, path = '') => `${res.locals.base}/manage${path}`;

router.get('/unlock', requireParticipant, (req, res) => {
  if (req.isCreator) return res.redirect(manage(res));
  res.render('creator/unlock', { title: '생성자 확인' });
});

router.post('/unlock', requireParticipant, async (req, res) => {
  const ipKey = `${req.ip}|unlock|${req.event.id}`;
  const eventKey = `unlock|${req.event.id}`;
  if (unlockIpLimiter.isBlocked(ipKey) || unlockEventLimiter.isBlocked(eventKey)) {
    return res.status(429).render('creator/unlock', { title: '생성자 확인', error: TOO_MANY });
  }
  if (!(await events.verifyCreatorPin(req.event, req.body.pin))) {
    unlockIpLimiter.recordFailure(ipKey);
    unlockEventLimiter.recordFailure(eventKey);
    return res.status(400).render('creator/unlock', { title: '생성자 확인', error: '정보가 일치하지 않습니다' });
  }
  unlockIpLimiter.clear(ipKey);
  await regenerate(req);
  setEventEntry(req, req.event.id, {
    participantId: req.participant.id,
    isCreator: true,
    pinVersion: req.participant.pin_version,
    creatorPinVersion: req.event.creator_pin_version,
  });
  res.redirect(manage(res));
});

router.use(requireCreator);

router.get('/', async (req, res) => {
  const list = await participants.listParticipants(req.event.id);
  res.render('creator/dashboard', {
    title: '운동회 관리',
    inviteUrl: inviteUrl(req, req.event),
    total: list.length,
    present: list.filter((p) => p.attendance === 'present').length,
  });
});

router.get('/created', (req, res) => {
  res.render('creator/created', { title: '운동회가 만들어졌습니다', inviteUrl: inviteUrl(req, req.event) });
});

router.get('/event', (req, res) => {
  res.render('creator/event-edit', { title: '운동회 정보', values: req.event });
});

router.post('/event', async (req, res) => {
  try {
    await events.updateEvent(req.event.id, req.body);
    res.redirect(manage(res));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    const b = req.body;
    res.status(400).render('creator/event-edit', {
      title: '운동회 정보',
      values: {
        round_no: b.roundNo, title: b.title, event_date: b.eventDate, meet_info: b.meetInfo, auth_code: b.authCode, status: b.status,
      },
      error: err.message,
    });
  }
});

async function renderParticipants(req, res, error = null, status = 200) {
  const list = await participants.listParticipants(req.event.id);
  res.status(status).render('creator/participants', { title: '참가자 관리', wide: true, list, error });
}

router.get('/participants', (req, res) => renderParticipants(req, res));

router.post('/participants/:id', async (req, res) => {
  try {
    await participants.setAttendance(req.event.id, req.params.id, req.body.attendance);
    res.redirect(manage(res, '/participants'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderParticipants(req, res, err.message, 400);
  }
});

router.post('/participants/:id/delete', async (req, res) => {
  if (req.participant && String(req.participant.id) === String(req.params.id)) {
    return renderParticipants(req, res, '본인은 삭제할 수 없습니다', 400);
  }
  await participants.deleteParticipant(req.event.id, req.params.id);
  res.redirect(manage(res, '/participants'));
});

async function renderAnnouncements(req, res, { error = null, values = {}, status = 200 } = {}) {
  const list = await announcements.list(req.event.id);
  res.status(status).render('creator/announcements', { title: '공지 관리', list, values, error });
}

router.get('/announcements', (req, res) => renderAnnouncements(req, res));

router.post('/announcements', async (req, res) => {
  try {
    await announcements.create(req.event.id, req.body);
    res.redirect(manage(res, '/announcements'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderAnnouncements(req, res, { error: err.message, values: req.body, status: 400 });
  }
});

router.get('/announcements/:id/edit', async (req, res) => {
  const announcement = await announcements.get(req.event.id, req.params.id);
  if (!announcement) return notFound(res);
  res.render('creator/announcement-edit', { title: '공지 수정', values: announcement });
});

router.post('/announcements/:id', async (req, res) => {
  try {
    const updated = await announcements.update(req.event.id, req.params.id, req.body);
    if (!updated) return notFound(res);
    res.redirect(manage(res, '/announcements'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    if (!(await announcements.get(req.event.id, req.params.id))) return notFound(res);
    res.status(400).render('creator/announcement-edit', {
      title: '공지 수정',
      values: { id: req.params.id, title: req.body.title, body: req.body.body, pinned: req.body.pinned === 'on' },
      error: err.message,
    });
  }
});

router.post('/announcements/:id/delete', async (req, res) => {
  await announcements.remove(req.event.id, req.params.id);
  res.redirect(manage(res, '/announcements'));
});

async function renderSchedules(req, res, error = null, status = 200) {
  const list = await schedules.list(req.event.id);
  res.status(status).render('creator/schedules', { title: '시간표 관리', list, error });
}

router.get('/schedules', (req, res) => renderSchedules(req, res));

router.post('/schedules', (req, res, next) => {
  scheduleUpload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') return await renderSchedules(req, res, '이미지는 5MB 이하만 올릴 수 있습니다', 400);
        if (uploadErr instanceof ValidationError) return await renderSchedules(req, res, uploadErr.message, 400);
        return next(uploadErr);
      }
      if (!req.file) return await renderSchedules(req, res, '이미지를 선택해 주세요', 400);
      try {
        await schedules.add(req.event.id, { fileName: req.file.filename, caption: req.body.caption });
      } catch (err) {
        await schedules.removeFile(req.file.filename);
        if (err instanceof ValidationError) return await renderSchedules(req, res, err.message, 400);
        throw err;
      }
      res.redirect(manage(res, '/schedules'));
    } catch (err) {
      next(err);
    }
  });
});

router.post('/schedules/:id', async (req, res) => {
  try {
    await schedules.updateCaption(req.event.id, req.params.id, req.body.caption);
    res.redirect(manage(res, '/schedules'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderSchedules(req, res, err.message, 400);
  }
});

router.post('/schedules/:id/move', async (req, res) => {
  await schedules.move(req.event.id, req.params.id, req.body.direction === 'up' ? 'up' : 'down');
  res.redirect(manage(res, '/schedules'));
});

router.post('/schedules/:id/delete', async (req, res) => {
  await schedules.remove(req.event.id, req.params.id);
  res.redirect(manage(res, '/schedules'));
});

module.exports = router;
