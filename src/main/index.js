import { app, dialog, ipcMain, Menu } from 'electron';
import logger from 'electron-log';
import ConfigManager from './config/manager.js';
import VKNextManager from './extensions/vkNextManager.js';
import { getStoredSafeGraphicsPreference } from './graphicsMode.js';
import { registerMainIpc } from './ipc.js';
import { SmartMemoryManager } from './performance/memoryManager.js';
import { PerformanceRecorder } from './performance/recorder.js';
import { parseRuntimeOptions } from './runtimeOptions.js';
import { installAppProtocol, registerAppScheme } from './security/appProtocol.js';
import { createExternalUrlOpener } from './security/externalLinks.js';
import { setupContextMenu } from './ui/contextMenu.js';
import { createApplicationMenu } from './ui/menu.js';
import { destroyTray, updateTray } from './ui/tray.js';
import { disposeAutoUpdater, initAutoUpdater } from './updater.js';
import { createMainWindow } from './window/main.js';
import { APP_ROUTES, navigateMainWindow } from './window/navigation.js';

const APP_ID = 'com.yamixdev.vkdesktop';
const runtimeOptions = parseRuntimeOptions();
const safeGraphicsEnabled = runtimeOptions.safeGraphics
  || getStoredSafeGraphicsPreference(app.getPath('userData'));

if (safeGraphicsEnabled) {
  // This must run before the ready event. It is an opt-in fallback for GPUs or
  // drivers that lose the Chromium compositing surface while the renderer works.
  app.disableHardwareAcceleration();
  logger.warn('[GPU] Safe graphics mode is enabled.');
}

registerAppScheme();

let mainWindow = null;
let configManager = null;
let vkNextManager = null;
let discordModule = null;
let bootstrapPromise = null;
let cleanupPromise = null;
let removeIpcHandlers = null;
let allowQuit = false;
let previousUiConfig = null;
let discordStartupTimer = null;
let performanceRecorder = null;
let memoryManager = null;
let quitReason = null;
let gpuRecoveryPrompted = false;

app.setAppUserModelId(APP_ID);
app.isQuitting = false;
Menu.setApplicationMenu(null);

process.on('uncaughtException', (error) => logger.error('[App] Uncaught exception:', error));
process.on('unhandledRejection', (reason) => logger.error('[App] Unhandled rejection:', reason));

function rememberQuitReason(reason) {
  quitReason ??= reason;
  logger.info(`[Lifecycle] Quit requested: ${quitReason}.`);
}

const openExternalUrl = createExternalUrlOpener(() => mainWindow);

async function loadDiscordModule() {
  discordModule ??= await import('./integrations/discord.js');
  return discordModule;
}

async function ensureVKNextLoaded() {
  vkNextManager ??= new VKNextManager({ openExternalUrl });
  return vkNextManager.load();
}

async function setVKNextEnabled(enabled) {
  if (!configManager || !mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Главное окно ещё не готово');
  }

  const previousValue = configManager.get().enableVKNext;
  if (enabled) {
    try {
      await ensureVKNextLoaded();
      await configManager.update({ enableVKNext: true });
    } catch (error) {
      await vkNextManager?.unload().catch(() => undefined);
      if (previousValue !== true) await configManager.update({ enableVKNext: previousValue }).catch(() => undefined);
      throw error;
    }
  } else {
    try {
      await vkNextManager?.unload();
      await configManager.update({ enableVKNext: false });
    } catch (error) {
      if (previousValue) await ensureVKNextLoaded().catch(() => undefined);
      throw error;
    }
  }

  if (!mainWindow.isDestroyed()) mainWindow.reload();
}

function openVKNextSettings() {
  if (vkNextManager?.isAvailable() && mainWindow && !mainWindow.isDestroyed()) {
    vkNextManager.createSettingsWindow(mainWindow);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'VK Next',
      message: 'VK Next сейчас не загружен.',
      detail: 'Проверь целостность bundled-артефакта или включи расширение в настройках.',
      buttons: ['ОК'],
      noLink: true
    });
  }
}

async function restartWithGraphicsMode(safeGraphics) {
  if (!configManager) throw new Error('Настройки приложения ещё не готовы');
  await configManager.update({ safeGraphics });
  await configManager.flush();
  const args = process.argv.slice(1).filter((argument) => argument !== '--safe-graphics');
  logger.info(`[GPU] Restart requested with ${safeGraphics ? 'safe' : 'hardware'} graphics.`);
  app.relaunch({ args });
  app.quit();
}

const menuServices = {
  onToggleVKNext: setVKNextEnabled,
  onOpenVKNextSettings: openVKNextSettings,
  onRestartWithGraphicsMode: restartWithGraphicsMode,
  safeGraphics: safeGraphicsEnabled
};

function getRelevantUiConfig(config) {
  return {
    domain: config.domain,
    enableDiscord: config.enableDiscord,
    enableVKNext: config.enableVKNext,
    minimizeToTray: config.minimizeToTray,
    profile: config.profile
  };
}

async function handleConfigUpdated(newConfig) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const nextUiConfig = getRelevantUiConfig(newConfig);
  const changed = previousUiConfig
    ? Object.keys(nextUiConfig).filter((key) => nextUiConfig[key] !== previousUiConfig[key])
    : Object.keys(nextUiConfig);
  previousUiConfig = nextUiConfig;
  if (changed.length === 0) return;

  createApplicationMenu(mainWindow, configManager, menuServices);
  updateTray(mainWindow, configManager);

  if (changed.includes('profile')) {
    mainWindow.webContents.send('app:profile', newConfig.profile);
  }
  if (changed.includes('enableDiscord')) {
    if (newConfig.enableDiscord) {
      const discord = await loadDiscordModule();
      await discord.enableRPC();
    } else if (discordModule) {
      await discordModule.disableRPC();
    }
  }
}

async function initializeApplication() {
  const startedAt = Date.now();
  installAppProtocol();
  if (runtimeOptions.benchmark && !performanceRecorder) {
    performanceRecorder = new PerformanceRecorder({
      app,
      getMainWindow: () => mainWindow,
      outputPath: runtimeOptions.benchmarkOutput
    });
    await performanceRecorder.start({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      vkNextOverride: runtimeOptions.vkNextOverride
    });
  }
  configManager ??= new ConfigManager(app.getPath('userData'));
  const config = await configManager.load();
  previousUiConfig = getRelevantUiConfig(config);

  let startupExtensionError = null;
  const shouldLoadVKNext = runtimeOptions.vkNextOverride ?? config.enableVKNext;
  if (shouldLoadVKNext) {
    try {
      await ensureVKNextLoaded();
    } catch (error) {
      startupExtensionError = error;
      console.warn('[VKNext] Startup load failed:', error.message);
    }
  }

  if (process.platform === 'win32') {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: '--section=music',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Моя музыка',
        description: 'Открыть музыку'
      },
      {
        program: process.execPath,
        arguments: '--section=im',
        iconPath: process.execPath,
        iconIndex: 0,
        title: 'Сообщения',
        description: 'Открыть сообщения'
      }
    ]);
  }

  mainWindow = await createMainWindow(configManager, config.domain, { openExternalUrl });
  mainWindow.on('close', (event) => {
    logger.info(
      `[Lifecycle] Main window close event (prevented: ${event.defaultPrevented}, `
      + `isQuitting: ${app.isQuitting}).`
    );
  });
  await performanceRecorder?.record('main-window-created');
  memoryManager?.destroy();
  memoryManager = new SmartMemoryManager({
    app,
    mainWindow,
    getProfile: () => configManager?.get().profile ?? 'balanced'
  }).start();
  mainWindow.on('closed', () => {
    logger.info('[Lifecycle] Main window closed.');
    memoryManager?.destroy();
    memoryManager = null;
    mainWindow = null;
  });
  setupContextMenu(mainWindow, { openExternalUrl });
  updateTray(mainWindow, configManager);
  createApplicationMenu(mainWindow, configManager, menuServices);

  removeIpcHandlers ??= registerMainIpc({
    app,
    ipcMain,
    getMainWindow: () => mainWindow,
    getConfigManager: () => configManager,
    loadDiscordModule,
    onValidatedMediaState: (state) => memoryManager?.updateMediaState(state)
  });
  if (configManager.listenerCount('updated') === 0) {
    configManager.on('updated', (newConfig) => {
      void handleConfigUpdated(newConfig).catch((error) => {
        console.warn('[Config] Update side effect failed:', error.message);
      });
    });
  }

  if (config.enableDiscord) {
    discordStartupTimer = setTimeout(() => {
      void loadDiscordModule().then((discord) => discord.enableRPC()).catch(() => undefined);
    }, 2000);
    discordStartupTimer.unref?.();
  }

  initAutoUpdater(() => mainWindow);

  if (startupExtensionError) {
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'VK Next отключён',
      message: 'Расширение не прошло проверку или не загрузилось.',
      detail: startupExtensionError.message,
      buttons: ['ОК'],
      noLink: true
    });
  }

  console.log(`[App] Started v${app.getVersion()} in ${Date.now() - startedAt} ms`);
  return mainWindow;
}

async function bootstrap() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  bootstrapPromise ??= initializeApplication().finally(() => { bootstrapPromise = null; });
  return bootstrapPromise;
}

async function cleanup() {
  const startedAt = Date.now();
  logger.info('[Lifecycle] Cleanup started.');
  if (discordStartupTimer) clearTimeout(discordStartupTimer);
  discordStartupTimer = null;
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  memoryManager?.destroy();
  memoryManager = null;
  await Promise.allSettled([
    disposeAutoUpdater(),
    vkNextManager?.destroy(),
    discordModule?.disableRPC(),
    configManager?.destroy(),
    performanceRecorder?.stop()
  ]);
  destroyTray();
  logger.info(`[Lifecycle] Cleanup finished in ${Date.now() - startedAt} ms.`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  rememberQuitReason('another-instance-is-running');
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();

    const domain = configManager?.get().domain ?? 'vk.ru';
    if (commandLine.includes('--section=music')) {
      void navigateMainWindow(mainWindow, APP_ROUTES.MUSIC, domain).catch(() => undefined);
    }
    if (commandLine.includes('--section=im')) {
      void navigateMainWindow(mainWindow, APP_ROUTES.MESSAGES, domain).catch(() => undefined);
    }
  });

  app.whenReady().then(bootstrap).catch((error) => {
    logger.error('[App] Critical initialization error:', error);
    dialog.showErrorBox('VK Desktop', `Не удалось запустить приложение:\n${error.message}`);
    app.exitCode = 1;
    rememberQuitReason('critical-initialization-error');
    app.quit();
  });

  app.on('activate', () => void bootstrap());
  app.on('render-process-gone', (_event, webContents, details) => {
    logger.warn('[Lifecycle] Renderer process gone:', {
      id: webContents.id,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
  app.on('child-process-gone', (_event, details) => {
    logger.warn('[Lifecycle] Child process gone:', details);
    if (
      gpuRecoveryPrompted
      || safeGraphicsEnabled
      || String(details.type).toLowerCase() !== 'gpu'
      || !mainWindow
      || mainWindow.isDestroyed()
    ) return;

    gpuRecoveryPrompted = true;
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Проблема с графикой',
      message: 'Процесс графики Electron завершился.',
      detail: 'Можно перезапустить клиент в безопасном графическом режиме. Он отключит аппаратное ускорение, пока пользователь сам не включит его обратно.',
      buttons: ['Перезапустить безопасно', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response === 0) {
        return restartWithGraphicsMode(true).catch((error) => {
          logger.error('[GPU] Failed to restart in safe graphics mode:', error);
          dialog.showErrorBox('VK Desktop', `Не удалось сохранить графический режим:\n${error.message}`);
        });
      }
      return undefined;
    }).catch((error) => logger.warn('[GPU] Failed to show recovery prompt:', error));
  });
  app.on('window-all-closed', () => {
    rememberQuitReason('all-windows-closed');
    app.quit();
  });
  app.on('before-quit', (event) => {
    app.isQuitting = true;
    rememberQuitReason('explicit-or-system-quit');
    logger.info(`[Lifecycle] before-quit (allowQuit: ${allowQuit}).`);
    if (allowQuit) return;
    event.preventDefault();
    cleanupPromise ??= cleanup().finally(() => {
      allowQuit = true;
      app.quit();
    });
  });
  app.on('will-quit', () => {
    logger.info(`[Lifecycle] will-quit (reason: ${quitReason ?? 'unknown'}).`);
  });
  app.on('quit', (_event, exitCode) => {
    logger.info(`[Lifecycle] quit (reason: ${quitReason ?? 'unknown'}, exitCode: ${exitCode}).`);
  });
}
