const express = require('express');
const events = require('../services/events');
const participants = require('../services/participants');
const { ValidationError } = require('../services/errors');
const announcements = require('../services/announcements');
const schedules = require('../services/schedules');
const teams = require('../services/teams');
const groups = require('../services/groups');
const draw = require('../services/draw');
const { scheduleUpload } = require('./upload');
const { requireParticipant, requireCreator, notFound } = require('../middleware/auth');
const { regenerate, setEventEntry, inviteUrl } = require('./helpers');
const { createAttemptLimiter, TOO_MANY } = require('../middleware/attempt-limit');

const router = express.Router({ mergeParams: true });
const UNLOCK_WINDOW = 15 * 60 * 1000;
const unlockParticipantLimiter = createAttemptLimiter({ max: 5, windowMs: UNLOCK_WINDOW });
const unlockEventLimiter = createAttemptLimiter({ max: 20, windowMs: UNLOCK_WINDOW });
const manage = (res, path = '') => `${res.locals.base}/manage${path}`;

router.get('/unlock', requireParticipant, (req, res) => {
  if (req.isCreator) return res.redirect(manage(res));
  res.render('creator/unlock', { title: '생성자 확인' });
});

router.post('/unlock', requireParticipant, async (req, res) => {
  const participantKey = `unlock|${req.event.id}|${req.participant.id}`;
  const eventKey = `unlock|${req.event.id}`;
  const tooMany = () => res.status(429).render('creator/unlock', { title: '생성자 확인', error: TOO_MANY });
  // 검증 전에 시도를 먼저 선점해 동시 요청으로 한도를 넘기지 못하게 한다
  if (!unlockParticipantLimiter.hit(participantKey)) return tooMany();
  if (!unlockEventLimiter.hit(eventKey)) {
    unlockParticipantLimiter.undo(participantKey);
    return tooMany();
  }
  let ok;
  try {
    ok = await events.verifyCreatorPin(req.event, req.body.pin);
  } catch (err) {
    unlockParticipantLimiter.undo(participantKey);
    unlockEventLimiter.undo(eventKey);
    throw err;
  }
  if (!ok) {
    return res.status(400).render('creator/unlock', { title: '생성자 확인', error: '정보가 일치하지 않습니다' });
  }
  unlockParticipantLimiter.clear(participantKey);
  unlockEventLimiter.undo(eventKey);
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
// 이 아래는 모두 관리 화면이다. 폭을 넓히고 관리 막대와 현재 메뉴 강조에 쓸 값을 넣는다
router.use((req, res, next) => {
  res.locals.area = 'manage';
  res.locals.wide = true;
  res.locals.navPath = req.path;
  next();
});

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

async function renderParticipants(req, res, { error = null, status = 200, values = {} } = {}) {
  const list = await participants.listParticipants(req.event.id);
  res.status(status).render('creator/participants', { title: '참가자 관리', wide: true, list, error, values });
}

router.get('/participants', (req, res) => renderParticipants(req, res));

router.post('/participants', async (req, res) => {
  try {
    await participants.createParticipant(req.event.id, req.body);
    res.redirect(manage(res, '/participants'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderParticipants(req, res, { error: err.message, status: 400, values: { name: req.body.name } });
  }
});

router.get('/participants/:id/edit', async (req, res) => {
  const p = await participants.getParticipant(req.event.id, req.params.id);
  if (!p) return notFound(res);
  res.render('creator/participant-edit', { title: '참가자 수정', values: { id: p.id, name: p.name } });
});

router.post('/participants/:id/edit', async (req, res) => {
  const isSelf = Boolean(req.participant) && String(req.participant.id) === String(req.params.id);
  try {
    if (isSelf && String(req.body.pin ?? '').trim()) throw new ValidationError('본인 PIN은 여기서 바꿀 수 없습니다');
    const updated = await participants.updateParticipant(req.event.id, req.params.id, req.body);
    if (!updated) return notFound(res);
    res.redirect(manage(res, '/participants'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    if (!(await participants.getParticipant(req.event.id, req.params.id))) return notFound(res);
    res.status(400).render('creator/participant-edit', {
      title: '참가자 수정', values: { id: req.params.id, name: req.body.name }, error: err.message,
    });
  }
});

router.post('/participants/:id', async (req, res) => {
  try {
    await participants.setAttendance(req.event.id, req.params.id, req.body.attendance);
    res.redirect(manage(res, '/participants'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderParticipants(req, res, { error: err.message, status: 400 });
  }
});

router.post('/participants/:id/delete', async (req, res) => {
  if (req.participant && String(req.participant.id) === String(req.params.id)) {
    return renderParticipants(req, res, { error: '본인은 삭제할 수 없습니다', status: 400 });
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

// 거부된 변경 뒤에는 요청 시작 때의 event 대신 최신 상태로 다시 그린다
async function freshDrawOpen(req) {
  const event = await events.getEventById(req.event.id);
  return Boolean(event ? event.draw_open : req.event.draw_open);
}

async function renderTeams(req, res, { error = null, values = null, status = 200 } = {}) {
  const drawOpen = await freshDrawOpen(req);
  await teams.ensureDefaultTeams(req.event.id);
  const [teamList, people] = await Promise.all([
    teams.listTeams(req.event.id),
    participants.listParticipants(req.event.id),
  ]);
  res.status(status).render('creator/teams', {
    title: '팀 설정', wide: true, teams: teamList, people, palette: teams.PALETTE, values, error, locked: drawOpen,
  });
}

router.get('/teams', (req, res) => renderTeams(req, res));

router.post('/teams/count', async (req, res) => {
  try {
    await teams.setTeamCount(req.event.id, req.body.count);
    res.redirect(manage(res, '/teams'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderTeams(req, res, { error: err.message, status: 400 });
  }
});

router.post('/teams', async (req, res) => {
  try {
    await teams.saveTeams(req.event.id, req.body);
    res.redirect(manage(res, '/teams'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderTeams(req, res, { error: err.message, values: req.body, status: 400 });
  }
});

async function renderGroups(req, res, { error = null, status = 200 } = {}) {
  const drawOpen = await freshDrawOpen(req);
  const [groupList, list] = await Promise.all([
    groups.listGroups(req.event.id),
    participants.listParticipants(req.event.id),
  ]);
  res.status(status).render('creator/groups', {
    title: '그룹', wide: true, groups: groupList, list, error, locked: drawOpen,
  });
}

// 그룹 화면의 POST는 모두 같은 방식으로 처리한다. 결과가 null/false면 없는 그룹이다
async function groupAction(req, res, action) {
  try {
    const result = await action();
    if (result === null || result === false) return notFound(res);
    res.redirect(manage(res, '/groups'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderGroups(req, res, { error: err.message, status: 400 });
  }
}

router.get('/groups', (req, res) => renderGroups(req, res));
router.post('/groups', (req, res) => groupAction(req, res, () => groups.createGroup(req.event.id, req.body.name)));
// /groups/:id보다 먼저 등록해야 members가 id로 해석되지 않는다
router.post('/groups/members', (req, res) => groupAction(req, res, () => groups.saveMembership(req.event.id, req.body)));
router.post('/groups/:id', (req, res) => groupAction(req, res, () => groups.renameGroup(req.event.id, req.params.id, req.body.name)));
router.post('/groups/:id/delete', (req, res) => groupAction(req, res, () => groups.deleteGroup(req.event.id, req.params.id)));

async function renderDraw(req, res, { error = null, status = 200 } = {}) {
  const drawOpen = await freshDrawOpen(req);
  await teams.ensureDefaultTeams(req.event.id);
  const [teamList, rows, problems] = await Promise.all([
    teams.listTeams(req.event.id),
    draw.progress(req.event.id),
    drawOpen ? [] : draw.startProblems(req.event.id),
  ]);
  res.status(status).render('creator/draw', {
    title: '팀 뽑기', wide: true, teams: teamList, rows, problems, open: drawOpen, error,
  });
}

// 뽑기 화면의 POST는 모두 같은 방식으로 처리한다. 결과가 null이면 없는 참가자·팀이다
async function drawAction(req, res, action) {
  try {
    const result = await action();
    if (result === null) return notFound(res);
    res.redirect(manage(res, '/draw'));
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    await renderDraw(req, res, { error: err.message, status: 400 });
  }
}

router.get('/draw', (req, res) => renderDraw(req, res));
router.post('/draw/start', (req, res) => drawAction(req, res, () => draw.start(req.event.id)));
router.post('/draw/reset', (req, res) => drawAction(req, res, () => draw.reset(req.event.id, req.body.confirm)));
router.post('/draw/proxy/:participantId', (req, res) => drawAction(req, res, () => draw.open(req.event.id, req.params.participantId, 'proxy')));
router.post('/draw/move/:participantId', (req, res) => drawAction(req, res, () => draw.move(req.event.id, req.params.participantId, req.body.teamId)));

module.exports = router;
