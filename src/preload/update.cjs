const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_PROGRESS_CHANNEL = 'update:progress';
const UPDATE_CANCEL_CHANNEL = 'update:cancel';

function isUpdateProgressPage() {
  try {
    const pageUrl = new URL(globalThis.location.href);
    return pageUrl.protocol === 'vk-desktop:'
      && pageUrl.hostname === 'local'
      && pageUrl.pathname === '/update-progress.html'
      && !pageUrl.username
      && !pageUrl.password
      && !pageUrl.port
      && !pageUrl.search
      && !pageUrl.hash;
  } catch {
    return false;
  }
}

if (isUpdateProgressPage()) {
  contextBridge.exposeInMainWorld('updateProgress', {
    onProgress(callback) {
      if (typeof callback !== 'function') return;
      ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, (_event, payload) => callback(payload));
    },
    cancel() {
      ipcRenderer.send(UPDATE_CANCEL_CHANNEL);
    }
  });
}
