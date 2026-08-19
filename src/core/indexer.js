const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { analyzeDocument } = require('./analyzer');
const { matchOrCreateCustomer } = require('./customer-matcher');
const { extractFile, fetchWebPage } = require('./document-extractor');
const { isSupported } = require('./constants');
const { sha256File } = require('./utils');

class DocumentIndexer {
  constructor(database, options) {
    this.database = database;
    this.options = options;
  }

  async collectFiles(rootPath) {
    const files = [];
    const queue = [rootPath];
    while (queue.length) {
      const current = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) queue.push(fullPath);
        else if (entry.isFile() && isSupported(fullPath)) files.push(fullPath);
      }
    }
    return files;
  }

  async importPaths(paths, onProgress = () => {}) {
    const expanded = [];
    for (const inputPath of paths) {
      const stat = await fs.stat(inputPath);
      if (stat.isDirectory()) expanded.push(...await this.collectFiles(inputPath));
      else if (isSupported(inputPath)) expanded.push(inputPath);
    }
    const results = [];
    for (let index = 0; index < expanded.length; index += 1) {
      const filePath = expanded[index];
      onProgress({ current: index + 1, total: expanded.length, name: path.basename(filePath) });
      try {
        results.push(await this.importFile(filePath));
      } catch (error) {
        results.push({ status: 'error', source: filePath, error: error.message });
      }
    }
    return results;
  }

  async importFile(filePath) {
    const stat = await fs.stat(filePath);
    const contentHash = await sha256File(filePath);
    const duplicate = this.database.documentByHash(contentHash);
    if (duplicate) return { status: 'duplicate', source: filePath, documentId: duplicate.id };
    const text = await extractFile(filePath, { ocrCacheDir: this.options.ocrCacheDir });
    if (!text) throw new Error('没有识别到可索引的文字');
    const settings = this.database.getSettings();
    const analysis = await analyzeDocument(text, { sourceType: 'file', filePath }, settings);
    const customer = matchOrCreateCustomer(this.database, analysis);
    const documentId = this.database.insertDocument({
      contentHash,
      sourceType: 'file',
      sourceUri: filePath,
      originalName: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      fileSize: stat.size,
      fileModifiedAt: stat.mtime.toISOString(),
      customerId: customer?.id || null,
      ...analysis,
      status: analysis.modelWarning ? 'warning' : 'ready',
      error: analysis.modelWarning || ''
    });
    return { status: 'imported', source: filePath, documentId };
  }

  async importUrl(inputUrl) {
    const page = await fetchWebPage(inputUrl);
    if (!page.text) throw new Error('网页没有可索引的正文');
    const contentHash = crypto.createHash('sha256').update(page.finalUrl).update('\0').update(page.text).digest('hex');
    const duplicate = this.database.documentByHash(contentHash);
    if (duplicate) return { status: 'duplicate', source: inputUrl, documentId: duplicate.id };
    const settings = this.database.getSettings();
    const analysis = await analyzeDocument(page.text, { sourceType: 'url', url: page.finalUrl }, settings);
    const customer = matchOrCreateCustomer(this.database, analysis);
    const documentId = this.database.insertDocument({
      contentHash,
      sourceType: 'url',
      sourceUri: page.finalUrl,
      originalName: page.title || page.finalUrl,
      extension: '.html',
      fileSize: Buffer.byteLength(page.text, 'utf8'),
      fileModifiedAt: '',
      customerId: customer?.id || null,
      ...analysis,
      status: analysis.modelWarning ? 'warning' : 'ready',
      error: analysis.modelWarning || ''
    });
    return { status: 'imported', source: page.finalUrl, documentId };
  }
}

module.exports = { DocumentIndexer };
