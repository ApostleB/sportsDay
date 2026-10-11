const path = require('node:path');

require('dotenv').config({ quiet: true, path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });

const isTest = process.env.NODE_ENV === 'test';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name}이(가) 필요합니다`);
  return value;
}

if (isTest && process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL이 DATABASE_URL과 같습니다');
}

module.exports = {
  isTest,
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  databaseUrl: required(isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  adminPassword: required('ADMIN_PASSWORD'),
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, 'public', 'uploads'),
  bcryptRounds: isTest ? 4 : 10,
};
