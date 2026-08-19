const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { OrganizerDatabase } = require('./core/database');
const { DocumentIndexer } = require('./core/indexer');
const { exportReport } = require('./core/reporter');
const { terminateOcrWorker } = require('./core/document-extractor');

let mainWindow;
let database;
let indexer;

if (process.env.AUTO_ORGANIZER_SMOKE_DATA) {
  app.setPath('userData', process.env.AUTO_ORGANIZER_SMOKE_DATA);
}

async function captureSmokeScreens(window) {
  const outputDir = process.env.AUTO_ORGANIZER_SMOKE_DIR;
  if (!outputDir) return;
  await fs.mkdir(outputDir, { recursive: true });
  const dashboard = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, 'dashboard.png'), dashboard.toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('[data-view="documents"]').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const documents = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, 'documents.png'), documents.toPNG());
  await window.webContents.executeJavaScript(`document.querySelector('[data-view="settings"]').click()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const settings = await window.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, 'settings.png'), settings.toPNG());
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#f4f1ea',
    title: '自动整理',
    show: !process.env.AUTO_ORGANIZER_SMOKE_DIR,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.env.AUTO_ORGANIZER_SMOKE_DIR) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => captureSmokeScreens(mainWindow).catch((error) => {
        console.error(error);
        app.exit(1);
      }), 500);
    });
  }
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function registerHandlers() {
  ipcMain.handle('dashboard:get', () => database.summary());
  ipcMain.handle('documents:list', (_event, filters) => database.listDocuments(filters || {}));
  ipcMain.handle('customers:list', () => database.listCustomers());
  ipcMain.handle('settings:get', () => database.getSettings());
  ipcMain.handle('settings:save', (_event, patch) => {
    const allowed = {};
    if (patch.amountThreshold !== undefined) allowed.amountThreshold = Math.max(0, Number(patch.amountThreshold));
    if (patch.expiryWarningDays !== undefined) allowed.expiryWarningDays = Math.max(1, Math.min(3650, Number(patch.expiryWarningDays)));
    if (patch.localModelEnabled !== undefined) allowed.localModelEnabled = Boolean(patch.localModelEnabled);
    if (patch.localModelName !== undefined) allowed.localModelName = String(patch.localModelName).slice(0, 100);
    return database.saveSettings(allowed);
  });

  ipcMain.handle('import:files', async (event) => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择要整理的材料',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '支持的文档', extensions: ['pdf', 'docx', 'xlsx', 'xlsm', 'csv', 'txt', 'md', 'html', 'htm', 'eml', 'png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'] }]
    });
    if (selection.canceled) return [];
    return indexer.importPaths(selection.filePaths, (progress) => event.sender.send('import:progress', progress));
  });

  ipcMain.handle('import:folder', async (event) => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: '选择材料文件夹（也可选择 Google Drive 或 SharePoint 同步文件夹）',
      properties: ['openDirectory']
    });
    if (selection.canceled) return [];
    return indexer.importPaths(selection.filePaths, (progress) => event.sender.send('import:progress', progress));
  });

  ipcMain.handle('import:url', async (_event, url) => indexer.importUrl(String(url || '').trim()));

  ipcMain.handle('document:manual-priority', (_event, documentId, enabled) => (
    database.setManualPriority(Number(documentId), Boolean(enabled))
  ));

  ipcMain.handle('customer:add-alias', (_event, customerId, alias) => {
    const cleanAlias = String(alias || '').trim();
    if (!cleanAlias) throw new Error('别名不能为空');
    const { normalizeIdentity } = require('./core/utils');
    database.addAlias(Number(customerId), cleanAlias, normalizeIdentity(cleanAlias));
    return true;
  });

  ipcMain.handle('report:export', async () => {
    const defaultName = `自动整理统计报表-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const target = await dialog.showSaveDialog(mainWindow, {
      title: '导出统计报表',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    });
    if (target.canceled || !target.filePath) return '';
    return exportReport(database, target.filePath);
  });

  ipcMain.handle('source:open', async (_event, source) => {
    const value = String(source || '');
    if (/^https?:\/\//i.test(value)) {
      await shell.openExternal(value);
      return '';
    }
    return shell.openPath(value);
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('cn.autoorganizer.desktop');
  const dataDir = app.getPath('userData');
  database = new OrganizerDatabase(path.join(dataDir, 'organizer.db'));
  indexer = new DocumentIndexer(database, { ocrCacheDir: path.join(dataDir, 'ocr') });
  registerHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  terminateOcrWorker().catch(() => {});
  database?.close();
});
