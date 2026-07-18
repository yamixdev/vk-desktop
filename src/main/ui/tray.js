import { app, Menu, nativeImage, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getRootPath, getUnpackedPath } from '../utils.js';
import { APP_ROUTES, navigateMainWindow } from '../window/navigation.js';

let tray = null;

function getIconPath() {
  const unpackedPath = path.join(getUnpackedPath(), 'assets/icon.ico');
  if (fs.existsSync(unpackedPath)) return unpackedPath;
  return path.join(getRootPath(), 'assets/icon.ico');
}

function revealWindow(mainWindow) {
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function updateTray(mainWindow, configManager) {
  if (!tray || tray.isDestroyed()) {
    try {
      const icon = nativeImage.createFromPath(getIconPath());
      if (icon.isEmpty()) console.warn('[Tray] Icon is empty, tray might not appear');

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
        if (!mainWindow.isVisible()) revealWindow(mainWindow);
      });
    } catch (error) {
      console.error('[Tray] Failed to create tray:', error.message);
      return null;
    }
  }

  const config = configManager.get();
  const domain = config.domain || 'vk.com';
  const navigate = (route) => {
    revealWindow(mainWindow);
    void navigateMainWindow(mainWindow, route, domain).catch((error) => {
      console.warn('[Tray] Navigation failed:', error.message);
    });
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow.isVisible() ? 'Свернуть' : 'Развернуть',
      click: () => mainWindow.isVisible() ? mainWindow.hide() : revealWindow(mainWindow)
    },
    { type: 'separator' },
    { label: 'Моя музыка', click: () => navigate(APP_ROUTES.MUSIC) },
    { label: 'Сообщения', click: () => navigate(APP_ROUTES.MESSAGES) },
    { type: 'separator' },
    {
      label: 'Сворачивать в трей',
      type: 'checkbox',
      checked: config.minimizeToTray,
      click: () => {
        void configManager.update({ minimizeToTray: !config.minimizeToTray }).catch((error) => {
          console.warn('[Tray] Config update failed:', error.message);
        });
      }
    },
    { type: 'separator' },
    { label: 'Перезагрузить', click: () => mainWindow.reload() },
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
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
