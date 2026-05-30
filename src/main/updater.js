/**
 * VK Desktop Auto-Updater
 * @version 1.2.0
 */
import { dialog, app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import logger from 'electron-log';

const { autoUpdater } = electronUpdater;

logger.transports.file.level = 'info';
autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

let isInit = false;
let isManualCheck = false;
let isDownloading = false;
let progressWindow = null;
let checkTimeout = null;
let downloadTimeout = null;

const CONFIG = Object.freeze({
  CHECK_TIMEOUT: 30000,
  DOWNLOAD_TIMEOUT: 600000,
  RETRY_DELAY: 60000
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').trim();
}

function clearTimeouts() {
  if (checkTimeout) { clearTimeout(checkTimeout); checkTimeout = null; }
  if (downloadTimeout) { clearTimeout(downloadTimeout); downloadTimeout = null; }
}

function createProgressWindow(parentWindow, updateInfo) {
  if (!parentWindow || parentWindow.isDestroyed()) return null;
  
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.focus();
    return progressWindow;
  }

  try {
    progressWindow = new BrowserWindow({
      width: 450, height: 200,
      parent: parentWindow,
      modal: true,
      resizable: false, minimizable: false, maximizable: false,
      show: false, frame: false,
      backgroundColor: '#19191a',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    
    progressWindow.on('close', (e) => {
      if (isDownloading) {
        e.preventDefault();
        dialog.showMessageBox(progressWindow, {
          type: 'question',
          title: 'Отмена',
          message: 'Отменить загрузку?',
          buttons: ['Да', 'Нет']
        }).then(({ response }) => {
          if (response === 0) {
            isDownloading = false;
            closeProgressWindow();
          }
        });
      }
    });
  } catch (error) {
    return null;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { background: #19191a; color: #e1e3e6; font-family: sans-serif; padding: 20px; user-select: none; -webkit-app-region: drag; overflow: hidden; }
        .bar-bg { background: #2d2d2e; height: 8px; border-radius: 4px; margin: 15px 0; overflow: hidden; }
        .bar-fill { height: 100%; background: #0077ff; width: 0%; transition: width 0.3s; }
        .info { display: flex; justify-content: space-between; font-size: 13px; color: #828282; }
      </style>
    </head>
    <body>
      <h3>Загрузка обновления v${updateInfo.version}</h3>
      <div class="bar-bg"><div class="bar-fill" id="p"></div></div>
      <div class="info"><span id="t">0%</span><span id="s">--</span></div>
      <script>
        window.upd = (d) => {
          document.getElementById('p').style.width = d.p + '%';
          document.getElementById('t').innerText = Math.round(d.p) + '%';
          document.getElementById('s').innerText = d.s;
        };
      </script>
    </body></html>`;

  progressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  progressWindow.once('ready-to-show', () => progressWindow.show());
  return progressWindow;
}

function updateProgressWindow(progressObj) {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  const percent = progressObj.percent || 0;
  const speed = formatBytes(progressObj.bytesPerSecond || 0) + '/s';
  
  progressWindow.webContents.executeJavaScript(
    `window.upd && window.upd({p:${percent},s:'${speed}'})`
  ).catch(() => {});
}

function closeProgressWindow() {
  clearTimeouts();
  isDownloading = false;
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
  progressWindow = null;
}

export function initAutoUpdater(mainWindow) {
  if (isInit) return;
  isInit = true;

  autoUpdater.on('update-available', async (info) => {
    clearTimeouts();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Обновление',
      message: `Доступна версия ${info.version}`,
      detail: stripHtml(info.releaseNotes ? (typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes[0].note) : 'Исправления ошибок'),
      buttons: ['Скачать', 'Позже'],
      defaultId: 0
    });
    
    if (response === 0) {
      createProgressWindow(mainWindow, info);
      isDownloading = true;
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('download-progress', (p) => {
    updateProgressWindow(p);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(p.percent / 100);
  });

  autoUpdater.on('update-downloaded', async () => {
    closeProgressWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Готово',
        message: 'Обновление загружено',
        buttons: ['Перезапустить', 'Позже']
      });
      if (response === 0) autoUpdater.quitAndInstall();
    }
  });
  
  autoUpdater.on('error', () => {
    closeProgressWindow();
    if (isManualCheck && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Ошибка', 'Не удалось проверить обновления');
    }
    isManualCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    if (isManualCheck && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, { message: 'У вас последняя версия', buttons: ['ОК'] });
    }
    isManualCheck = false;
  });
}

export function manualCheck(mainWindow) {
  if (!isInit) initAutoUpdater(mainWindow);
  if (isManualCheck || isDownloading) return;
  
  isManualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {
    isManualCheck = false;
  });
}