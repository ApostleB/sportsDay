const format = require('../services/format');

function locals(req, res, next) {
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
  next();
}

module.exports = { locals };
