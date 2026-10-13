const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const schedules = require('../services/schedules');
const manito = require('../services/manito');
const polls = require('../services/polls');
const { ValidationError } = require('../services/errors');
const { checkAdminPassword, requireAdmin, notFound } = require('../middleware/auth');
const { regenerate, inviteUrl } = require('./helpers');
const { createAttemptLimiter, TOO_MANY } = require('../middleware/attempt-limit');

const router = express.Router();
const loginLimiter = createAttemptLimiter({ max: 5, windowMs: 15 * 60 * 1000 });

const DONE_MESSAGES = {
  pin: '참가자 PIN을 재설정했습니다',
  creator: '생성자 PIN을 재설정했습니다',
  manitoLock: '마니또 맵을 잠갔습니다',
  manitoUnlock: '마니또 맵 잠금을 풀었습니다',
  joinClosed: '참가를 마감했습니다',
  joinOpen: '참가 마감을 풀었습니다',
};

router.get('/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { title: '관리자 로그인' });
});

router.post('/login', async (req, res) => {
  const limitKey = `${req.ip}|admin`;
  // 검증 전에 시도를 먼저 선점해 동시 요청으로 한도를 넘기지 못하게 한다
  if (!loginLimiter.hit(limitKey)) {
    return res.status(429).render('admin/login', { title: '관리자 로그인', error: TOO_MANY });
  }
  if (!checkAdminPassword(req.body.password)) {
    return res.status(401).render('admin/login', { title: '관리자 로그인', error: '정보가 일치하지 않습니다' });
  }
  loginLimiter.clear(limitKey);
  await regenerate(req);
  req.session.admin = true;
  res.redirect('/admin');
});

router.post('/logout', async (req, res) => {
  await regenerate(req);
  req.session.admin = false;
  res.redirect('/admin/login');
});

// 로그인·로그아웃을 뺀 관리자 화면은 모두 관리 영역이다
function adminArea(req, res, next) {
  res.locals.area = 'admin';
  res.locals.wide = true;
  next();
}

router.use(requireAdmin, adminArea);

router.get('/', async (req, res) => {
  res.render('admin/index', { title: '플랫폼 관리', wide: true, eventList: await events.listEvents() });
});

async function loadAdminEvent(req, res, next) {
  const event = await events.getEventById(req.params.id);
  if (!event) return notFound(res);
  req.event = event;
  next();
}

async function renderDetail(req, res, { message = null, error = null, status = 200 } = {}) {
  const [list, manitoView, pollList] = await Promise.all([
    participants.listParticipants(req.event.id),
    manito.adminView(req.event.id),
    polls.listWithCounts(req.event.id),
  ]);
  res.status(status).render('admin/event', {
    title: `관리: ${req.event.title}`,
    wide: true,
    event: req.event,
    list,
    manito: manitoView,
    pollList,
    inviteUrl: inviteUrl(req, req.event),
    message,
    error,
  });
}

router.get('/events/:id', loadAdminEvent, (req, res) => (
  renderDetail(req, res, { message: Object.hasOwn(DONE_MESSAGES, req.query.done) ? DONE_MESSAGES[req.query.done] : null })
));

router.post('/events/:id/participants/:pid/pin', loadAdminEvent, async (req, res) => {
  try {
    const ok = await participants.resetPin(req.event.id, req.params.pid, req.body.pin);
    if (!ok) return notFound(res);
    res.redirect(`/admin/events/${req.event.id}?done=pin`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDetail(req, res, { error: err.message, status: 400 });
  }
});

router.post('/events/:id/creator-pin', loadAdminEvent, async (req, res) => {
  try {
    await events.setCreatorPin(req.event.id, req.body.pin);
    res.redirect(`/admin/events/${req.event.id}?done=creator`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDetail(req, res, { error: err.message, status: 400 });
  }
});

router.post('/events/:id/manito-lock', loadAdminEvent, async (req, res) => {
  const locked = req.body.locked === '1';
  await manito.setLocked(req.event.id, locked);
  res.redirect(`/admin/events/${req.event.id}?done=${locked ? 'manitoLock' : 'manitoUnlock'}`);
});

router.post('/events/:id/join-closed', loadAdminEvent, async (req, res) => {
  const closed = req.body.closed === '1';
  await events.setJoinClosed(req.event.id, closed);
  res.redirect(`/admin/events/${req.event.id}?done=${closed ? 'joinClosed' : 'joinOpen'}`);
});

router.post('/events/:id/delete', loadAdminEvent, async (req, res) => {
  if (String(req.body.confirm ?? '').trim().toLowerCase() !== req.event.slug) {
    return renderDetail(req, res, { error: '확인 문구가 운동회 코드와 다릅니다', status: 400 });
  }
  const files = await events.deleteEvent(req.event.id);
  const list = files || [];
  const results = await Promise.allSettled(list.map((f) => schedules.removeFile(f)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.error('시간표 파일 삭제 실패:', list[i], result.reason);
  });
  res.redirect('/admin');
});

module.exports = router;
