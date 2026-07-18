import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { USER_AGENT } from '../../shared/constants.js';
import { APP_PAGE_URLS, isAppPageUrl } from '../../shared/appProtocolPolicy.js';
import {
  classifyNavigationUrl,
  getExternalRedirectTarget,
  isInternalNavigationUrl,
  isPrivilegedRendererUrl
} from '../../shared/urlPolicy.js';
import { IPC_CHANNELS } from '../../shared/ipcSchemas.js';
import { configureSessionSecurity } from '../security/session.js';
import { getRootPath, getUnpackedPath, resolvePath } from '../utils.js';
import { installWindowShortcuts } from './shortcuts.js';
import { normalizeWindowState } from './state.js';
import { sendTitleBarWindowState } from './titleBar.js';

const MAX_CRASH_RELOADS = 3;
const CRASH_WINDOW_MS = 2 * 60 * 1000;

let trustedPageCssPromise = null;
let titleBarCssPromise = null;
let musicMonitorSourcePromise = null;

function getTrustedPageCss() {
  trustedPageCssPromise ??= fsPromises.readFile(resolvePath('../renderer/vk-overrides.css'), 'utf8');
  return trustedPageCssPromise;
}

function getTitleBarCss() {
  titleBarCssPromise ??= Promise.all([
    fsPromises.readFile(resolvePath('../renderer/titlebar.css'), 'utf8'),
    fsPromises.readFile(getIconPath())
  ]).then(([css, icon]) => (
    `${css}\n:root { --vk-desktop-titlebar-logo: url("data:image/x-icon;base64,${icon.toString('base64')}"); }\n`
  ));
  return titleBarCssPromise;
}

function getMusicMonitorSource() {
  musicMonitorSourcePromise ??= fsPromises.readFile(resolvePath('../renderer/music-monitor.cjs'), 'utf8');
  return musicMonitorSourcePromise;
}

function getInitialUrl(domain) {
  const section = process.argv.find((argument) => argument.startsWith('--section='))?.split('=')[1];
  const paths = { music: '/music', im: '/im', feed: '/feed' };
  return `https://${domain}${paths[section] ?? ''}`;
}

function getIconPath() {
  const unpackedIcon = path.join(getUnpackedPath(), 'assets', 'icon.ico');
  return fs.existsSync(unpackedIcon)
    ? unpackedIcon
    : path.join(getRootPath(), 'assets', 'icon.ico');
}

export async function createMainWindow(configManager, targetDomain, { openExternalUrl }) {
  const config = configManager.get();
  const primaryDisplay = screen.getPrimaryDisplay();
  const state = normalizeWindowState(
    config.windowState,
    screen.getAllDisplays(),
    primaryDisplay.workArea
  );
  const win = new BrowserWindow({
    title: 'ВКонтакте',
    width: state.width,
    height: state.height,
    ...(Number.isFinite(state.x) ? { x: state.x } : {}),
    ...(Number.isFinite(state.y) ? { y: state.y } : {}),
    minWidth: 800,
    minHeight: 600,
    icon: getIconPath(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#19191a' : '#f0f2f5',
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: resolvePath('../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: true,
      navigateOnDragDrop: false,
      spellcheck: true,
      webviewTag: false,
      v8CacheOptions: 'code'
    }
  });

  if (state.isMaximized) win.maximize();
  win.webContents.setUserAgent(USER_AGENT);
  win.setMenuBarVisibility(false);
  const removeWindowShortcuts = installWindowShortcuts(win.webContents);
  const windowSession = win.webContents.session;
  configureSessionSecurity(windowSession, () => win);

  let lastTrustedUrl = getInitialUrl(targetDomain);
  let resizeTimer = null;
  let showFallbackTimer = null;
  let crashTimestamps = [];

  const openOfflinePage = async () => {
    if (win.isDestroyed()) return;
    const query = new URLSearchParams({ target: lastTrustedUrl });
    await win.loadURL(`${APP_PAGE_URLS.offline}?${query}`).catch(() => undefined);
  };

  const handleBlockedNavigation = (event, targetUrl) => {
    const redirectTarget = getExternalRedirectTarget(targetUrl);
    if (redirectTarget) {
      event.preventDefault();
      void openExternalUrl(redirectTarget).catch((error) => {
        console.warn('[Window] Failed to open redirected URL:', error.message);
      });
      return;
    }
    if (isInternalNavigationUrl(targetUrl) || isAppPageUrl(targetUrl)) return;
    event.preventDefault();
    const classification = classifyNavigationUrl(targetUrl);
    if (classification === 'external' || classification === 'external-confirmation') {
      void openExternalUrl(targetUrl).catch((error) => {
        console.warn('[Window] Failed to open external URL:', error.message);
      });
      if (getExternalRedirectTarget(win.webContents.getURL())) {
        setTimeout(() => {
          if (!win.isDestroyed()) void win.loadURL(lastTrustedUrl).catch(() => openOfflinePage());
        }, 100);
      }
    }
  };

  win.webContents.setWindowOpenHandler(({ url }) => {
    const redirectTarget = getExternalRedirectTarget(url);
    if (redirectTarget) {
      void openExternalUrl(redirectTarget).catch(() => undefined);
    } else if (isInternalNavigationUrl(url)) {
      void win.loadURL(url).catch(() => undefined);
    } else {
      const classification = classifyNavigationUrl(url);
      if (classification === 'external' || classification === 'external-confirmation') {
        void openExternalUrl(url).catch(() => undefined);
      }
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', handleBlockedNavigation);
  win.webContents.on('will-redirect', handleBlockedNavigation);

  win.webContents.on('did-navigate', (_event, targetUrl) => {
    if (isInternalNavigationUrl(targetUrl) && !getExternalRedirectTarget(targetUrl)) {
      lastTrustedUrl = targetUrl;
    }
    sendTitleBarWindowState(win);
  });
  win.webContents.on('did-navigate-in-page', (_event, _targetUrl, isMainFrame) => {
    if (isMainFrame) sendTitleBarWindowState(win);
  });

  win.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedUrl,
    isMainFrame
  ) => {
    if (!isMainFrame || errorCode === -3 || win.isDestroyed()) return;
    if (isAppPageUrl(validatedUrl)) {
      console.error('[Window] App-owned error page failed to load:', errorCode, errorDescription);
      return;
    }
    console.warn('[Window] Main frame load failed:', errorCode, errorDescription);
    void openOfflinePage();
  });

  win.webContents.on('dom-ready', async () => {
    const pageUrl = win.webContents.getURL();
    if (!isPrivilegedRendererUrl(pageUrl) && !isAppPageUrl(pageUrl)) return;
    try {
      const css = await getTitleBarCss();
      if (win.isDestroyed() || win.webContents.getURL() !== pageUrl) return;
      await win.webContents.insertCSS(css, { cssOrigin: 'user' });
    } catch (error) {
      console.warn('[Window] Title bar styles failed:', error.message);
    }
  });

  win.webContents.on('did-finish-load', async () => {
    const finishedUrl = win.webContents.getURL();
    if (win.isDestroyed() || !isPrivilegedRendererUrl(finishedUrl)) return;
    try {
      const [css, musicMonitorSource] = await Promise.all([
        getTrustedPageCss(),
        getMusicMonitorSource()
      ]);
      if (win.isDestroyed() || win.webContents.getURL() !== finishedUrl) return;
      await win.webContents.insertCSS(css, { cssOrigin: 'user' });
      if (win.isDestroyed() || win.webContents.getURL() !== finishedUrl) return;
      await win.webContents.executeJavaScript(musicMonitorSource, true);
      win.webContents.send(IPC_CHANNELS.PERFORMANCE_PROFILE, configManager.get().profile);
    } catch (error) {
      console.warn('[Window] Trusted-page enhancements failed:', error.message);
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    if (!['crashed', 'killed', 'oom'].includes(details.reason) || win.isDestroyed()) return;
    const now = Date.now();
    crashTimestamps = crashTimestamps.filter((timestamp) => now - timestamp < CRASH_WINDOW_MS);
    crashTimestamps.push(now);

    if (crashTimestamps.length <= MAX_CRASH_RELOADS) {
      const delayMs = Math.min(1000 * (2 ** (crashTimestamps.length - 1)), 8000);
      setTimeout(() => {
        if (!win.isDestroyed()) void win.loadURL(lastTrustedUrl).catch(() => openOfflinePage());
      }, delayMs);
      return;
    }

    const query = new URLSearchParams({ target: lastTrustedUrl, reason: details.reason });
    void win.loadURL(`${APP_PAGE_URLS.error}?${query}`).catch(() => undefined);
  });

  win.webContents.on('unresponsive', () => console.warn('[Window] Renderer is unresponsive'));
  win.webContents.on('responsive', () => console.log('[Window] Renderer recovered'));

  const onWillDownload = (_event, item, webContents) => {
    if (webContents !== win.webContents) return;
    item.setSaveDialogOptions({ title: 'Сохранить файл', defaultPath: item.getFilename() });
    item.on('updated', (_downloadEvent, downloadState) => {
      if (downloadState === 'progressing' && item.getTotalBytes() > 0 && !win.isDestroyed()) {
        win.setProgressBar(item.getReceivedBytes() / item.getTotalBytes());
      }
    });
    item.once('done', () => {
      if (!win.isDestroyed()) win.setProgressBar(-1);
    });
  };
  windowSession.on('will-download', onWillDownload);

  const showWindow = () => {
    if (showFallbackTimer) clearTimeout(showFallbackTimer);
    showFallbackTimer = null;
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  win.once('ready-to-show', showWindow);
  showFallbackTimer = setTimeout(showWindow, 10000);

  const saveState = () => {
    if (win.isDestroyed()) return;
    const normalBounds = win.getNormalBounds();
    void configManager.update({
      windowState: {
        ...normalBounds,
        isMaximized: win.isMaximized()
      }
    }).catch((error) => console.warn('[Window] Failed to persist bounds:', error.message));
  };

  const scheduleStateSave = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(saveState, 500);
  };
  win.on('resize', scheduleStateSave);
  win.on('move', scheduleStateSave);
  win.on('maximize', () => sendTitleBarWindowState(win));
  win.on('unmaximize', () => sendTitleBarWindowState(win));
  win.on('enter-full-screen', () => sendTitleBarWindowState(win));
  win.on('leave-full-screen', () => sendTitleBarWindowState(win));

  const enterBackgroundMode = () => {
    if (win.isDestroyed()) return;
    win.webContents.setBackgroundThrottling(true);
    win.setProgressBar(-1);
  };
  win.on('hide', enterBackgroundMode);
  win.on('minimize', enterBackgroundMode);

  win.on('close', (event) => {
    if (app.isQuitting) return;
    if (configManager.get().minimizeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    if (showFallbackTimer) clearTimeout(showFallbackTimer);
    windowSession.removeListener('will-download', onWillDownload);
    removeWindowShortcuts();
  });

  void win.loadURL(lastTrustedUrl).catch(() => openOfflinePage());
  return win;
}
