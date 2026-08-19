const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('organizer', {
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  listDocuments: (filters) => ipcRenderer.invoke('documents:list', filters),
  listCustomers: () => ipcRenderer.invoke('customers:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  importFiles: () => ipcRenderer.invoke('import:files'),
  importFolder: () => ipcRenderer.invoke('import:folder'),
  importUrl: (url) => ipcRenderer.invoke('import:url', url),
  setManualPriority: (documentId, enabled) => ipcRenderer.invoke('document:manual-priority', documentId, enabled),
  addCustomerAlias: (customerId, alias) => ipcRenderer.invoke('customer:add-alias', customerId, alias),
  exportReport: () => ipcRenderer.invoke('report:export'),
  openSource: (source) => ipcRenderer.invoke('source:open', source),
  onImportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('import:progress', listener);
    return () => ipcRenderer.removeListener('import:progress', listener);
  }
});
