import { dialog, app } from 'electron';
import electronUpdater from 'electron-updater';
import logger from 'electron-log';

const { autoUpdater } = electronUpdater;

// Настройка логгера
logger.transports.file.level = 'info';
autoUpdater.logger = logger;
autoUpdater.autoDownload = false;

let isInit = false;
let isManualCheck = false; 

// Функция для очистки HTML тегов (чтобы было красиво в диалоге)
function stripHtml(html) {
   if (!html) return '';
   return html.replace(/<[^>]*>?/gm, '');
}

export function initAutoUpdater(mainWindow) {
  if (isInit) return;
  isInit = true;

  console.log('[Updater] Initializing update system...');

  // 1. Обновление найдено
  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] New version found: ${info.version}`);
    
    // Формируем текст изменений
    const releaseNotes = stripHtml(info.releaseNotes || 'Описание отсутствует.');

    dialog.showMessageBox(mainWindow, {
      type: 'info', // Иконка "i" вместо вопроса
      title: 'Доступно обновление',
      message: `Новая версия ${info.version} готова к установке!`,
      // ВОТ ТУТ БУДЕТ СПИСОК ИЗМЕНЕНИЙ:
      detail: `Что нового:\n\n${releaseNotes}\n\nХотите скачать обновление?`,
      buttons: ['Скачать и обновить', 'Напомнить позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
    
    isManualCheck = false;
  });

  // 2. Обновлений нет
  autoUpdater.on('update-not-available', () => {
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Обновлений нет',
        message: 'У вас установлена самая свежая версия.',
        buttons: ['ОК'],
        noLink: true
      });
      isManualCheck = false;
    }
  });

  // 3. Ошибка
  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err);
    if (isManualCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Ошибка',
        message: 'Не удалось проверить обновления.',
        detail: err.toString(),
        buttons: ['ОК']
      });
      isManualCheck = false;
    }
  });

  // 4. Скачано
  autoUpdater.on('update-downloaded', () => {
    mainWindow.setProgressBar(-1);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Готово к установке',
      message: 'Обновление скачано.',
      detail: 'Приложение перезапустится для установки.',
      buttons: ['Перезапустить сейчас', 'Позже']
    }).then(({ response }) => {
      if (response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });
  });

  try {
    if (app.isPackaged) autoUpdater.checkForUpdates();
  } catch (e) {}
}

export function manualCheck(mainWindow) {
  isManualCheck = true; 
  autoUpdater.checkForUpdates();
}