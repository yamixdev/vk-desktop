/**
 * VK Desktop Wrapper v1.1.0 FIX
 * Secure and performant VK client
 * 
 * FIXED: CSP for local files + menu sync + console encoding + Electron warning
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, session, shell, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// ========== CONSTANTS ==========
const APP_CONSTANTS = {
  TRUSTED_DOMAINS: ['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru'],
  ALLOWED_PERMISSIONS: ['notifications', 'geolocation', 'media'],
  CONFIG_FILE: 'config.json',
  WINDOW_TITLE: 'ВКонтакте',
  APP_ID: 'com.yamixdev.vkweb',
  MAX_LOAD_RETRIES: 3
};

// ========== GLOBAL CONFIG ==========
nativeTheme.themeSource = 'system';
app.disableHardwareAcceleration();

// ========== WINDOW MANAGEMENT ==========
let mainWindow = null;
let tray = null;
let trayMenu = null;
let closeHandler = null;

// ========== CONFIG MANAGEMENT ==========
const configPath = path.join(app.getPath('userData'), APP_CONSTANTS.CONFIG_FILE);

const DEFAULT_CONFIG = {
  profile: 'balanced',
  smoothScrolling: true,
  domain: 'vk.ru',
  partition: 'persist:vk',
  minimizeToTray: true,
  blockGifs: true,
  maxConcurrentMedia: 2,
  enableAdBlock: true
};

let config = { ...DEFAULT_CONFIG };

/**
 * Load and validate configuration
 */
async function loadConfig() {
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(configData);
    
    // Validate: only known keys
    const validated = {};
    for (const key in DEFAULT_CONFIG) {
      validated[key] = parsed.hasOwnProperty(key) ? parsed[key] : DEFAULT_CONFIG[key];
    }
    
    console.log('[Config] Configuration loaded');
    return validated;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[Config] File not found, creating new at: ${configPath}`);
      await saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    
    console.error(`[Config] Load error: ${error.message}`);
    dialog.showErrorBox('Ошибка конфигурации', 'Используются настройки по умолчанию');
    return DEFAULT_CONFIG;
  }
}

/**
 * Atomic config save (prevents corruption)
 */
async function saveConfig(data = config) {
  try {
    const tempPath = `${configPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tempPath, configPath);
    console.log('[Config] Configuration saved');
  } catch (error) {
    console.error(`[Config] Save error: ${error.message}`);
    dialog.showErrorBox('Ошибка сохранения', `Не удалось сохранить настройки: ${error.message}`);
  }
}

// ========== TRAY MANAGEMENT ==========
function getIconPath(iconFile = 'icon.ico') {
  const basePath = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.resolve(basePath, 'assets', iconFile);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: `Показать/Скрыть ${APP_CONSTANTS.WINDOW_TITLE}`,
      click: () => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
      }
    },
    { type: 'separator' },
    {
      id: 'minimize-to-tray',
      type: 'checkbox',
      label: 'Минимизировать в трей',
      checked: config.minimizeToTray,
      click: async (menuItem) => {
        config.minimizeToTray = menuItem.checked;
        await saveConfig();
        updateCloseHandler();
        syncAllMinimizeToTrayMenus(); // 🔄 SYNC
      }
    },
    { type: 'separator' },
    { label: 'Выход', click: fullyQuitApp }
  ]);
}

function updateTrayMenu() {
  if (!trayMenu) return;
  const item = trayMenu.getMenuItemById('minimize-to-tray');
  if (item) {
    item.checked = config.minimizeToTray;
  }
}

function fullyQuitApp() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  app.quit();
}

// ========== MENU SYNC 🔄 ==========
function syncAllMinimizeToTrayMenus() {
  // Update tray
  updateTrayMenu();
  
  // Update main window menu
  const appMenu = Menu.getApplicationMenu(); // ✅ CORRECT API
  if (appMenu) {
    const mainMenuItem = appMenu.getMenuItemById('minimize-to-tray-main');
    if (mainMenuItem) {
      mainMenuItem.checked = config.minimizeToTray;
    }
  }
}

// ========== DOMAIN SECURITY ==========
function isTrustedDomain(hostname) {
  return hostname && APP_CONSTANTS.TRUSTED_DOMAINS.includes(hostname);
}

function isTrustedUrl(url) {
  try {
    return isTrustedDomain(new URL(url).hostname);
  } catch {
    return false;
  }
}

// ========== CLOSE HANDLER ==========
function updateCloseHandler() {
  if (!mainWindow) return;

  if (closeHandler) {
    mainWindow.removeListener('close', closeHandler);
  }

  if (config.minimizeToTray) {
    closeHandler = (event) => {
      event.preventDefault();
      mainWindow.hide();
    };
    mainWindow.on('close', closeHandler);
    console.log('[Window] Mode: minimize to tray');
  } else {
    console.log('[Window] Mode: full close');
  }
}

// ========== CREATE WINDOW ==========
async function createWindow() {
  config = await loadConfig();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: getIconPath(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#FFFFFF',
    title: APP_CONSTANTS.WINDOW_TITLE,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: config.partition,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--config=${JSON.stringify(config)}`],
      enablePreferredSizeMode: false // Disables Autofill warnings
    }
  });

  // ========== SETUP CSP AFTER WINDOW CREATION ==========
  const appSession = session.fromPartition(config.partition);
  
  // 1. CSP for VK pages
  appSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' && (details.url.includes('vk.com') || details.url.includes('vk.ru'))) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' https:; " +
            "script-src 'self' 'unsafe-inline' https://*.vk.com https://*.vk.ru; " +
            "style-src 'self' 'unsafe-inline' https://*.vk.com https://*.vk.ru; " +
            "img-src * data: blob:; " +
            "media-src * data:; " +
            "font-src * data:;"
          ]
        }
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // 2. CSP for local files (removes Electron warning)
  appSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('file://')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"]
        }
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // 3. SSL Error Handler (trust only VK domains)
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(isTrustedUrl(url));
  });

  // 4. Disable Autofill API (removes console errors)
  appSession.setPermissionCheckHandler((webContents, permission) => {
    return APP_CONSTANTS.ALLOWED_PERMISSIONS.includes(permission);
  });

  // ========== PERMISSION HANDLER ==========
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isTrusted = isTrustedUrl(details.requestingUrl);
    const isAllowed = APP_CONSTANTS.ALLOWED_PERMISSIONS.includes(permission);
    console.log(`[Permissions] ${permission} from ${details.requestingUrl} | Trusted: ${isTrusted} | Allowed: ${isAllowed}`);
    callback(isTrusted && isAllowed);
  });

  // ========== TRAY INITIALIZATION ==========
  if (!tray) {
    tray = new Tray(getIconPath());
    tray.setToolTip(APP_CONSTANTS.WINDOW_TITLE);
    tray.on('double-click', () => mainWindow?.show());
  }
  
  trayMenu = buildTrayMenu();
  tray.setContextMenu(trayMenu);

  // ========== APPLICATION MENU ==========
  const menuTemplate = [
    {
      label: 'Навигация',
      submenu: [
        { label: 'Назад', accelerator: 'Alt+Left', click: () => mainWindow?.webContents.goBack() },
        { label: 'Вперёд', accelerator: 'Alt+Right', click: () => mainWindow?.webContents.goForward() },
        { type: 'separator' },
        { label: 'Перезагрузить', accelerator: 'Ctrl+R', click: () => mainWindow?.webContents.reloadIgnoringCache() }
      ]
    },
    {
      label: 'Настройки',
      submenu: [
        {
          label: 'Минимизировать в трей',
          type: 'checkbox',
          id: 'minimize-to-tray-main', // ⭐ UNIQUE ID
          checked: config.minimizeToTray,
          click: async (item) => {
            config.minimizeToTray = item.checked;
            await saveConfig();
            updateCloseHandler();
            syncAllMinimizeToTrayMenus(); // 🔄 SYNC
          }
        }
      ]
    },
    {
      label: 'О программе',
      submenu: [
        { label: 'О программе', click: () => showAboutDialog() },
        { label: 'Горячие клавиши', click: () => showHotkeysDialog() },
        { label: 'Проверить обновления', click: () => checkUpdates() }
      ]
    }
  ];

  mainWindow.setMenu(Menu.buildFromTemplate(menuTemplate));

  // ========== LINK HANDLING ==========
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      mainWindow.webContents.send('navigate-in-window', url);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // ========== HOTKEYS ==========
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && !app.isPackaged && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // ========== WINDOW EVENTS ==========
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    updateCloseHandler();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeHandler = null;
  });

  // ========== LOAD WITH RETRIES ==========
  async function loadWithRetry(url, retries = APP_CONSTANTS.MAX_LOAD_RETRIES) {
    for (let i = 0; i < retries; i++) {
      try {
        await mainWindow.loadURL(url);
        console.log(`[Load] Successfully loaded: ${url}`);
        return;
      } catch (err) {
        console.warn(`[Load] Attempt ${i + 1} failed: ${err.message}`);
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  try {
    await loadWithRetry(`https://${config.domain}`);
  } catch (err) {
    console.error(`[Load] Critical error:`, err);
    dialog.showErrorBox('Ошибка загрузки', `Не удалось загрузить ${config.domain}. Проверьте интернет.`);
    fullyQuitApp();
  }
  
  // ========== WINDOWS-SPECIFIC ==========
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_CONSTANTS.APP_ID);
  }
}

// ========== SINGLE INSTANCE ==========
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    // setupSecurityPolicies() теперь вызывается внутри createWindow()
    createWindow();
  });
}

// ========== APP EVENTS ==========
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    fullyQuitApp();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ========== ERROR HANDLING ==========
process.on('uncaughtException', (error) => {
  console.error('[Critical] Unhandled exception:', error);
  dialog.showErrorBox('Критическая ошибка', error.message);
  fullyQuitApp();
});

// ========== IPC HANDLERS ==========
ipcMain.handle('get-config', () => ({ ...config }));

ipcMain.on('request-logout', () => fullyQuitApp());

// Safe navigation
ipcMain.on('navigate-to-url', (event, url) => {
  if (!mainWindow || !isTrustedUrl(url)) return;
  mainWindow.loadURL(url).catch(err => {
    console.error(`[Navigation] Error:`, err);
  });
});

// ========== DIALOGS ==========
function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'О программе',
    message: 'VK Desktop Wrapper',
    detail: `Версия: 1.1.0 - HOTFIX\nАвтор: YamixDev`
  });
}

function showHotkeysDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Горячие клавиши', 
    message: 'Доступные комбинации:',
    detail: 'Alt+Left: Назад\nAlt+Right: Вперёд\nCtrl+R: Перезагрузить'
  });
}

function checkUpdates() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Обновления',
    message: 'На данный момент - в разработке, появится в ближайшем обновлении клиента.'
  });
}