import { globalShortcut } from 'electron';

export function registerMediaKeys(mainWindow) {
  // Медиа-клавиши работают глобально (даже если приложение свернуто)
  
  globalShortcut.register('MediaPlayPause', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media:control', 'play_pause');
    }
  });

  globalShortcut.register('MediaNextTrack', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media:control', 'next');
    }
  });

  globalShortcut.register('MediaPreviousTrack', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('media:control', 'prev');
    }
  });

  console.log('[MediaKeys] Registered global shortcuts.');
}

export function unregisterMediaKeys() {
  globalShortcut.unregisterAll();
}