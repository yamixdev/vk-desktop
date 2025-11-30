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
    frame: true, 
    webPreferences: {
      preload: resolvePath('../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: backgroundThrottling,
      spellcheck: true, // Включена проверка орфографии
      sandbox: true
    }
  });

  if (state.isMaximized) win.maximize();

  win.webContents.setUserAgent(USER_AGENT);
  win.setMenuBarVisibility(true); 

  // --- ЛОГИКА ОКОН (Все ссылки в одном окне) ---
  win.webContents.setWindowOpenHandler(({ url }) => {
    const urlObj = new URL(url);
    const isTrusted = TRUSTED_DOMAINS.some(d => urlObj.hostname === d || urlObj.hostname.endsWith('.' + d));
    
    if (isTrusted) {
        win.loadURL(url);
        return { action: 'deny' };
    }
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

  // --- Экран "NET INTERNETA XDDDDDDDDD" ---
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      if (errorCode === -3) return; 
      console.log('[Window] Load failed:', errorDescription);
      const html = `<html><head><meta charset="utf-8"><style>body{background:#19191a;color:#e1e3e6;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;user-select:none;margin:0}h2{margin-bottom:10px}p{color:#828282;margin-bottom:20px}.btn{padding:10px 20px;background:#e1e3e6;color:#19191a;border:none;border-radius:8px;cursor:pointer;font-weight:bold;transition:opacity 0.2s}.btn:hover{opacity:0.8}</style></head><body><h2>Нет соединения</h2><p>Проверьте подключение к интернету.</p><button class="btn" onclick="location.reload()">Попробовать снова</button><script>setInterval(()=>{if(navigator.onLine)location.reload()},5000)</script></body></html>`;
      win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
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

  // Taskbar кнопки
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
    if (!win.isDestroyed()) { win.show(); win.focus(); }
  });

  win.on('close', (e) => {
    if (app.isQuitting) return; 
    if (configManager.get().minimizeToTray) { e.preventDefault(); win.hide(); }
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