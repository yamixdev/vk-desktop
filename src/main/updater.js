/**
 * Система автообновлений VK Desktop
 * Показывает прогресс загрузки с размером и скоростью
 *
 * @description Выполняется в Main Process
 * @version 2.1.0
 *
 * Улучшения:
 * - Защита от race conditions при инициализации
 * - Улучшенная обработка ошибок
 * - Таймауты для предотвращения зависаний
 * - Graceful degradation при ошибках
 */

import { dialog, app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import logger from 'electron-log';

const { autoUpdater } = electronUpdater;

// Настройка логгера
logger.transports.file.level = 'info';
autoUpdater.logger = logger;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowDowngrade = false;

// === СОСТОЯНИЕ ===
let isInit = false;
let isManualCheck = false;
let isDownloading = false;
let progressWindow = null;
let checkTimeout = null;
let downloadTimeout = null;

// Конфигурация
const UPDATER_CONFIG = Object.freeze({
  CHECK_TIMEOUT: 30000, // 30 сек на проверку обновлений
  DOWNLOAD_TIMEOUT: 600000, // 10 минут на скачивание
  INITIAL_CHECK_DELAY: 5000, // 5 сек задержка перед первой проверкой
  RETRY_DELAY: 60000 // 1 минута между повторными проверками
});

/**
 * Форматирование размера файла
 * @param {number} bytes - Размер в байтах
 * @returns {string} Форматированная строка
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Б';
  const k = 1024;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Форматирование скорости
 * @param {number} bytesPerSecond - Скорость в байтах/сек
 * @returns {string} Форматированная строка
 */
function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond === 0) return '0 КБ/с';
  const k = 1024;
  if (bytesPerSecond < k) return bytesPerSecond.toFixed(0) + ' Б/с';
  if (bytesPerSecond < k * k) return (bytesPerSecond / k).toFixed(1) + ' КБ/с';
  return (bytesPerSecond / k / k).toFixed(1) + ' МБ/с';
}

/**
 * Форматирование оставшегося времени
 * @param {number} seconds - Секунды
 * @returns {string} Форматированная строка
 */
function formatTime(seconds) {
  if (!seconds || seconds === Infinity || seconds < 0) return 'вычисляется...';
  if (seconds < 60) return `${Math.round(seconds)} сек`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} сек`;
  return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
}

/**
 * Очистка HTML тегов для отображения в диалоге
 * @param {string} html - HTML строка
 * @returns {string} Очищенный текст
 */
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

/**
 * Очистка таймаутов
 */
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

/**
 * Создает окно прогресса загрузки
 * @param {BrowserWindow} parentWindow - Родительское окно
 * @param {Object} updateInfo - Информация об обновлении
 * @returns {BrowserWindow|null}
 */
function createProgressWindow(parentWindow, updateInfo) {
  // Проверяем, что родительское окно валидно
  if (!parentWindow || parentWindow.isDestroyed()) {
    console.warn('[Updater] Cannot create progress window: parent is invalid');
    return null;
  }
  
  if (progressWindow && !progressWindow.isDestroyed()) {
    try {
      progressWindow.focus();
      return progressWindow;
    } catch (e) {
      // Окно было уничтожено между проверками
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
      closable: true, // Разрешаем закрытие для отмены загрузки
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
    
    // Обработка закрытия окна (отмена загрузки)
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
            // Отмена загрузки
            try {
              autoUpdater.removeAllListeners('download-progress');
              // К сожалению, electron-updater не поддерживает отмену загрузки напрямую
              // Просто закрываем окно
            } catch (err) {
              // Игнорируем ошибки
            }
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
        .version {
          color: #0077ff;
          font-weight: 500;
        }
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
        .stats-left {
          display: flex;
          gap: 16px;
        }
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
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .bottom {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cancel-btn {
          -webkit-app-region: no-drag;
          background: #3d3d3e;
          color: #e1e3e6;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          transition: background 0.2s;
        }
        .cancel-btn:hover {
          background: #4d4d4e;
        }
        .cancel-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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

/**
 * Обновляет окно прогресса
 * @param {Object} progressObj - Объект прогресса от electron-updater
 */
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

    // Проверяем, что webContents доступен
    if (progressWindow.webContents && !progressWindow.webContents.isDestroyed()) {
      progressWindow.webContents.executeJavaScript(
        `window.updateProgress && window.updateProgress(${JSON.stringify(data)})`
      ).catch(() => {});
    }
  } catch (e) {
    // Игнорируем ошибки обновления UI
  }
}

/**
 * Закрывает окно прогресса безопасно
 */
function closeProgressWindow() {
  clearTimeouts();
  isDownloading = false;
  
  if (progressWindow) {
    try {
      if (!progressWindow.isDestroyed()) {
        progressWindow.close();
      }
    } catch (e) {
      // Игнорируем ошибки закрытия
    }
    progressWindow = null;
  }
}

/**
 * Инициализирует систему автообновлений
 *
 * @description Выполняется в Main Process
 * @param {Electron.BrowserWindow} mainWindow - Главное окно приложения
 */
export function initAutoUpdater(mainWindow) {
  // Предотвращаем повторную инициализацию
  if (isInit) {
    console.log('[Updater] Already initialized');
    return;
  }
  
  // Проверяем валидность окна
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[Updater] Cannot initialize: main window is invalid');
    return;
  }
  
  isInit = true;
  console.log('[Updater] Initializing update system...');

  // Очищаем все старые слушатели для предотвращения утечек памяти
  autoUpdater.removeAllListeners();

  // === 1. ОБНОВЛЕНИЕ НАЙДЕНО ===
  autoUpdater.on('update-available', async (info) => {
    clearTimeouts();
    console.log(`[Updater] New version found: ${info.version}`);
    
    // Проверяем, что окно ещё существует
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.warn('[Updater] Main window destroyed, skipping update dialog');
      isManualCheck = false;
      return;
    }
    
    try {
      // Формируем текст изменений
      let releaseNotes = '';
      if (info.releaseNotes) {
        releaseNotes = stripHtml(
          typeof info.releaseNotes === 'string'
            ? info.releaseNotes
            : info.releaseNotes.map(n => n.note || n).join('\n')
        );
      }
      
      if (releaseNotes.length > 500) {
        releaseNotes = releaseNotes.substring(0, 500) + '...';
      }
      if (!releaseNotes) {
        releaseNotes = 'Улучшения производительности и исправления ошибок.';
      }

      // Размер обновления
      let size = 'неизвестен';
      try {
        if (info.files && info.files[0] && info.files[0].size) {
          size = formatBytes(info.files[0].size);
        }
      } catch (e) {
        // Используем значение по умолчанию
      }

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
        // Создаем окно прогресса
        const progressWin = createProgressWindow(mainWindow, info);
        
        // Устанавливаем таймаут на загрузку
        downloadTimeout = setTimeout(() => {
          console.warn('[Updater] Download timeout reached');
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
        }, UPDATER_CONFIG.DOWNLOAD_TIMEOUT);
        
        isDownloading = true;
        
        // Начинаем загрузку
        autoUpdater.downloadUpdate().catch(err => {
          console.error('[Updater] Download failed:', err.message);
          closeProgressWindow();
        });
      }
    } catch (error) {
      console.error('[Updater] Error showing update dialog:', error.message);
    }
    
    isManualCheck = false;
  });

  // === 2. ОБНОВЛЕНИЙ НЕТ ===
  autoUpdater.on('update-not-available', (info) => {
    clearTimeouts();
    console.log('[Updater] No updates available');
    
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

  // === 3. ОШИБКА ===
  autoUpdater.on('error', (err) => {
    clearTimeouts();
    const errorMessage = err?.message || err?.toString() || 'Unknown error';
    console.error('[Updater] Error:', errorMessage);
    
    closeProgressWindow();
    isDownloading = false;
    
    // Сбрасываем прогресс в таскбаре
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
    } catch (e) {
      // Игнорируем
    }
    
    // Показываем ошибку только при ручной проверке
    if (isManualCheck && mainWindow && !mainWindow.isDestroyed()) {
      // Упрощаем сообщение об ошибке для пользователя
      let userMessage = 'Не удалось проверить обновления.';
      let detail = errorMessage;
      
      if (errorMessage.includes('net::')) {
        userMessage = 'Нет подключения к серверу обновлений.';
        detail = 'Проверьте подключение к интернету и попробуйте снова.';
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ETIMEDOUT')) {
        userMessage = 'Сервер обновлений недоступен.';
        detail = 'Попробуйте позже.';
      } else if (errorMessage.includes('404')) {
        userMessage = 'Обновления не найдены на сервере.';
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

  // === 4. ПРОГРЕСС СКАЧИВАНИЯ ===
  autoUpdater.on('download-progress', (progressObj) => {
    // Сбрасываем таймаут загрузки при каждом прогрессе
    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
      downloadTimeout = setTimeout(() => {
        console.warn('[Updater] Download stalled');
        closeProgressWindow();
      }, UPDATER_CONFIG.DOWNLOAD_TIMEOUT);
    }
    
    try {
      // Обновляем окно прогресса
      updateProgressWindow(progressObj);
      
      // Показываем прогресс в таскбаре
      if (mainWindow && !mainWindow.isDestroyed()) {
        const progress = Math.min(1, Math.max(0, (progressObj.percent || 0) / 100));
        mainWindow.setProgressBar(progress);
      }
      
      // Логируем прогресс (не слишком часто)
      const percent = (progressObj.percent || 0).toFixed(1);
      if (percent % 10 < 0.5 || progressObj.percent > 99) {
        console.log(`[Updater] Download: ${percent}% @ ${formatSpeed(progressObj.bytesPerSecond || 0)}`);
      }
    } catch (error) {
      console.warn('[Updater] Progress update error:', error.message);
    }
  });

  // === 5. ЗАГРУЗКА ЗАВЕРШЕНА ===
  autoUpdater.on('update-downloaded', async (info) => {
    clearTimeouts();
    isDownloading = false;
    console.log('[Updater] Update downloaded successfully');
    
    closeProgressWindow();
    
    // Сбрасываем прогресс в таскбаре
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
    } catch (e) {
      // Игнорируем
    }
    
    // Показываем диалог установки
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
          // Небольшая задержка для корректного закрытия диалогов
          setTimeout(() => {
            try {
              autoUpdater.quitAndInstall(false, true);
            } catch (e) {
              console.error('[Updater] quitAndInstall error:', e.message);
              // Fallback: просто перезапускаем приложение
              app.relaunch();
              app.exit(0);
            }
          }, 100);
        }
      } catch (error) {
        console.error('[Updater] Error showing install dialog:', error.message);
      }
    }
  });

  // === ПРОВЕРКА ПРИ СТАРТЕ ===
  // Только для упакованного приложения
  if (app.isPackaged) {
    checkTimeout = setTimeout(() => {
      checkTimeout = null;
      
      console.log('[Updater] Checking for updates...');
      autoUpdater.checkForUpdates().catch(err => {
        // Тихо обрабатываем ошибку при автоматической проверке
        console.warn('[Updater] Auto-check failed:', err.message);
      });
    }, UPDATER_CONFIG.INITIAL_CHECK_DELAY);
  } else {
    console.log('[Updater] Skipping update check in development mode');
  }
}

/**
 * Ручная проверка обновлений (вызывается из меню)
 * @param {Electron.BrowserWindow} mainWindow - Главное окно
 */
export function manualCheck(mainWindow) {
  // Проверяем валидность окна
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[Updater] Cannot check: main window is invalid');
    return;
  }
  
  // Предотвращаем повторные проверки
  if (isManualCheck || isDownloading) {
    console.log('[Updater] Check already in progress');
    return;
  }
  
  isManualCheck = true;
  console.log('[Updater] Manual update check initiated');
  
  // Устанавливаем таймаут на проверку
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
  }, UPDATER_CONFIG.CHECK_TIMEOUT);
  
  autoUpdater.checkForUpdates().catch(err => {
    clearTimeouts();
    const errorMessage = err?.message || 'Unknown error';
    console.error('[Updater] Manual check failed:', errorMessage);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка проверки',
        message: 'Не удалось проверить обновления',
        detail: errorMessage,
        buttons: ['OK']
      }).catch(() => {});
    }
    
    isManualCheck = false;
  });
}

/**
 * Сброс состояния (для тестов и перезапуска)
 */
export function resetUpdaterState() {
  clearTimeouts();
  isInit = false;
  isManualCheck = false;
  isDownloading = false;
  closeProgressWindow();
  autoUpdater.removeAllListeners();
  console.log('[Updater] State reset');
}

/**
 * Получение текущего состояния updater
 * @returns {Object} Объект состояния
 */
export function getUpdaterStatus() {
  return {
    isInitialized: isInit,
    isChecking: isManualCheck,
    isDownloading: isDownloading,
    hasProgressWindow: progressWindow !== null && !progressWindow?.isDestroyed()
  };
}