const { randomUUID } = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { ValidationError } = require('../services/errors');

const EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const scheduleUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${randomUUID()}${EXTENSIONS[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXTENSIONS[file.mimetype]) return cb(null, true);
    cb(new ValidationError('jpg, png, webp, gif 이미지만 올릴 수 있습니다'));
  },
});

module.exports = { scheduleUpload };
