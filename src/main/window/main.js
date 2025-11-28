import { BrowserWindow, shell, screen, app } from 'electron';
import path from 'path';
import { resolvePath, getRootPath } from '../utils.js';
import { TRUSTED_DOMAINS, USER_AGENT } from '../../shared/constants.js';

export async function createMainWindow(configManager, targetDomain) {
  const config = configManager.get();
  const state = config.windowState || {};

  const { width: sWidth, height: sHeight } = screen.getPrimaryDisplay().workAreaSize;
  const width = state.width || Math.round(sWidth * 0.8);
  const height = state.height || Math.round(sHeight * 0.9);
  const backgroundThrottling = (config.profile === 'powersave');

  const win = new BrowserWindow({
    width, height,
    x: state.x, y: state.y,
    minWidth: 800, minHeight: 600,
    icon: path.join(getRootPath(), 'assets/icon.ico'),
    backgroundColor: '#19191a',
    show: false,
    
    // --- ВЕРНУЛИ СТАНДАРТНУЮ РАМКУ ---
    frame: true, 
    // Убрали titleBarStyle и titleBarOverlay
    // ---------------------------------

    webPreferences: {
      preload: resolvePath('../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: backgroundThrottling,
      spellcheck: false,
      sandbox: true
    }
  });

  if (state.isMaximized) win.maximize();

  win.webContents.setUserAgent(USER_AGENT);
  
  // Убираем старое меню (чтобы не двоилось), оставим только если создадим через Menu.setApplicationMenu
  win.setMenuBarVisibility(true); 

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

  win.webContents.setWindowOpenHandler(({ url }) => {
    const urlObj = new URL(url);
    const isTrusted = TRUSTED_DOMAINS.some(d => urlObj.hostname === d || urlObj.hostname.endsWith('.' + d));
    if (isTrusted) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const urlObj = new URL(url);
    const isTrusted = TRUSTED_DOMAINS.some(d => urlObj.hostname === d || urlObj.hostname.endsWith('.' + d));
    if (!isTrusted && url !== win.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  try {
      const asset = (f) => path.join(getRootPath(), 'assets', f);
      win.setThumbarButtons([
          { tooltip: 'Prev', icon: asset('prev.png'), click: () => win.webContents.send('media:control', 'prev') },
          { tooltip: 'Play/Pause', icon: asset('play.png'), click: () => win.webContents.send('media:control', 'play_pause') },
          { tooltip: 'Next', icon: asset('next.png'), click: () => win.webContents.send('media:control', 'next') }
      ]);
  } catch(e) {}

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
    if (!win.isDestroyed()) {
        win.show();
        win.focus();
    }
  });

  win.on('close', (e) => {
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
  
  let resizeTimer;
  win.on('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(saveState, 500); });
  win.on('move', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(saveState, 500); });

  return win;
}