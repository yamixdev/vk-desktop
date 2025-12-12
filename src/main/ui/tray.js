import { Tray, Menu, app, nativeImage } from 'electron';
import path from 'path';
import { getRootPath } from '../utils.js';

/** @type {Tray|null} Глобальная переменная трея */
let tray = null;

/**
 * Обновляет или создает системный трей
 *
 * @description Выполняется в Main Process
 * @param {Electron.BrowserWindow} mainWindow - Главное окно приложения
 * @param {import('../config/manager.js').default} configManager - Менеджер конфигурации
 * @returns {Tray} Экземпляр трея
 */
export function updateTray(mainWindow, configManager) {
  // Если трей уже есть - обновляем только меню, не пересоздаем иконку (чтобы не мигала)
  // Но если она уничтожена (destroy), создаем заново.
  if (!tray || tray.isDestroyed()) {
    const iconPath = path.join(getRootPath(), 'assets/icon.ico');
    
    // Создаем NativeImage для надежности
    const icon = nativeImage.createFromPath(iconPath);
    
    tray = new Tray(icon);
    tray.setToolTip('VK Desktop');
    
    // Обработчик двойного клика (стандарт Windows)
    tray.on('double-click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        mainWindow.focus();
    });

    // Обработчик одиночного клика (опционально)
    tray.on('click', () => {
        if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
  }

  const config = configManager.get();

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: mainWindow.isVisible() ? 'Свернуть' : 'Открыть', 
      click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() 
    },
    { type: 'separator' },
    {
      label: 'В трей при закрытии',
      type: 'checkbox',
      checked: config.minimizeToTray,
      click: () => configManager.update({ minimizeToTray: !config.minimizeToTray })
    },
    { type: 'separator' },
    { 
      label: 'Перезагрузить',
      click: () => mainWindow.reload()
    },
    { 
      label: 'Выход', 
      click: () => {
        // Ставим флаг, чтобы window.on('close') не прервал выход
        app.isQuitting = true;
        app.quit();
      } 
    }
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

/**
 * ИЗМЕНЕНО: Уничтожает трей и освобождает ресурсы
 * Вызывается при выходе из приложения
 * @returns {void}
 */
export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    console.log('[Tray] Destroyed');
  }
  tray = null;
}

/**
 * Получает текущий экземпляр трея
 * @returns {Tray|null}
 */
export function getTray() {
  return tray;
}