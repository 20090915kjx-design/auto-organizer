const fs = require('node:fs/promises');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { IMAGE_EXTENSIONS } = require('./constants');
const { cleanText } = require('./utils');

let ocrWorkerPromise = null;

async function ensureOcrData(cacheDir) {
  const modelDir = path.join(cacheDir, 'models');
  await fs.mkdir(modelDir, { recursive: true });
  const languagePackages = [
    require('@tesseract.js-data/chi_sim'),
    require('@tesseract.js-data/eng')
  ];
  for (const language of languagePackages) {
    const source = path.join(language.langPath, `${language.code}.traineddata.gz`);
    const target = path.join(modelDir, `${language.code}.traineddata.gz`);
    try {
      await fs.access(target);
    } catch {
      await fs.copyFile(source, target);
    }
  }
  return modelDir;
}

async function getOcrWorker(cacheDir) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const langPath = await ensureOcrData(cacheDir);
      return createWorker(['chi_sim', 'eng'], 1, {
        langPath,
        cachePath: path.join(cacheDir, 'cache'),
        gzip: true,
        logger: () => {}
      });
    })().catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
}

async function terminateOcrWorker() {
  if (!ocrWorkerPromise) return;
  const worker = await ocrWorkerPromise;
  await worker.terminate();
  ocrWorkerPromise = null;
}

async function recognizeImage(input, cacheDir) {
  const worker = await getOcrWorker(cacheDir);
  const result = await worker.recognize(input);
  return cleanText(result.data.text);
}

async function extractPdf(filePath, cacheDir) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    let text = cleanText(result.text);
    if (text.length < 40) {
      const screenshots = await parser.getScreenshot({ first: 3, desiredWidth: 1600 });
      const pages = [];
      for (const page of screenshots.pages) {
        pages.push(await recognizeImage(page.data, cacheDir));
      }
      text = cleanText(pages.join('\n\n'));
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

async function extractWord(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanText(result.value);
}

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (value.result !== undefined) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
  }
  return String(value);
}

async function extractWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const output = [];
  for (const worksheet of workbook.worksheets) {
    output.push(`工作表：${worksheet.name}`);
    let cellCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (cellCount >= 10000) return;
      const values = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cellCount < 10000) values.push(cellText(cell));
        cellCount += 1;
      });
      output.push(values.join('\t'));
    });
  }
  return cleanText(output.join('\n'));
}

function decodeQuotedPrintable(value) {
  const joined = value.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let index = 0; index < joined.length; index += 1) {
    if (joined[index] === '=' && /^[0-9A-F]{2}$/i.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(joined.charCodeAt(index));
    }
  }
  return Buffer.from(bytes);
}

function decodeMimeHeader(value) {
  return String(value || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]+)\?=/g, (_match, charset, encoding, data) => {
    try {
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : decodeQuotedPrintable(data.replace(/_/g, ' '));
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

function parseHeaders(block) {
  const unfolded = block.replace(/\r?\n[\t ]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    headers[line.slice(0, separator).toLowerCase()] = decodeMimeHeader(line.slice(separator + 1).trim());
  }
  return headers;
}

function decodeEmailPart(body, headers) {
  const transfer = (headers['content-transfer-encoding'] || '').toLowerCase();
  let bytes;
  if (transfer === 'base64') bytes = Buffer.from(body.replace(/\s/g, ''), 'base64');
  else if (transfer === 'quoted-printable') bytes = decodeQuotedPrintable(body);
  else bytes = Buffer.from(body, 'utf8');
  const charset = headers['content-type']?.match(/charset=["']?([^;"']+)/i)?.[1] || 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

async function extractEmail(filePath) {
  const raw = (await fs.readFile(filePath)).toString('utf8');
  const splitAt = raw.search(/\r?\n\r?\n/);
  const headers = parseHeaders(splitAt >= 0 ? raw.slice(0, splitAt) : raw);
  const body = splitAt >= 0 ? raw.slice(splitAt).replace(/^\r?\n\r?\n/, '') : '';
  const boundary = headers['content-type']?.match(/boundary=["']?([^;"']+)/i)?.[1];
  const textParts = [];
  const parts = boundary ? body.split(`--${boundary}`) : [body];
  for (const part of parts) {
    const partSplit = part.search(/\r?\n\r?\n/);
    const partHeaders = partSplit >= 0 ? parseHeaders(part.slice(0, partSplit)) : headers;
    const partBody = partSplit >= 0 ? part.slice(partSplit).replace(/^\r?\n\r?\n/, '') : part;
    const contentType = partHeaders['content-type'] || headers['content-type'] || 'text/plain';
    const disposition = partHeaders['content-disposition'] || '';
    if (/attachment/i.test(disposition) || !/^text\/(plain|html)/i.test(contentType)) continue;
    const decoded = decodeEmailPart(partBody, partHeaders);
    textParts.push(/^text\/html/i.test(contentType) ? readableHtml(decoded) : decoded);
  }
  return cleanText([
    `主题：${headers.subject || ''}`,
    `发件人：${headers.from || ''}`,
    `收件人：${headers.to || ''}`,
    `日期：${headers.date || ''}`,
    textParts.join('\n')
  ].join('\n'));
}

function readableHtml(html, url = 'https://local.invalid/') {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  return cleanText(article?.textContent || dom.window.document.body?.textContent || '');
}

async function extractFile(filePath, options) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return extractPdf(filePath, options.ocrCacheDir);
  if (extension === '.docx') return extractWord(filePath);
  if (['.xlsx', '.xlsm'].includes(extension)) return extractWorkbook(filePath);
  if (extension === '.eml') return extractEmail(filePath);
  if (['.html', '.htm'].includes(extension)) return readableHtml(await fs.readFile(filePath, 'utf8'));
  if (IMAGE_EXTENSIONS.has(extension)) return recognizeImage(filePath, options.ocrCacheDir);
  if (['.txt', '.md', '.csv'].includes(extension)) return cleanText(await fs.readFile(filePath, 'utf8'));
  throw new Error(`暂不支持 ${extension || '未知'} 格式`);
}

async function fetchWebPage(inputUrl) {
  const url = new URL(inputUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 http 或 https 网页链接');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'AutoOrganizer/0.1 (+local desktop application)' }
    });
    if (!response.ok) throw new Error(`网页返回 ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 10 * 1024 * 1024) throw new Error('网页内容超过 10MB 限制');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`不支持的网页内容类型：${contentType || '未知'}`);
    }
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > 10 * 1024 * 1024) throw new Error('网页内容超过 10MB 限制');
    const dom = new JSDOM(html, { url: response.url || url.toString() });
    const title = dom.window.document.title || url.hostname;
    const text = readableHtml(html, response.url || url.toString());
    return { title: cleanText(title), text, finalUrl: response.url || url.toString() };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  extractFile,
  fetchWebPage,
  readableHtml,
  recognizeImage,
  terminateOcrWorker
};
