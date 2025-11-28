import { app, ipcMain, Notification } from 'electron';
import path from 'path';
import ConfigManager from './config/manager.js';
import { createMainWindow } from './window/main.js';
import { createApplicationMenu } from './ui/menu.js';
import { updateTray } from './ui/tray.js';
import { setupAdBlock } from './security/adblocker.js';
import { initAutoUpdater } from './updater.js';
import { enableRPC, disableRPC, updateActivity } from './integrations/discord.js';
import { registerMediaKeys, unregisterMediaKeys } from './integrations/mediaKeys.js';
import { getOptimalDomain } from './network/resolver.js';
import { setupCSP } from './security/csp.js'; 
import { setupContextMenu } from './ui/contextMenu.js';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let configManager = null;

app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('enable-javascript-harmony');
app.commandLine.appendSwitch('enable-future-v8-vm-features');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

async function bootstrap() {
  console.log('[App] Initializing...');
  
  try {
      configManager = new ConfigManager(app.getPath('userData'));
      const config = await configManager.load();

      // --- JUMP LISTS (Задачи в панели задач Windows) ---
      if (process.platform === 'win32') {
          app.setUserTasks([
              {
                  program: process.execPath,
                  arguments: '--section=music',
                  iconPath: process.execPath,
                  iconIndex: 0,
                  title: 'Моя музыка',
                  description: 'Открыть раздел музыки'
              },
              {
                  program: process.execPath,
                  arguments: '--section=im',
                  iconPath: process.execPath,
                  iconIndex: 0,
                  title: 'Сообщения',
                  description: 'Открыть мессенджер'
              },
              {
                  program: process.execPath,
                  arguments: '--section=feed',
                  iconPath: process.execPath,
                  iconIndex: 0,
                  title: 'Новости',
                  description: 'Открыть ленту'
              }
          ]);
      }
      // ------------------------------------------------

      let targetDomain = config.domain || 'vk.com';
      if (targetDomain === 'vk.ru' || targetDomain === 'vk.com') {
          try {
            const domainPromise = getOptimalDomain();
            const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('vk.com'), 2000));
            targetDomain = await Promise.race([domainPromise, timeoutPromise]);
          } catch (e) { targetDomain = 'vk.com'; }
      }
      console.log(`[App] Target domain: ${targetDomain}`);

      mainWindow = await createMainWindow(configManager, targetDomain);

      if (config.enableAdBlock) setupAdBlock(mainWindow.webContents.session);
      
      setupCSP(mainWindow.webContents.session);
      setupContextMenu(mainWindow);
      updateTray(mainWindow, configManager);
      createApplicationMenu(mainWindow, configManager);
      registerMediaKeys(mainWindow);
      
      if (config.enableDiscord) enableRPC();
      initAutoUpdater(mainWindow);

      ipcMain.on('rpc:update', (event, data) => {
        if (configManager.get().enableDiscord) updateActivity(data);
        if (mainWindow && !mainWindow.isDestroyed()) {
             if (data.isPlaying && data.duration > 0) {
                 let prog = data.progress / data.duration;
                 if(prog > 1) prog = 1;
                 mainWindow.setProgressBar(prog);
             } else if (!data.isPlaying) {
                 mainWindow.setProgressBar(-1);
             }
        }
      });

      let lastBadgeCount = 0;
      ipcMain.on('app:badge', (event, count) => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (process.platform === 'win32') {
              if (count > 0 && count > lastBadgeCount) mainWindow.flashFrame(true);
              else if (count === 0) mainWindow.flashFrame(false);
          } else if (process.platform === 'darwin') {
              app.dock.setBadge(count > 0 ? count.toString() : '');
          }
          lastBadgeCount = count;
      });

      configManager.on('updated', (newConfig) => {
        createApplicationMenu(mainWindow, configManager);
        updateTray(mainWindow, configManager);
        if (newConfig.enableDiscord) enableRPC(); else disableRPC();
      });

      ipcMain.handle('vk:notification', (event, data) => {
        if (mainWindow && !mainWindow.isFocused()) {
            new Notification({ title: data.title, body: data.body }).show();
        }
      });

      console.log('[App] Ready!');

  } catch (criticalError) {
      console.error('[App] ERROR:', criticalError);
      if (!mainWindow && configManager) {
         mainWindow = await createMainWindow(configManager, 'vk.com');
      }
  }
}

app.whenReady().then(bootstrap);
app.on('will-quit', () => { unregisterMediaKeys(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) bootstrap(); else mainWindow.show(); });
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});