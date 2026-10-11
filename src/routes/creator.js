const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const { ValidationError } = require('../services/errors');
const announcements = require('../services/announcements');
const { requireParticipant, requireCreator, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, inviteUrl } = require('./helpers');

const router = express.Router({ mergeParams: true });
const manage = (res, path = '') => `${res.locals.base}/manage${path}`;

router.get('/unlock', requireParticipant, (req, res) => {
  if (req.isCreator) return res.redirect(manage(res));
  res.render('creator/unlock', { title: '생성자 확인' });
});

router.post('/unlock', requireParticipant, async (req, res) => {
  if (!(await events.verifyCreatorPin(req.event, req.body.pin))) {
    return res.status(400).render('creator/unlock', { title: '생성자 확인', error: '정보가 일치하지 않습니다' });
  }
  await regenerate(req);
  setEventEntry(req, req.event.id, { participantId: req.participant.id, isCreator: true });
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

module.exports = router;
