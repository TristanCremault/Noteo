// on remplira ce fichier à l'étape suivante
// (pont sécurisé entre l'interface et le système de fichiers)

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getBackgrounds: () => ipcRenderer.invoke('get-backgrounds'),
  getBackgroundFull: (name) => ipcRenderer.invoke('get-background-full', name),
  openBackgroundsFolder: () => ipcRenderer.invoke('open-backgrounds-folder'),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  saveAccountBackup: (data) => ipcRenderer.invoke('save-account-backup', data),
  loadAccountBackup: () => ipcRenderer.invoke('load-account-backup'),
  deleteAccountBackup: () => ipcRenderer.invoke('delete-account-backup'),
  exportNote: (title, htmlContent) => ipcRenderer.invoke('export-note', { title, htmlContent }),
  importPdf: () => ipcRenderer.invoke('import-pdf'),
  getFirstRunSetup: () => ipcRenderer.invoke('get-first-run-setup'),
  copyImage: (dataUrl, html) => ipcRenderer.invoke('copy-image', { dataUrl, html }),
  readClipboardImage: () => ipcRenderer.invoke('read-clipboard-image'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen')
});
