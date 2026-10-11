const format = require('../services/format');

function applyLocals(req, res) {
  Object.assign(res.locals, {
    title: '명량운동회',
    wide: false,
    error: null,
    message: null,
    isAdmin: Boolean(req.session?.admin),
    participant: null,
    isCreator: false,
    event: null,
    base: '',
    values: {},
    ...format,
  });
}

function locals(req, res, next) {
  applyLocals(req, res);
  next();
}

module.exports = { locals, applyLocals };
