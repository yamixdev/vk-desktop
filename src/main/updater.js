/**
 * VK Desktop Auto-Updater
 * electron-updater wrapper с UI прогресса
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
  INITIAL_CHECK_DELAY: 5000,
  RETRY_DELAY: 60000
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bps) {
  if (bps === 0) return '0 КБ/с';
  const k = 1024;
  if (bps < k) return bps.toFixed(0) + ' Б/с';
  if (bps < k * k) return (bps / k).toFixed(1) + ' КБ/с';
  return (bps / k / k).toFixed(1) + ' МБ/с';
}

function formatTime(seconds) {
  if (!seconds || seconds === Infinity || seconds < 0) return 'вычисляется...';
  if (seconds < 60) return `${Math.round(seconds)} сек`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} сек`;
  return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clearTimeouts() {
  if (checkTimeout) {
    clearTimeout(checkTimeout);
    checkTimeout = null;
  }
  if (downloadTimeout) {
    clearTimeout(downloadTimeout);
    downloadTimeout = null;
  }
}

function createProgressWindow(parentWindow, updateInfo) {
  if (!parentWindow || parentWindow.isDestroyed()) return null;
  
  if (progressWindow && !progressWindow.isDestroyed()) {
    try {
      progressWindow.focus();
      return progressWindow;
    } catch (e) {
      progressWindow = null;
    }
  }

  try {
    progressWindow = new BrowserWindow({
      width: 450,
      height: 200,
      parent: parentWindow,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      show: false,
      frame: false,
      transparent: false,
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
          title: 'Отмена загрузки',
          message: 'Отменить загрузку обновления?',
          buttons: ['Продолжить загрузку', 'Отменить'],
          defaultId: 0,
          cancelId: 1
        }).then(({ response }) => {
          if (response === 1) {
            try {
              autoUpdater.removeAllListeners('download-progress');
            } catch (err) {}
            isDownloading = false;
            closeProgressWindow();
          }
        }).catch(() => {});
      }
    });
  } catch (error) {
    console.error('[Updater] Failed to create progress window:', error.message);
    return null;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #19191a;
          color: #e1e3e6;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 24px;
          user-select: none;
          -webkit-app-region: drag;
        }
        h2 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .version { color: #0077ff; font-weight: 500; }
        .progress-container {
          background: #2d2d2e;
          border-radius: 8px;
          height: 8px;
          overflow: hidden;
          margin: 16px 0;
        }
        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #0077ff, #00aaff);
          width: 0%;
          transition: width 0.3s ease;
          border-radius: 8px;
        }
        .stats {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #828282;
        }
        .stats-left { display: flex; gap: 16px; }
        .percent {
          color: #e1e3e6;
          font-weight: 600;
          font-size: 24px;
          margin-top: 12px;
        }
        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #3d3d3e;
          border-top-color: #0077ff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .bottom {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
      </style>
    </head>
    <body>
      <h2>
        <div class="spinner"></div>
        Загрузка обновления <span class="version">v${updateInfo.version}</span>
      </h2>
      <div class="progress-container">
        <div class="progress-bar" id="progressBar"></div>
      </div>
      <div class="stats">
        <div class="stats-left">
          <span id="downloaded">0 МБ</span>
          <span>/</span>
          <span id="total">-- МБ</span>
        </div>
        <span id="speed">-- КБ/с</span>
      </div>
      <div class="bottom">
        <div class="percent" id="percent">0%</div>
        <div>
          <span id="eta" style="color: #828282; font-size: 13px; margin-right: 12px;">Осталось: вычисляется...</span>
        </div>
      </div>
      <script>
        window.updateProgress = function(data) {
          document.getElementById('progressBar').style.width = data.percent + '%';
          document.getElementById('percent').textContent = Math.round(data.percent) + '%';
          document.getElementById('downloaded').textContent = data.transferred;
          document.getElementById('total').textContent = data.total;
          document.getElementById('speed').textContent = data.speed;
          document.getElementById('eta').textContent = 'Осталось: ' + data.eta;
        };
      </script>
    </body>
    </html>
  `;

  progressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  progressWindow.once('ready-to-show', () => progressWindow.show());

  return progressWindow;
}

function updateProgressWindow(progressObj) {
  if (!progressWindow || progressWindow.isDestroyed()) return;

  try {
    const data = {
      percent: Math.min(100, Math.max(0, progressObj.percent || 0)),
      transferred: formatBytes(progressObj.transferred || 0),
      total: formatBytes(progressObj.total || 0),
      speed: formatSpeed(progressObj.bytesPerSecond || 0),
      eta: formatTime(
        progressObj.bytesPerSecond > 0
          ? (progressObj.total - progressObj.transferred) / progressObj.bytesPerSecond
          : Infinity
      )
    };

    if (progressWindow.webContents && !progressWindow.webContents.isDestroyed()) {
      progressWindow.webContents.executeJavaScript(
        `window.updateProgress && window.updateProgress(${JSON.stringify(data)})`
      ).catch(() => {});
    }
  } catch (e) {}
}

function closeProgressWindow() {
  clearTimeouts();
  isDownloading = false;
  
  if (progressWindow) {
    try {
      if (!progressWindow.isDestroyed()) progressWindow.close();
    } catch (e) {}
    progressWindow = null;
  }
}

export function initAutoUpdater(mainWindow) {
  if (isInit) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  isInit = true;
  console.log('[Updater] Initializing...');
  autoUpdater.removeAllListeners();

  autoUpdater.on('update-available', async (info) => {
    clearTimeouts();
    console.log(`[Updater] New version: ${info.version}`);
    
    if (!mainWindow || mainWindow.isDestroyed()) {
      isManualCheck = false;
      return;
    }
    
    try {
      let releaseNotes = '';
      if (info.releaseNotes) {
        releaseNotes = stripHtml(
          typeof info.releaseNotes === 'string'
            ? info.releaseNotes
            : info.releaseNotes.map(n => n.note || n).join('\n')
        );
      }
      
      if (releaseNotes.length > 500) releaseNotes = releaseNotes.substring(0, 500) + '...';
      if (!releaseNotes) releaseNotes = 'Улучшения производительности и исправления ошибок.';

      let size = 'неизвестен';
      try {
        if (info.files && info.files[0] && info.files[0].size) {
          size = formatBytes(info.files[0].size);
        }
      } catch (e) {}

      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Доступно обновление',
        message: `Новая версия ${info.version} готова к установке!`,
        detail: `Размер: ${size}\n\nЧто нового:\n${releaseNotes}\n\nХотите скачать обновление?`,
        buttons: ['Скачать', 'Напомнить позже'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      
      if (response === 0) {
        createProgressWindow(mainWindow, info);
        
        downloadTimeout = setTimeout(() => {
          console.warn('[Updater] Download timeout');
          closeProgressWindow();
          
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(-1);
            dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Таймаут',
              message: 'Загрузка обновления заняла слишком много времени.',
              detail: 'Попробуйте позже или проверьте подключение к интернету.',
              buttons: ['ОК']
            }).catch(() => {});
          }
        }, CONFIG.DOWNLOAD_TIMEOUT);
        
        isDownloading = true;
        
        autoUpdater.downloadUpdate().catch(err => {
          console.error('[Updater] Download failed:', err.message);
          closeProgressWindow();
        });
      }
    } catch (error) {
      console.error('[Updater] Dialog error:', error.message);
    }
    
    isManualCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    clearTimeouts();
    console.log('[Updater] No updates');
    
    if (isManualCheck && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Обновлений нет',
        message: 'У вас установлена последняя версия.',
        detail: `Текущая версия: ${app.getVersion()}`,
        buttons: ['ОК'],
        noLink: true
      }).catch(() => {});
    }
    
    isManualCheck = false;
  });

  autoUpdater.on('error', (err) => {
    clearTimeouts();
    const msg = err?.message || err?.toString() || 'Unknown error';
    console.error('[Updater] Error:', msg);
    
    closeProgressWindow();
    isDownloading = false;
    
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    } catch (e) {}
    
    if (isManualCheck && mainWindow && !mainWindow.isDestroyed()) {
      let userMessage = 'Не удалось проверить обновления.';
      let detail = msg;
      
      if (msg.includes('net::')) {
        userMessage = 'Нет подключения к серверу обновлений.';
        detail = 'Проверьте подключение к интернету.';
      } else if (msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT')) {
        userMessage = 'Сервер обновлений недоступен.';
        detail = 'Попробуйте позже.';
      } else if (msg.includes('404')) {
        userMessage = 'Обновления не найдены.';
        detail = 'Возможно, новая версия ещё не опубликована.';
      }
      
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка обновления',
        message: userMessage,
        detail: detail,
        buttons: ['ОК']
      }).catch(() => {});
    }
    
    isManualCheck = false;
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
      downloadTimeout = setTimeout(() => {
        console.warn('[Updater] Download stalled');
        closeProgressWindow();
      }, CONFIG.DOWNLOAD_TIMEOUT);
    }
    
    try {
      updateProgressWindow(progressObj);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        const progress = Math.min(1, Math.max(0, (progressObj.percent || 0) / 100));
        mainWindow.setProgressBar(progress);
      }
      
      const percent = (progressObj.percent || 0).toFixed(1);
      if (percent % 10 < 0.5 || progressObj.percent > 99) {
        console.log(`[Updater] ${percent}% @ ${formatSpeed(progressObj.bytesPerSecond || 0)}`);
      }
    } catch (error) {
      console.warn('[Updater] Progress error:', error.message);
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    clearTimeouts();
    isDownloading = false;
    console.log('[Updater] Downloaded');
    
    closeProgressWindow();
    
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setProgressBar(-1);
    } catch (e) {}
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Готово к установке',
          message: `Версия ${info.version} скачана!`,
          detail: 'Приложение будет перезапущено для завершения установки.',
          buttons: ['Перезапустить сейчас', 'Позже'],
          defaultId: 0,
          cancelId: 1
        });
        
        if (response === 0) {
          setTimeout(() => {
            try {
              autoUpdater.quitAndInstall(false, true);
            } catch (e) {
              console.error('[Updater] quitAndInstall error:', e.message);
              app.relaunch();
              app.exit(0);
            }
          }, 100);
        }
      } catch (error) {
        console.error('[Updater] Install dialog error:', error.message);
      }
    }
  });

  if (app.isPackaged) {
    checkTimeout = setTimeout(() => {
      checkTimeout = null;
      console.log('[Updater] Checking for updates...');
      autoUpdater.checkForUpdates().catch(err => {
        console.warn('[Updater] Auto-check failed:', err.message);
      });
    }, CONFIG.INITIAL_CHECK_DELAY);
  } else {
    console.log('[Updater] Skipping update check in development mode');
  }
}

export function manualCheck(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  if (!isInit) {
    initAutoUpdater(mainWindow);
  }
  
  if (isManualCheck || isDownloading) return;
  
  isManualCheck = true;
  console.log('[Updater] Manual check');
  
  checkTimeout = setTimeout(() => {
    checkTimeout = null;
    if (isManualCheck) {
      isManualCheck = false;
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Таймаут',
          message: 'Проверка обновлений заняла слишком много времени.',
          detail: 'Попробуйте позже.',
          buttons: ['OK']
        }).catch(() => {});
      }
    }
  }, CONFIG.CHECK_TIMEOUT);
  
  autoUpdater.checkForUpdates().catch(err => {
    clearTimeouts();
    const msg = err?.message || 'Unknown error';
    console.error('[Updater] Manual check failed:', msg);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка проверки',
        message: 'Не удалось проверить обновления',
        detail: msg,
        buttons: ['OK']
      }).catch(() => {});
    }
    
    isManualCheck = false;
  });
}

export function resetUpdaterState() {
  clearTimeouts();
  isInit = false;
  isManualCheck = false;
  isDownloading = false;
  closeProgressWindow();
  autoUpdater.removeAllListeners();
}

export function getUpdaterStatus() {
  return {
    isInitialized: isInit,
    isChecking: isManualCheck,
    isDownloading: isDownloading,
    hasProgressWindow: progressWindow !== null && !progressWindow?.isDestroyed()
  };
}