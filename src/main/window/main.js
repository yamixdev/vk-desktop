import { BrowserWindow, shell, screen, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { resolvePath, getRootPath, getUnpackedPath } from '../utils.js';
import { TRUSTED_DOMAINS, USER_AGENT, isTrustedDomain } from '../../shared/constants.js';

/**
 * Создает главное окно приложения VK Desktop
 *
 * @description Выполняется в Main Process
 * @param {import('../config/manager.js').default} configManager - Менеджер конфигурации
 * @param {string} targetDomain - Целевой домен (vk.ru или vk.com)
 * @returns {Promise<BrowserWindow>}
 */
export async function createMainWindow(configManager, targetDomain) {
  const config = configManager.get();
  const state = config.windowState || {};

  const { width: sWidth, height: sHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = state.width || Math.round(sWidth * 0.8);
  const height = state.height || Math.round(sHeight * 0.9);
  
  // Настройки производительности в зависимости от профиля
  const profile = config.profile || 'balanced';
  const performanceSettings = {
    balanced: {
      backgroundThrottling: true,  // Замедляем в фоне
      paintWhenInitiallyHidden: true,
      webgl: true,
      hardwareAcceleration: true
    },
    performance: {
      backgroundThrottling: false, // Не замедляем (для музыки в фоне)
      paintWhenInitiallyHidden: true,
      webgl: true,
      hardwareAcceleration: true
    },
    powersave: {
      backgroundThrottling: true,  // Сильно замедляем в фоне
      paintWhenInitiallyHidden: false,
      webgl: false, // Отключаем WebGL для экономии
      hardwareAcceleration: true
    }
  };
  
  const settings = performanceSettings[profile] || performanceSettings.balanced;
  console.log(`[Window] Performance profile: ${profile}`, settings);

  // Иконка может быть в asar или unpacked — пробуем оба варианта
  let iconPath = path.join(getRootPath(), 'assets/icon.ico');
  try {
    // В production иконка может быть в unpacked
    const unpackedIcon = path.join(getUnpackedPath(), 'assets/icon.ico');
    if (fs.existsSync(unpackedIcon)) {
      iconPath = unpackedIcon;
    }
  } catch (e) {
    // Используем путь по умолчанию
  }

  const win = new BrowserWindow({
    width, height,
    x: state.x, y: state.y,
    minWidth: 800, minHeight: 600,
    icon: iconPath,
    backgroundColor: '#19191a',
    show: false,
    frame: true,
    webPreferences: {
      preload: resolvePath('../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: settings.backgroundThrottling,
      spellcheck: true,
      sandbox: true,
      webgl: settings.webgl,
      // Отключаем лишние функции для экономии памяти
      enableWebSQL: false,
      v8CacheOptions: 'code' // Кэшируем скомпилированный код
    }
  });

  if (state.isMaximized) win.maximize();

  win.webContents.setUserAgent(USER_AGENT);
  win.setMenuBarVisibility(true); 

  // --- ЛОГИКА ОКОН (Все ссылки в одном окне) ---
  // ИЗМЕНЕНО: добавлена обработка ошибок при парсинге URL
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      // Используем функцию isTrustedDomain из constants.js
      if (isTrustedDomain(url)) {
        win.loadURL(url);
        return { action: 'deny' };
      }
      shell.openExternal(url);
    } catch (error) {
      console.warn('[Window] Invalid URL in setWindowOpenHandler:', url, error.message);
      // При ошибке парсинга открываем внешне для безопасности
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      // Используем функцию isTrustedDomain из constants.js
      if (!isTrustedDomain(url) && url !== win.webContents.getURL()) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (error) {
      console.warn('[Window] Invalid URL in will-navigate:', url, error.message);
      event.preventDefault();
    }
  });

  // --- Экран "NET INTERNETA" ---
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      if (errorCode === -3) return;
      console.log('[Window] Load failed:', errorDescription);
      const html = `<html><head><meta charset="utf-8"><style>body{background:#19191a;color:#e1e3e6;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;user-select:none;margin:0}h2{margin-bottom:10px}p{color:#828282;margin-bottom:20px}.btn{padding:10px 20px;background:#e1e3e6;color:#19191a;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:opacity 0.2s}.btn:hover{opacity:0.8}</style></head><body><h2>Нет соединения</h2><p>Проверьте подключение к интернету.</p><button class="btn" onclick="location.reload()">Попробовать снова</button><script>setInterval(()=>{if(navigator.onLine)location.reload()},5000)</script></body></html>`;
      win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
  });

  // --- Обработка крашей renderer process ---
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Window] Renderer process gone:', details.reason, details.exitCode);
    
    // Если краш — пробуем перезагрузить страницу
    if (details.reason === 'crashed' || details.reason === 'killed') {
      console.log('[Window] Attempting to reload after crash...');
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.reload();
        }
      }, 1000);
    }
  });

  // --- Обработка unresponsive ---
  win.webContents.on('unresponsive', () => {
    console.warn('[Window] Page became unresponsive');
  });

  win.webContents.on('responsive', () => {
    console.log('[Window] Page became responsive again');
  });

  // Загрузки
  win.webContents.session.on('will-download', (event, item, webContents) => {
      item.setSaveDialogOptions({ title: 'Сохранить файл', defaultPath: item.getFilename() });
      item.on('updated', (event, state) => {
          if (state === 'progressing' && item.getTotalBytes() > 0) {
              win.setProgressBar(item.getReceivedBytes() / item.getTotalBytes());
          }
      });
      item.on('done', (event, state) => { win.setProgressBar(-1); });
  });

  win.webContents.session.setPermissionRequestHandler((wc, p, cb) => {
    cb(['notifications', 'media', 'fullscreen', 'download'].includes(p));
  });

  // Taskbar кнопки (только Windows)
  // Требуют иконки prev.png, play.png, next.png в папке assets
  // TODO: добавить иконки для работы thumbar buttons
  // РЕШИЛ НЕ ВНЕДРЯТЬ ЭТО ПОКА ЧТО, Т.К РАБОТАЕТ НЕ ВСЕГДА СТАБИЛЬНО
  /*
  if (process.platform === 'win32') {
    try {
      const fs = require('fs');
      const asset = (f) => {
        const unpackedPath = path.join(getUnpackedPath(), 'assets', f);
        const regularPath = path.join(getRootPath(), 'assets', f);
        if (fs.existsSync(unpackedPath)) return unpackedPath;
        if (fs.existsSync(regularPath)) return regularPath;
        return null;
      };
      
      const prevIcon = asset('prev.png');
      const playIcon = asset('play.png');
      const nextIcon = asset('next.png');
      
      // Устанавливаем только если все иконки есть
      if (prevIcon && playIcon && nextIcon) {
        win.setThumbarButtons([
          { tooltip: 'Prev', icon: prevIcon, click: () => win.webContents.send('media:control', 'prev') },
          { tooltip: 'Play/Pause', icon: playIcon, click: () => win.webContents.send('media:control', 'play_pause') },
          { tooltip: 'Next', icon: nextIcon, click: () => win.webContents.send('media:control', 'next') }
        ]);
        console.log('[Window] Thumbar buttons set');
      } else {
        console.log('[Window] Thumbar buttons skipped - missing icons');
      }
    } catch (e) {
      console.warn('[Window] Failed to set thumbar buttons:', e.message);
    }
  }
  */

  const loadContent = async () => {
    try {
      let url = `https://${targetDomain}`;
      const args = process.argv;
      if (args.includes('--section=music')) url += '/music';
      else if (args.includes('--section=im')) url += '/im';
      else if (args.includes('--section=feed')) url += '/feed';
      console.log(`[Window] Loading: ${url}`);
      await win.loadURL(url);
    } catch (e) {
      if (win.isDestroyed()) return;
      try { await win.loadURL('https://vk.com'); } catch (err2) {}
    }
  };
  loadContent();

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) { win.show(); win.focus(); }
  });

  // Таймер вынесен в общую область видимости для очистки
  let resizeTimer = null;
  
  // === РЕЖИМ ЭФФЕКТИВНОСТИ ===
  // Когда окно скрыто (в трее), снижаем нагрузку на систему
  let isEfficiencyMode = false;
  
  const enableEfficiencyMode = () => {
    if (isEfficiencyMode || win.isDestroyed()) return;
    isEfficiencyMode = true;
    
    try {
      // Снижаем частоту кадров когда в трее
      win.webContents.setFrameRate(5);
      
      // Приостанавливаем некритичные фоновые задачи
      win.webContents.setBackgroundThrottling(true);
      
      console.log('[Window] Efficiency mode enabled');
    } catch (e) {
      console.warn('[Window] Failed to enable efficiency mode:', e.message);
    }
  };
  
  const disableEfficiencyMode = () => {
    if (!isEfficiencyMode || win.isDestroyed()) return;
    isEfficiencyMode = false;
    
    try {
      // Восстанавливаем нормальную частоту кадров
      win.webContents.setFrameRate(60);
      
      // Восстанавливаем настройки throttling из профиля
      const currentProfile = configManager.get().profile || 'balanced';
      win.webContents.setBackgroundThrottling(currentProfile !== 'performance');
      
      console.log('[Window] Efficiency mode disabled');
    } catch (e) {
      console.warn('[Window] Failed to disable efficiency mode:', e.message);
    }
  };
  
  // Включаем режим эффективности когда окно скрыто
  win.on('hide', () => {
    // Даем небольшую задержку на случай быстрого show/hide
    setTimeout(() => {
      if (!win.isVisible() && !win.isDestroyed()) {
        enableEfficiencyMode();
      }
    }, 1000);
  });
  
  // Отключаем режим эффективности когда окно показано
  win.on('show', disableEfficiencyMode);
  win.on('focus', disableEfficiencyMode);
  
  // Также учитываем минимизацию
  win.on('minimize', () => {
    setTimeout(() => {
      if (win.isMinimized() && !win.isDestroyed()) {
        enableEfficiencyMode();
      }
    }, 2000);
  });
  
  win.on('restore', disableEfficiencyMode);

  win.on('close', (e) => {
    // Очищаем таймер при закрытии окна
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    
    if (app.isQuitting) return;
    if (configManager.get().minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });

  const saveState = () => {
    if (win.isDestroyed()) return;
    if (!win.isMaximized() && !win.isMinimized()) {
      configManager.update({ windowState: { ...win.getBounds(), isMaximized: false } });
    } else if (win.isMaximized()) {
      configManager.update({ windowState: { isMaximized: true } });
    }
  };
  
  win.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(saveState, 500);
  });
  
  win.on('move', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(saveState, 500);
  });

  // ИЗМЕНЕНО: очистка при уничтожении окна
  win.on('closed', () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
  });

  return win;
}