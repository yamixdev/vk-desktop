import { app, ipcMain, Notification, Menu } from 'electron';

import ConfigManager from './config/manager.js';
import { createMainWindow } from './window/main.js';

let getOptimalDomain = null;
let setupCSP = null;
let createApplicationMenu = null;
let updateTray = null;
let destroyTray = null;
let initAutoUpdater = null;
let setupContextMenu = null;
let discordModule = null;
let VKNextManager = null;

const APP_ID = 'com.yamixdev.vkdesktop';
app.setAppUserModelId(APP_ID);

Menu.setApplicationMenu(null);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let configManager = null;
let vkNextManager = null;

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('disable-http2');

async function loadCoreModules() {
  const [networkModule, securityModule] = await Promise.all([
    import('./network/resolver.js'),
    import('./security/csp.js')
  ]);
  
  getOptimalDomain = networkModule.getOptimalDomain;
  setupCSP = securityModule.setupCSP;
}

async function loadUIModules() {
  const [menuModule, trayModule, contextMenuModule] = await Promise.all([
    import('./ui/menu.js'),
    import('./ui/tray.js'),
    import('./ui/contextMenu.js')
  ]);
  
  createApplicationMenu = menuModule.createApplicationMenu;
  updateTray = trayModule.updateTray;
  destroyTray = trayModule.destroyTray;
  setupContextMenu = contextMenuModule.setupContextMenu;
}

async function loadDiscordModule() {
  if (!discordModule) {
    discordModule = await import('./integrations/discord.js');
    console.log('[App] Discord RPC module loaded');
  }
  return discordModule;
}

async function loadVKNextManager() {
  if (!VKNextManager) {
    const module = await import('./extensions/vkNextManager.js');
    VKNextManager = module.default;
    console.log('[App] VK Next module loaded');
  }
  return VKNextManager;
}

async function bootstrap() {
  console.log('[App] Initializing...');
  const startTime = Date.now();
  
  try {
      configManager = new ConfigManager(app.getPath('userData'));
      const config = await configManager.load();
      console.log(`[App] Config loaded in ${Date.now() - startTime}ms`);

      const [, , targetDomainResult] = await Promise.all([
        loadCoreModules(),
        loadUIModules(),
        (async () => {
          let domain = config.domain || 'vk.com';
          return domain;
        })()
      ]);
      
      let targetDomain = targetDomainResult;
      if (getOptimalDomain && (targetDomain === 'vk.ru' || targetDomain === 'vk.com')) {
        try {
          const domainPromise = getOptimalDomain();
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(targetDomain), 2000));
          targetDomain = await Promise.race([domainPromise, timeoutPromise]);
        } catch (e) {}
      }
      
      console.log(`[App] Modules loaded in ${Date.now() - startTime}ms`);

      if (config.enableVKNext !== false) {
        try {
          const VKNextManagerClass = await loadVKNextManager();
          vkNextManager = new VKNextManagerClass();
          await vkNextManager.load();
          console.log('[App] VK Next extension loaded');
        } catch (error) {
          console.warn('[App] Failed to load VK Next:', error.message);
          vkNextManager = null;
        }
      }

      if (process.platform === 'win32') {
          app.setUserTasks([
              { program: process.execPath, arguments: '--section=music', iconPath: process.execPath, iconIndex: 0, title: 'Моя музыка', description: 'Открыть раздел музыки' },
              { program: process.execPath, arguments: '--section=im', iconPath: process.execPath, iconIndex: 0, title: 'Сообщения', description: 'Открыть мессенджер' },
              { program: process.execPath, arguments: '--section=feed', iconPath: process.execPath, iconIndex: 0, title: 'Новости', description: 'Открыть ленту' }
          ]);
      }
      
      mainWindow = await createMainWindow(configManager, targetDomain);
      console.log(`[App] Main window created in ${Date.now() - startTime}ms`);

      setupCSP(mainWindow.webContents.session);
      setupContextMenu(mainWindow);
      updateTray(mainWindow, configManager);
      createApplicationMenu(mainWindow, configManager);

      if (vkNextManager && vkNextManager.isAvailable()) {
        console.log('[App] VK Next extension is active, content scripts will be injected automatically');
      }
      
      if (config.enableDiscord) {
        setTimeout(async () => {
          try {
            const discord = await loadDiscordModule();
            discord.enableRPC();
          } catch (e) {
            console.warn('[App] Failed to enable Discord RPC:', e.message);
          }
        }, 2000);
      }
      
      setTimeout(async () => {
        try {
          const { initAutoUpdater: loadedInitAutoUpdater } = await import('./updater.js');
          initAutoUpdater = loadedInitAutoUpdater;
          initAutoUpdater(mainWindow);
        } catch (e) {
          console.warn('[App] Failed to initialize updater:', e.message);
        }
      }, 3000);
      
      console.log(`[App] Full initialization completed in ${Date.now() - startTime}ms`);

      ipcMain.on('rpc:update', async (event, data) => {
        try {
          if (!data || typeof data !== 'object') return;

          const { enableDiscord } = configManager.get();
          if (enableDiscord) {
            const discord = await loadDiscordModule();
            discord.updateActivity(data);
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            if (data.isPlaying && data.duration > 0) {
              let progress = Math.min(data.progress / data.duration, 1);
              mainWindow.setProgressBar(progress);
            } else {
              mainWindow.setProgressBar(-1);
            }
          }
        } catch (error) {
          console.warn('[IPC] rpc:update error:', error.message);
        }
      });

      let lastBadgeCount = 0;
      ipcMain.on('app:badge', (event, count) => {
        try {
          if (!mainWindow || mainWindow.isDestroyed()) return;

          const badgeCount = parseInt(count) || 0;

          if (process.platform === 'win32') {
            if (badgeCount > 0 && badgeCount > lastBadgeCount) {
              mainWindow.flashFrame(true);
            } else if (badgeCount === 0) {
              mainWindow.flashFrame(false);
            }
          } else if (process.platform === 'darwin') {
            app.dock.setBadge(badgeCount > 0 ? badgeCount.toString() : '');
          }

          lastBadgeCount = badgeCount;
        } catch (error) {
          console.warn('[IPC] app:badge error:', error.message);
        }
      });

      configManager.on('updated', async (newConfig) => {
        try {
          if (createApplicationMenu) createApplicationMenu(mainWindow, configManager);
          if (updateTray) updateTray(mainWindow, configManager);

          if (newConfig.enableDiscord) {
            const discord = await loadDiscordModule();
            discord.enableRPC();
          } else if (discordModule) {
            discordModule.disableRPC();
          }
        } catch (error) {
          console.warn('[Config] update error:', error.message);
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

      ipcMain.handle('vk-next:get-info', () => {
        return vkNextManager ? vkNextManager.getInfo() : null;
      });

      const memoryCleanupInterval = setInterval(() => {
        try {
          if (global.gc) {
            global.gc();
            console.log('[Memory] GC triggered');
          }

          const memUsage = process.memoryUsage();
          if (memUsage.heapUsed > 500 * 1024 * 1024) {
            console.warn(`[Memory] High usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
          }
        } catch (error) {
          console.warn('[Memory] GC error:', error.message);
        }
      }, 15 * 60 * 1000);

      app.on('before-quit', async () => {
        console.log('[App] Cleaning up...');
        
        if (memoryCleanupInterval) clearInterval(memoryCleanupInterval);
        if (vkNextManager) vkNextManager.destroy();
        
        if (discordModule) {
          try {
            await discordModule.disableRPC();
          } catch (e) {}
        }
        
        if (destroyTray) destroyTray();
        if (configManager) await configManager.destroy();
        
        console.log('[App] Cleanup complete');
      });

  } catch (criticalError) {
    console.error('[App] Critical error:', criticalError);

    try {
      if (!mainWindow && configManager) {
        console.log('[App] Attempting recovery...');
        mainWindow = await createMainWindow(configManager, 'vk.com');
      }
    } catch (recoveryError) {
      console.error('[App] Recovery failed:', recoveryError);
      app.exit(1);
    }
  }
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) bootstrap(); else mainWindow.show(); });

app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();

    const domain = configManager ? configManager.get().domain : 'vk.com';

    if (commandLine.includes('--section=music')) {
        mainWindow.loadURL(`https://${domain}/music`);
    } else if (commandLine.includes('--section=im')) {
        mainWindow.loadURL(`https://${domain}/im`);
    } else if (commandLine.includes('--section=feed')) {
        mainWindow.loadURL(`https://${domain}/feed`);
    }
  }
});