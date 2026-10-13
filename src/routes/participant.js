const express = require('express');
const participants = require('../services/participants');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const draw = require('../services/draw');
const teams = require('../services/teams');
const manito = require('../services/manito');
const polls = require('../services/polls');
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
  const [announcementList, scheduleList, mine, hasEnvelope, myManito, pollSummary] = await Promise.all([
    announcements.list(req.event.id),
    schedules.list(req.event.id),
    draw.myResult(req.event.id, req.participant.id),
    draw.hasEnvelope(req.event.id, req.participant.id),
    manito.mine(req.event.id, req.participant.id),
    polls.homeSummary(req.event.id, req.participant.id),
  ]);
  res.render('participant/home', {
    title: req.event.title,
    announcements: announcementList,
    schedules: scheduleList,
    mine,
    hasEnvelope,
    manito: myManito,
    pollSummary,
    mapVisible: req.event.manito_stage === 'opened' && !req.event.manito_locked,
  });
});

router.get('/announcements/:id', requireParticipant, async (req, res) => {
  const announcement = await announcements.get(req.event.id, req.params.id);
  if (!announcement) return notFound(res);
  res.render('participant/announcement', { title: announcement.title, announcement });
});

async function renderDraw(req, res, { error = null, status = 200 } = {}) {
  const [mine, teamList, hasEnvelope] = await Promise.all([
    draw.myResult(req.event.id, req.participant.id),
    teams.listTeams(req.event.id),
    draw.hasEnvelope(req.event.id, req.participant.id),
  ]);
  res.status(status).render('participant/draw', { title: '팀 뽑기', mine, teams: teamList, hasEnvelope, error });
}

router.get('/draw', requireParticipant, async (req, res) => {
  if (!req.event.draw_open) return res.redirect(`${res.locals.base}/home`);
  await renderDraw(req, res);
});

router.post('/draw', requireParticipant, async (req, res) => {
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  if (!req.event.draw_open) {
    return wantsJson ? res.status(409).json({ error: draw.NOT_OPEN }) : res.redirect(`${res.locals.base}/home`);
  }
  try {
    const result = await draw.open(req.event.id, req.participant.id, 'self');
    if (!result) return notFound(res);
    if (wantsJson) {
      return res.json({
        team: { name: result.team.name, color: result.team.color, mark: result.team.mark },
        leaderName: result.leaderName,
      });
    }
    res.redirect(303, `${res.locals.base}/draw`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    // 요청 중에 초기화돼 닫힌 경우는 처음부터 닫혀 있던 것과 같게 응답한다
    if (err.message === draw.NOT_OPEN) {
      return wantsJson ? res.status(409).json({ error: draw.NOT_OPEN }) : res.redirect(`${res.locals.base}/home`);
    }
    if (wantsJson) return res.status(400).json({ error: err.message });
    await renderDraw(req, res, { error: err.message, status: 400 });
  }
});

router.get('/manito', requireParticipant, async (req, res) => {
  const myManito = await manito.mine(req.event.id, req.participant.id);
  res.render('participant/manito', { title: '내 마니또', manito: myManito, justOpened: req.query.opened === '1' });
});

router.post('/manito/open', requireParticipant, async (req, res) => {
  const opened = await manito.acknowledge(req.event.id, req.participant.id);
  res.redirect(303, `${res.locals.base}/manito${opened ? '?opened=1' : ''}`);
});

router.get('/manito/map', requireParticipant, async (req, res) => {
  res.render('participant/manito-map', { title: '마니또 맵', cycle: await manito.map(req.event.id) });
});

router.get('/teams', requireParticipant, async (req, res) => {
  const board = await draw.board(req.event.id);
  res.render('participant/teams', { title: '팀 현황', board });
});

router.get('/polls', requireParticipant, async (req, res) => {
  res.render('participant/polls', { title: '투표', list: await polls.listForParticipant(req.event.id, req.participant.id) });
});

async function renderPoll(req, res, { error = null, status = 200, selected = null } = {}) {
  const data = await polls.getForParticipant(req.event.id, req.params.id, req.participant.id);
  if (!data) return notFound(res);
  res.status(status).render('participant/poll', { title: data.poll.title, ...data, selected: selected || data.mine, error });
}

router.get('/polls/:id', requireParticipant, (req, res) => renderPoll(req, res));

router.post('/polls/:id/vote', requireParticipant, async (req, res) => {
  try {
    const ok = await polls.vote(req.event.id, req.params.id, req.participant.id, req.body);
    if (!ok) return notFound(res);
    res.redirect(303, `${res.locals.base}/polls/${req.params.id}`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderPoll(req, res, { error: err.message, status: 400, selected: polls.selectionFromInput(req.body) });
  }
});

router.post('/logout', async (req, res) => {
  await regenerate(req);
  clearEventEntry(req, req.event.id);
  res.redirect(res.locals.base);
});

router.use('/manage', require('./creator'));

module.exports = router;
