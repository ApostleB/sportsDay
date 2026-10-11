const express = require('express');
const events = require('../services/events');
const { ValidationError } = require('../services/errors');
const { regenerate, setEventEntry } = require('./helpers');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/home', { title: '명량운동회' });
});

router.get('/go', (req, res) => {
  const raw = String(req.query.target ?? '').trim();
  const link = raw.match(/\/e\/([a-z0-9]+)(\?[^#]*)?/i);
  if (link) {
    const code = new URLSearchParams(link[2] || '').get('code');
    return res.redirect(`/e/${link[1].toLowerCase()}${code ? `?code=${encodeURIComponent(code)}` : ''}`);
  }
  const bare = raw.toLowerCase();
  if (/^[a-z0-9]{4,20}$/.test(bare)) return res.redirect(`/e/${bare}`);
  res.status(400).render('public/home', { title: '명량운동회', error: '초대 링크 또는 운동회 코드를 확인해 주세요' });
});

router.get('/events/new', (req, res) => {
  res.render('public/new-event', { title: '운동회 만들기' });
});

router.post('/events', async (req, res) => {
  try {
    const { event, participant } = await events.createEvent(req.body);
    await regenerate(req);
    setEventEntry(req, event.id, {
      participantId: participant.id,
      isCreator: true,
      pinVersion: participant.pin_version,
      creatorPinVersion: event.creator_pin_version,
    });
    res.redirect(`/e/${event.slug}/manage/created`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    const { roundNo, title, eventDate, meetInfo, creatorName } = req.body;
    res.status(400).render('public/new-event', {
      title: '운동회 만들기',
      values: { roundNo, title, eventDate, meetInfo, creatorName },
      error: err.message,
    });
  }
});

module.exports = router;
