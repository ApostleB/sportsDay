const crypto = require('node:crypto');
const config = require('../config');
const events = require('../services/events');
const participants = require('../services/participants');

function checkAdminPassword(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function notFound(res) {
  return res.status(404).render('error', { title: '찾을 수 없습니다', status: 404, message: '요청한 페이지가 없습니다' });
}

async function loadEvent(req, res, next) {
  const event = await events.getEventBySlug(req.params.slug);
  if (!event) return notFound(res);
  req.event = event;
  res.locals.event = event;
  res.locals.base = `/e/${event.slug}`;
  next();
}

async function requireParticipant(req, res, next) {
  const entry = req.session.events?.[req.event.id];
  if (!entry) return res.redirect(res.locals.base);
  const participant = await participants.getParticipant(req.event.id, entry.participantId);
  // 삭제됐거나 PIN이 재설정된 참가자는 이 운동회의 입장 정보를 지우고 입장 폼으로 보낸다
  if (!participant || (entry.pinVersion ?? 0) !== participant.pin_version) {
    const nextEvents = { ...req.session.events };
    delete nextEvents[req.event.id];
    req.session.events = nextEvents;
    return res.redirect(res.locals.base);
  }
  // 생성자 PIN이 재설정되면 생성자 권한만 내려놓고 참가자로는 계속 이용한다
  if (entry.isCreator && (entry.creatorPinVersion ?? 0) !== req.event.creator_pin_version) {
    req.session.events = { ...req.session.events, [req.event.id]: { ...entry, isCreator: false } };
  }
  req.participant = participant;
  req.isCreator = Boolean(req.session.events[req.event.id].isCreator);
  res.locals.participant = participant;
  res.locals.isCreator = req.isCreator;
  next();
}

async function requireCreator(req, res, next) {
  if (req.session.admin) {
    req.isCreator = true;
    res.locals.isCreator = true;
    return next();
  }
  return requireParticipant(req, res, () => {
    if (!req.isCreator) return res.redirect(`${res.locals.base}/manage/unlock`);
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
}

module.exports = { checkAdminPassword, notFound, loadEvent, requireParticipant, requireCreator, requireAdmin };
