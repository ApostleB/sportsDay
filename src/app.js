const path = require('node:path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');
const config = require('./config');
const { pool } = require('./db');
const { locals, applyLocals } = require('./middleware/locals');

function createApp() {
  const app = express();
  if (config.isProd) app.set('trust proxy', 1);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layout');

  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(config.uploadDir));
  app.use(express.urlencoded({ extended: false }));
  // Express 5는 본문이 없으면 req.body가 undefined다
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(session({
    store: new PgStore({ pool, tableName: 'session', pruneSessionInterval: config.isTest ? false : 60 * 15 }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 30 * 24 * 60 * 60 * 1000 },
  }));
  app.use(locals);

  app.use('/', require('./routes/public'));
  app.use('/e/:slug', require('./routes/participant'));

  app.use((req, res) => {
    res.status(404).render('error', { title: '찾을 수 없습니다', status: 404, message: '요청한 페이지가 없습니다' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    // locals 미들웨어 이전에 난 오류(본문 파싱 등)는 뷰 기본값이 없다
    if (res.locals.wide === undefined) applyLocals(req, res);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).render('error', {
      title: '오류',
      status,
      message: status < 500
        ? '요청을 처리할 수 없습니다'
        : config.isProd ? '서버 오류가 발생했습니다' : err.message,
    });
  });

  return app;
}

module.exports = { createApp };
