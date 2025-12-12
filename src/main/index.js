/**
 * VK Desktop Client - Main Process Entry Point
 *
 * @description Основной файл приложения, выполняется в Main Process
 * @version 1.1.4
 *
 * ОПТИМИЗАЦИИ по Electron Performance Guide:
 * 1. ✅ Lazy-load для тяжёлых модулей (discord, vkNextManager, updater)
 * 2. ✅ Menu.setApplicationMenu(null) до ready для ускорения старта
 * 3. ✅ Минимизация синхронных операций при инициализации
 * 4. ✅ Использование динамических импортов для некритичных модулей
 * 5. ✅ Отложенная инициализация второстепенных функций
 * 6. ✅ Оптимизация использования памяти через V8 флаги
 * 7. ✅ Контроль фоновых процессов
 */

import { app, ipcMain, Notification, Menu } from 'electron';

// === КРИТИЧЕСКИЕ МОДУЛИ (загружаются сразу - минимальный набор) ===
// Только то, что абсолютно необходимо для запуска
import ConfigManager from './config/manager.js';
import { createMainWindow } from './window/main.js';

// === ОТЛОЖЕННЫЕ МОДУЛИ (загружаются по требованию) ===
// Эти модули загружаются после создания окна для ускорения старта
let getOptimalDomain = null;
let setupCSP = null;
let createApplicationMenu = null;
let updateTray = null;
let destroyTray = null;
let initAutoUpdater = null;
let setupContextMenu = null;

// === LAZY-LOAD МОДУЛИ (загружаются только при необходимости) ===
// Discord RPC загружается только если включен в конфиге
let discordModule = null;

// VK Next загружается только если включен в конфиге
let VKNextManager = null;

// ============================================
// === APP INITIALIZATION ===
// ============================================

// 1. ID приложения (Важно для группировки окон в Windows)
const APP_ID = 'com.yamixdev.vkdesktop';
app.setAppUserModelId(APP_ID);

// 2. ОПТИМИЗАЦИЯ: Отключаем меню по умолчанию для ускорения старта
// Меню будет создано после загрузки приложения
Menu.setApplicationMenu(null);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let configManager = null;
let vkNextManager = null;

// --- ФЛАГИ ОПТИМИЗАЦИИ (Memory & Performance Fixes) ---

// 1. Снижаем лимит "Кучи" (Heap) до 1.5 ГБ (было 4 ГБ).
// Это заставит V8 чаще запускать очистку мусора, не накапливая гигабайты.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1536');

// 2. Оптимизация GPU и рендеринга
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// 3. Отключаем изоляцию сайтов (экономит 10-20% памяти на процессе)
// Безопасно, так как мы открываем только один доверенный сайт.
app.commandLine.appendSwitch('disable-site-isolation-trials');

// 4. Подавляем SSL ошибки для VK CDN серверов
// VK использует различные CDN с разными сертификатами
app.commandLine.appendSwitch('ignore-certificate-errors');

// 5. Отключаем логирование GPU ошибок в консоль (они не критичны)
app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds');
app.commandLine.appendSwitch('log-level', '3'); // Только критические ошибки

// 6. Оптимизация сетевых запросов
app.commandLine.appendSwitch('disable-http2'); // VK лучше работает с HTTP/1.1

/**
 * Загружает критические модули (сеть, безопасность)
 * Выполняется до создания окна
 */
async function loadCoreModules() {
  const [networkModule, securityModule] = await Promise.all([
    import('./network/resolver.js'),
    import('./security/csp.js')
  ]);
  
  getOptimalDomain = networkModule.getOptimalDomain;
  setupCSP = securityModule.setupCSP;
}

/**
 * Загружает модули UI (меню, трей, контекстное меню)
 * Выполняется отложенно для ускорения старта
 */
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

/**
 * Загружает модуль Discord RPC (lazy-load)
 * @returns {Promise<Object>} Discord module
 */
async function loadDiscordModule() {
  if (!discordModule) {
    discordModule = await import('./integrations/discord.js');
    console.log('[App] Discord RPC module loaded');
  }
  return discordModule;
}

/**
 * Загружает модуль VK Next (lazy-load)
 * @returns {Promise<typeof VKNextManager>}
 */
async function loadVKNextManager() {
  if (!VKNextManager) {
    const module = await import('./extensions/vkNextManager.js');
    VKNextManager = module.default;
    console.log('[App] VK Next module loaded');
  }
  return VKNextManager;
}

/**
 * Основная функция инициализации приложения
 */
async function bootstrap() {
  console.log('[App] Initializing...');
  const startTime = Date.now();
  
  try {
      // 1. Загружаем конфигурацию (критически важно)
      configManager = new ConfigManager(app.getPath('userData'));
      const config = await configManager.load();
      console.log(`[App] Config loaded in ${Date.now() - startTime}ms`);

      // 2. Параллельная загрузка core-модулей, UI-модулей и определение домена
      const [, , targetDomainResult] = await Promise.all([
        loadCoreModules(),
        loadUIModules(),
        (async () => {
          // Пока загружаются модули, используем сохранённый домен
          let domain = config.domain || 'vk.com';
          return domain;
        })()
      ]);
      
      // Определяем оптимальный домен асинхронно (после загрузки модулей)
      let targetDomain = targetDomainResult;
      if (getOptimalDomain && (targetDomain === 'vk.ru' || targetDomain === 'vk.com')) {
        try {
          const domainPromise = getOptimalDomain();
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(targetDomain), 2000));
          targetDomain = await Promise.race([domainPromise, timeoutPromise]);
        } catch (e) {
          // Используем сохранённый домен при ошибке
        }
      }
      
      console.log(`[App] Modules loaded in ${Date.now() - startTime}ms`);

      // 3. LAZY-LOAD: VK Next (только если включен)
      if (config.enableVKNext !== false) {
        try {
          const VKNextManagerClass = await loadVKNextManager();
          vkNextManager = new VKNextManagerClass();
          await vkNextManager.load();
          console.log('[App] VK Next extension loaded');
        } catch (error) {
          console.warn('[App] Failed to load VK Next extension:', error.message);
          vkNextManager = null;
        }
      } else {
        console.log('[App] VK Next extension disabled in config');
      }

      // 4. Jump Lists (Задачи в таскбаре) - не блокирует UI
      if (process.platform === 'win32') {
          app.setUserTasks([
              { program: process.execPath, arguments: '--section=music', iconPath: process.execPath, iconIndex: 0, title: 'Моя музыка', description: 'Открыть раздел музыки' },
              { program: process.execPath, arguments: '--section=im', iconPath: process.execPath, iconIndex: 0, title: 'Сообщения', description: 'Открыть мессенджер' },
              { program: process.execPath, arguments: '--section=feed', iconPath: process.execPath, iconIndex: 0, title: 'Новости', description: 'Открыть ленту' }
          ]);
      }
      
      // 5. Создаём главное окно
      mainWindow = await createMainWindow(configManager, targetDomain);
      console.log(`[App] Main window created in ${Date.now() - startTime}ms`);

      // 6. Настройка безопасности (VK Next имеет встроенную блокировку рекламы)
      setupCSP(mainWindow.webContents.session);
      setupContextMenu(mainWindow);
      updateTray(mainWindow, configManager);
      createApplicationMenu(mainWindow, configManager);

      // Интеграция VK Next
      // При использовании session.loadExtension() content scripts инъектируются автоматически!
      if (vkNextManager && vkNextManager.isAvailable()) {
        console.log('[App] VK Next extension is active, content scripts will be injected automatically');
      }
      
      // 10. LAZY-LOAD: Discord RPC (только если включен)
      // Запускаем с небольшой задержкой, чтобы не мешать отрисовке UI
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
      
      // 11. Загружаем updater (отложенно, не критично для UI)
      // Запускаем с задержкой после полной загрузки окна
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

      // === IPC HANDLERS ===
      // RPC обновления для Discord
      // === IPC HANDLERS ===
      // RPC обновления для Discord (с lazy-load)
      ipcMain.on('rpc:update', async (event, data) => {
        try {
          // Валидация данных
          if (!data || typeof data !== 'object') return;

          const { enableDiscord } = configManager.get();
          if (enableDiscord) {
            // Lazy-load Discord module при первом использовании
            const discord = await loadDiscordModule();
            discord.updateActivity(data);
          }

          // Обновление прогресс-бара в таскбаре
        if (mainWindow && !mainWindow.isDestroyed()) {
             if (data.isPlaying && data.duration > 0) {
              let progress = Math.min(data.progress / data.duration, 1);
              mainWindow.setProgressBar(progress);
            } else {
                 mainWindow.setProgressBar(-1);
             }
          }
        } catch (error) {
          console.warn('[IPC] Error in rpc:update:', error.message);
        }
      });

      // Обработка бейджика уведомлений
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
          console.warn('[IPC] Error in app:badge:', error.message);
        }
      });

      // Обработка изменений конфигурации
      // Обработка изменений конфигурации (с lazy-load для Discord)
      configManager.on('updated', async (newConfig) => {
        try {
          // UI обновления (модули уже загружены)
          if (createApplicationMenu) createApplicationMenu(mainWindow, configManager);
          if (updateTray) updateTray(mainWindow, configManager);

          // Управление Discord RPC (lazy-load)
          if (newConfig.enableDiscord) {
            const discord = await loadDiscordModule();
            discord.enableRPC();
          } else if (discordModule) {
            // Отключаем только если модуль был загружен
            discordModule.disableRPC();
          }
        } catch (error) {
          console.warn('[Config] Error handling config update:', error.message);
        }
      });

      ipcMain.handle('vk:notification', (event, data) => {
        if (mainWindow && !mainWindow.isFocused()) {
            new Notification({ title: data.title, body: data.body }).show();
        }
      });

      // VK Next интеграция
      ipcMain.handle('vk-next:open-settings', () => {
        if (vkNextManager && vkNextManager.isAvailable() && mainWindow) {
          vkNextManager.createSettingsWindow(mainWindow);
        }
      });

      ipcMain.handle('vk-next:get-info', () => {
        return vkNextManager ? vkNextManager.getInfo() : null;
      });

      // === MEMORY OPTIMIZATION ===
      // Активная очистка памяти каждые 15 минут
      const memoryCleanupInterval = setInterval(() => {
        try {
        if (global.gc) {
            global.gc();
            console.log('[Memory] GC triggered');
          }

          // Логирование использования памяти
          const memUsage = process.memoryUsage();
          const memMB = {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
          };

          if (memUsage.heapUsed > 500 * 1024 * 1024) { // > 500MB
            console.warn(`[Memory] High memory usage: ${memMB.heapUsed}MB heap used`);
          }
        } catch (error) {
          console.warn('[Memory] GC error:', error.message);
        }
      }, 15 * 60 * 1000); // 15 минут

      // Улучшенная очистка ресурсов при выходе
      app.on('before-quit', async () => {
        console.log('[App] Cleaning up resources...');
        
        // Очищаем интервал GC
        if (memoryCleanupInterval) {
          clearInterval(memoryCleanupInterval);
        }
        
        // Уничтожаем VK Next менеджер
        if (vkNextManager) {
          vkNextManager.destroy();
        }
        
        // Уничтожаем Discord RPC (если был загружен)
        if (discordModule) {
          try {
            await discordModule.disableRPC();
          } catch (e) {
            console.warn('[App] Discord cleanup error:', e.message);
          }
        }
        
        // Уничтожаем трей (проверяем, что функция загружена)
        if (destroyTray) {
          destroyTray();
        }
        
        // Уничтожаем менеджер конфигурации (ждем сохранения)
        if (configManager) {
          await configManager.destroy();
        }
        
        console.log('[App] Cleanup complete');
      });

  } catch (criticalError) {
    console.error('[App] Critical error during bootstrap:', criticalError);

    // Попытка восстановления
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

// Обработка повторного запуска (Jump Lists)
app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();

    const domain = configManager ? configManager.get().domain : 'vk.com';
    const args = commandLine;

    if (args.includes('--section=music')) {
        mainWindow.loadURL(`https://${domain}/music`);
    } else if (args.includes('--section=im')) {
        mainWindow.loadURL(`https://${domain}/im`);
    } else if (args.includes('--section=feed')) {
        mainWindow.loadURL(`https://${domain}/feed`);
    }
  }
});