import { Tray, Menu, app, nativeImage } from 'electron';
import path from 'path';
import { getRootPath, getUnpackedPath } from '../utils.js';
import fs from 'fs';

let tray = null;

/**
 * Загружает иконку (ищет в unpacked или root)
 */
function getIconPath() {
  const unpackedPath = path.join(getUnpackedPath(), 'assets/icon.ico');
  if (fs.existsSync(unpackedPath)) return unpackedPath;
  return path.join(getRootPath(), 'assets/icon.ico');
}

/**
 * Обновляет системный трей
 */
export function updateTray(mainWindow, configManager) {
  if (!tray || tray.isDestroyed()) {
    try {
      const iconPath = getIconPath();
      const icon = nativeImage.createFromPath(iconPath);
      
      if (icon.isEmpty()) {
        console.warn('[Tray] Icon is empty, tray might not appear');
      }

      tray = new Tray(icon);
      tray.setToolTip('VK Desktop');
      
      tray.on('double-click', () => {
          if (mainWindow.isVisible()) {
             if (mainWindow.isMinimized()) mainWindow.restore();
             else mainWindow.hide();
          } else {
             mainWindow.show();
          }
          mainWindow.focus();
      });

      tray.on('click', () => {
          if (!mainWindow.isVisible()) {
              mainWindow.show();
              mainWindow.focus();
          }
      });
    } catch (e) {
      console.error('[Tray] Failed to create tray:', e.message);
      return null;
    }
  }

  const config = configManager.get();
  const domain = config.domain || 'vk.com';

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: mainWindow.isVisible() ? 'Свернуть' : 'Развернуть', 
      click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() 
    },
    { type: 'separator' },
    // Быстрые ссылки - очень удобно!
    {
      label: 'Моя музыка',
      click: () => {
        mainWindow.loadURL(`https://${domain}/music`);
        mainWindow.show();
      }
    },
    {
      label: 'Сообщения',
      click: () => {
        mainWindow.loadURL(`https://${domain}/im`);
        mainWindow.show();
      }
    },
    { type: 'separator' },
    {
      label: 'Сворачивать в трей',
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
        app.isQuitting = true;
        app.quit();
      } 
    }
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}