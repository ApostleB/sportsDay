function maskName(name) {
  const chars = Array.from(String(name ?? ''));
  if (chars.length === 0) return '';
  if (chars.length === 1) return '*';
  if (chars.length === 2) return `${chars[0]}*`;
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
}

module.exports = { maskName };
