const crypto = require('node:crypto');
const fs = require('node:fs');

function cleanText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s·•・.,，。()（）\[\]【】_-]+/g, '')
    .replace(/有限责任公司|股份有限公司|有限公司/g, '公司')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function asIsoDate(value) {
  if (!value) return '';
  const normalized = String(value)
    .replace(/[年/.]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .trim();
  const match = normalized.match(/(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})/);
  if (!match) return '';
  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? '' : iso;
}

function isLoopbackUrl(input) {
  try {
    const url = new URL(input);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  asIsoDate,
  cleanText,
  isLoopbackUrl,
  normalizeIdentity,
  safeJsonParse,
  sha256File,
  unique
};
