const express = require('express');
const participants = require('../services/participants');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const { ValidationError } = require('../services/errors');
const { loadEvent, requireParticipant, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, clearEventEntry } = require('./helpers');

const router = express.Router({ mergeParams: true });

router.use(loadEvent);

router.get('/', (req, res) => {
  if (req.session.events?.[req.event.id]) return res.redirect(`${res.locals.base}/home`);
  res.render('public/join', { title: req.event.title, values: { authCode: req.query.code || '' } });
});

router.post('/join', async (req, res) => {
  try {
    const participant = await participants.join(req.event, req.body);
    const previous = req.session.events?.[req.event.id];
    const keepCreator = Boolean(previous?.isCreator && String(previous.participantId) === String(participant.id));
    await regenerate(req);
    setEventEntry(req, req.event.id, { participantId: participant.id, isCreator: keepCreator });
    res.redirect(`${res.locals.base}/home`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).render('public/join', {
      title: req.event.title,
      values: { name: req.body.name, authCode: req.body.authCode },
      error: err.message,
    });
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

router.post('/logout', (req, res) => {
  clearEventEntry(req, req.event.id);
  res.redirect(res.locals.base);
});

module.exports = router;
