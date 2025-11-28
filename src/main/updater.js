import { dialog, app } from 'electron';
import electronUpdater from 'electron-updater';
import logger from 'electron-log';

const { autoUpdater } = electronUpdater;

// Настройка логгера (пишет логи в файл, полезно для отладки)
logger.transports.file.level = 'info';
autoUpdater.logger = logger;

// НЕ скачивать автоматически. Сначала спросим юзера.
autoUpdater.autoDownload = false;

let isInit = false;
let isManualCheck = false; // Флаг: если true, значит проверку запустил юзер через меню

export function initAutoUpdater(mainWindow) {
  if (isInit) return;
  isInit = true;

  console.log('[Updater] Initializing update system...');

  // --- ОБРАБОТЧИКИ СОБЫТИЙ ---

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for updates...');
  });

  // 1. Обновление найдено
  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] New version found: ${info.version}`);
    
    // Спрашиваем: Скачать?
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: `New version ${info.version} is available.`,
      detail: 'Do you want to download and install the update now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        // Если Да — начинаем качать
        autoUpdater.downloadUpdate();
      }
    });
    
    // Сбрасываем флаг ручной проверки, так как мы уже показали диалог
    isManualCheck = false;
  });

  // 2. Обновлений нет
  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] latest version.');
    
    // Если это была РУЧНАЯ проверка (через меню), то сообщаем юзеру, что всё ок.
    // Если проверка была автоматическая при старте — молчим.
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No updates',
        message: 'You have the latest version of the application installed.',
        buttons: ['OK']
      });
      isManualCheck = false;
    }
  });

  // 3. Ошибка проверки
  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates.',
        detail: err.toString(),
        buttons: ['ОК']
      });
      isManualCheck = false;
    }
  });

  // 4. Прогресс загрузки (опционально можно добавить прогресс-бар в UI)
  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `Download speed: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`;
    console.log('[Updater]', logMessage);
    // Здесь можно слать событие в renderer, если захочешь рисовать полоску
    // mainWindow.webContents.send('update-progress', progressObj.percent);
  });

  // 5. Обновление скачано полностью
  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Installing update',
      message: 'Update downloaded.',
      detail: 'The application will restart to install the new version.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });
  });

  // --- ПЕРВЫЙ ЗАПУСК ---
  // Проверяем тихо при старте (если приложение собрано в exe)
  try {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
    }
  } catch (e) {
    console.error('[Updater] Init check failed:', e);
  }
}

// Функция для вызова из Меню (Помощь -> Проверить обновления)
export function manualCheck(mainWindow) {
  isManualCheck = true; // Ставим флаг, чтобы показать диалог "Обновлений нет"
  autoUpdater.checkForUpdates();
}