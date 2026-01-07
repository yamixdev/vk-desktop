import { app, ipcMain, Notification, Menu } from 'electron';
import ConfigManager from './config/manager.js';
import { createMainWindow } from './window/main.js';

// Глобальные обработчики ошибок
process.on('uncaughtException', (error) => console.error('[App] Uncaught exception:', error));
process.on('unhandledRejection', (reason) => console.error('[App] Unhandled rejection:', reason));

let discordModule = null;
let VKNextManager = null;
let mainWindow = null;
let configManager = null;
let vkNextManager = null;

// Динамически загружаемые модули
let getOptimalDomain, setupCSP, createApplicationMenu, updateTray, destroyTray, setupContextMenu, initAutoUpdater;

const APP_ID = 'com.yamixdev.vkdesktop';
app.setAppUserModelId(APP_ID);
Menu.setApplicationMenu(null);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// Флаги оптимизации и GC
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536 --expose-gc');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-certificate-errors');

async function loadCoreModules() {
  const [network, security] = await Promise.all([
    import('./network/resolver.js'),
    import('./security/csp.js')
  ]);
  getOptimalDomain = network.getOptimalDomain;
  setupCSP = security.setupCSP;
}

async function loadUIModules() {
  const [menu, tray, ctxMenu] = await Promise.all([
    import('./ui/menu.js'),
    import('./ui/tray.js'),
    import('./ui/contextMenu.js')
  ]);
  createApplicationMenu = menu.createApplicationMenu;
  updateTray = tray.updateTray;
  destroyTray = tray.destroyTray;
  setupContextMenu = ctxMenu.setupContextMenu;
}

async function loadDiscordModule() {
  if (!discordModule) {
    discordModule = await import('./integrations/discord.js');
  }
  return discordModule;
}

async function loadVKNextManager() {
  if (!VKNextManager) {
    const module = await import('./extensions/vkNextManager.js');
    VKNextManager = module.default;
  }
  return VKNextManager;
}

async function bootstrap() {
  console.log('[App] Initializing v1.1.4...');
  const startTime = Date.now();
  
  try {
      configManager = new ConfigManager(app.getPath('userData'));
      const config = await configManager.load();

      const [, , targetDomainResult] = await Promise.all([
        loadCoreModules(),
        loadUIModules(),
        (async () => {
          let domain = config.domain || 'vk.com';
          // Если есть логика получения домена, она тут сработает, иначе вернет дефолт
          return domain; 
        })()
      ]);
      
      let targetDomain = targetDomainResult;
      
      // VK Next
      if (config.enableVKNext !== false) {
        try {
          const VKNextManagerClass = await loadVKNextManager();
          vkNextManager = new VKNextManagerClass();
          
          await Promise.race([
            vkNextManager.load(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
          console.log('[App] VK Next ready');
        } catch (error) {
          console.warn('[App] VK Next disabled:', error.message);
          vkNextManager = null;
        }
      }

      if (process.platform === 'win32') {
          app.setUserTasks([
              { program: process.execPath, arguments: '--section=music', iconPath: process.execPath, iconIndex: 0, title: 'Моя музыка', description: 'Открыть музыку' },
              { program: process.execPath, arguments: '--section=im', iconPath: process.execPath, iconIndex: 0, title: 'Сообщения', description: 'Открыть сообщения' }
          ]);
      }
      
      mainWindow = await createMainWindow(configManager, targetDomain);

      setupCSP(mainWindow.webContents.session);
      setupContextMenu(mainWindow);
      updateTray(mainWindow, configManager);
      createApplicationMenu(mainWindow, configManager);
      
      if (config.enableDiscord) {
        setTimeout(async () => {
          try {
            const discord = await loadDiscordModule();
            discord.enableRPC();
          } catch (e) {}
        }, 2000);
      }
      
      setTimeout(async () => {
        try {
          const { initAutoUpdater: loadedInit } = await import('./updater.js');
          loadedInit(mainWindow);
        } catch (e) {}
      }, 3000);
      
      console.log(`[App] Started in ${Date.now() - startTime}ms`);

      // IPC Event Handlers
      ipcMain.on('rpc:update', async (event, data) => {
        try {
          if (!data) return;
          if (configManager.get().enableDiscord) {
            const discord = await loadDiscordModule();
            discord.updateActivity(data);
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
             if (data.isPlaying && data.duration > 0) {
                mainWindow.setProgressBar(Math.min(data.progress / data.duration, 1));
             } else {
                mainWindow.setProgressBar(-1);
             }
          }
        } catch (e) {}
      });

      let lastBadgeCount = 0;
      ipcMain.on('app:badge', (event, count) => {
        try {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const badgeCount = parseInt(count) || 0;
          if (process.platform === 'win32') {
            if (badgeCount > 0 && badgeCount > lastBadgeCount) mainWindow.flashFrame(true);
            else if (badgeCount === 0) mainWindow.flashFrame(false);
          } else if (process.platform === 'darwin') {
            app.dock.setBadge(badgeCount > 0 ? badgeCount.toString() : '');
          }
          lastBadgeCount = badgeCount;
        } catch (e) {}
      });

      configManager.on('updated', async (newConfig) => {
        if (createApplicationMenu) createApplicationMenu(mainWindow, configManager);
        if (updateTray) updateTray(mainWindow, configManager);
        if (newConfig.enableDiscord) {
            const discord = await loadDiscordModule();
            discord.enableRPC();
        } else if (discordModule) {
            discordModule.disableRPC();
        }
      });

      ipcMain.handle('vk:notification', (event, data) => {
        if (mainWindow && !mainWindow.isFocused()) {
            new Notification({ title: data.title, body: data.body }).show();
        }
      });

      ipcMain.handle('vk-next:open-settings', () => {
        if (vkNextManager && vkNextManager.isAvailable() && mainWindow) {
          vkNextManager.createSettingsWindow(mainWindow);
        }
      });

      ipcMain.handle('vk-next:get-info', () => vkNextManager ? vkNextManager.getInfo() : null);

      // Memory GC
      setInterval(() => {
        try {
          if (global.gc) global.gc();
        } catch (e) {}
      }, 60000);

      app.on('before-quit', async () => {
        if (vkNextManager) vkNextManager.destroy();
        if (discordModule) await discordModule.disableRPC().catch(() => {});
        if (destroyTray) destroyTray();
        if (configManager) await configManager.destroy();
      });

  } catch (error) {
    console.error('[App] Critical init error:', error);
    app.exit(1);
  }
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) bootstrap(); else mainWindow.show(); });

app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    
    // Обработка диплинков/аргументов
    const domain = configManager ? configManager.get().domain : 'vk.com';
    if (commandLine.includes('--section=music')) mainWindow.loadURL(`https://${domain}/music`);
    else if (commandLine.includes('--section=im')) mainWindow.loadURL(`https://${domain}/im`);
  }
});