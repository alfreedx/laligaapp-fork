// ✅ preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  apiRequest: (options) => ipcRenderer.invoke('api-request', options),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Interactive OAuth (Google/social) login — opens a controlled login window
  // and resolves with the captured authorization code.
  startOAuthLogin: (config) => ipcRenderer.invoke('start-oauth-login', config),

  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  getServerAddresses: () => ipcRenderer.invoke('get-server-addresses'),

  getAppVersion: () => process.env.npm_package_version || '1.0.0',
  isElectron: () => true,
  isDev: () => process.env.NODE_ENV === 'development',

  // Token persistence methods
  getAppDataPath: () => ipcRenderer.invoke('get-app-data-path'),
  savePersistentFile: (filePath, data) => ipcRenderer.invoke('save-persistent-file', filePath, data),
  loadPersistentFile: (filePath) => ipcRenderer.invoke('load-persistent-file', filePath),
  deletePersistentFile: (filePath) => ipcRenderer.invoke('delete-persistent-file', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),

  // Fork: automatización diaria (informe a Drive, auto-mercado)
  automation: {
    getConfig: () => ipcRenderer.invoke('automation:get-config'),
    chooseExportDir: () => ipcRenderer.invoke('automation:choose-export-dir'),
    openExportDir: () => ipcRenderer.invoke('automation:open-export-dir'),
    writeExport: (files) => ipcRenderer.invoke('automation:write-export', files),
    writePdf: (name, html) => ipcRenderer.invoke('automation:write-pdf', { name, html }),
    notify: (title, body) => ipcRenderer.invoke('automation:notify', { title, body }),
    dailyRunFinished: (reason) => ipcRenderer.invoke('automation:daily-run-finished', reason),
    scheduleMatchdaySummary: (at) => ipcRenderer.invoke('automation:schedule-matchday-summary', at),
    scheduleClauseReminders: (times) => ipcRenderer.invoke('automation:schedule-clause-reminders', times),
    log: (level, source, message) => ipcRenderer.invoke('automation:log', { level, source, message }),
    readLog: (lines) => ipcRenderer.invoke('automation:read-log', lines),
    onRunNow: (cb) => {
      const sub = (_e, d) => cb(d);
      ipcRenderer.on('automation:run-now', sub);
      return () => ipcRenderer.removeListener('automation:run-now', sub);
    },
  },

  // Fork: Telegram (la clave del bot nunca vuelve al renderer)
  telegram: {
    getConfig: () => ipcRenderer.invoke('telegram:get-config'),
    setToken: (token) => ipcRenderer.invoke('telegram:set-token', token),
    detectChat: () => ipcRenderer.invoke('telegram:detect-chat'),
    sendMessage: (text) => ipcRenderer.invoke('telegram:send-message', text),
    sendDocument: (name, caption) => ipcRenderer.invoke('telegram:send-document', { name, caption }),
    sendFile: (name, content, caption) => ipcRenderer.invoke('telegram:send-file', { name, content, caption }),
    startBot: () => ipcRenderer.invoke('telegram:start-bot'),
    onCommand: (cb) => {
      const sub = (_e, d) => cb(d);
      ipcRenderer.on('telegram:command', sub);
      return () => ipcRenderer.removeListener('telegram:command', sub);
    },
  },

  // ✅ fixed logger
  log: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(...args);
    }
  }
});

