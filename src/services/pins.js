const bcrypt = require('bcrypt');
const config = require('../config');

const hashPin = (pin) => bcrypt.hash(String(pin), config.bcryptRounds);
const comparePin = (pin, hash) => bcrypt.compare(String(pin), hash);

module.exports = { hashPin, comparePin };
