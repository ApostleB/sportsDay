const { randomInt } = require('node:crypto');

const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pick(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

const generateSlug = () => pick(SLUG_ALPHABET, 8);
const generateAuthCode = () => pick(CODE_ALPHABET, 6);
const normalizeAuthCode = (value) => String(value ?? '').trim().toUpperCase();
const isPin4 = (value) => /^\d{4}$/.test(String(value ?? ''));
const isPin6 = (value) => /^\d{6}$/.test(String(value ?? ''));

module.exports = { generateSlug, generateAuthCode, normalizeAuthCode, isPin4, isPin6 };
