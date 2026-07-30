import {
  BadgeCountSchema,
  IPC_CHANNELS,
  MediaProgressSchema,
  MediaStateSchema
} from '../shared/ipcSchemas.js';
import { isAppPageUrl } from '../shared/appProtocolPolicy.js';
import { isPrivilegedRendererUrl } from '../shared/urlPolicy.js';
import { popupHeaderMenu } from './ui/menu.js';
import {
  cancelUpdateDownload,
  downloadAvailableUpdate,
  getReleaseNotesDetails,
  installDownloadedUpdate,
  manualCheck,
  sendUpdaterState
} from './updater.js';
import { sendTitleBarWindowState } from './window/titleBar.js';

function isMainFrameSender(event, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;

  const frame = event.senderFrame;
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false;
  return frame;
}

function isTrustedSender(event, mainWindow) {
  const frame = isMainFrameSender(event, mainWindow);
  return Boolean(frame && isPrivilegedRendererUrl(frame.url));
}

function isTitleBarSender(event, mainWindow) {
  const frame = isMainFrameSender(event, mainWindow);
  return Boolean(frame && (isPrivilegedRendererUrl(frame.url) || isAppPageUrl(frame.url)));
}

function createRateLimiter() {
  const lastEventAt = new Map();
  return (channel, minimumIntervalMs) => {
    const now = Date.now();
    const previous = lastEventAt.get(channel) ?? 0;
    if (now - previous < minimumIntervalMs) return false;
    lastEventAt.set(channel, now);
    return true;
  };
}

export function registerMainIpc({
  app,
  ipcMain,
  getMainWindow,
  getConfigManager,
  loadDiscordModule,
  onValidatedMediaState
}) {
  const allowEvent = createRateLimiter();
  let lastBadgeCount = 0;

  const onMediaState = async (event, payload) => {
    const mainWindow = getMainWindow();
    if (!isTrustedSender(event, mainWindow)) return;

    const parsed = MediaStateSchema.safeParse(payload);
    if (!parsed.success) {
      console.warn('[IPC] Rejected media state payload');
      return;
    }
    if (!allowEvent(IPC_CHANNELS.MEDIA_STATE, 200)) return;
    onValidatedMediaState?.(parsed.data);

    try {
      if (getConfigManager()?.get().enableDiscord) {
        const discord = await loadDiscordModule();
        await discord.updateActivity(parsed.data);
      }
    } catch (error) {
      console.warn('[IPC] Discord activity update failed:', error.message);
    }
  };

  const onMediaProgress = (event, payload) => {
    const mainWindow = getMainWindow();
    if (!isTrustedSender(event, mainWindow)) return;

    const parsed = MediaProgressSchema.safeParse(payload);
    if (!parsed.success || !allowEvent(IPC_CHANNELS.MEDIA_PROGRESS, 1000)) return;
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;

    const { isPlaying, progress, duration } = parsed.data;
    mainWindow.setProgressBar(isPlaying && duration > 0 ? Math.min(progress / duration, 1) : -1);
  };

  const onBadgeUpdate = (event, payload) => {
    const mainWindow = getMainWindow();
    if (!isTrustedSender(event, mainWindow)) return;

    const parsed = BadgeCountSchema.safeParse(payload);
    if (!parsed.success || !allowEvent(IPC_CHANNELS.BADGE_UPDATE, 100)) return;
    const badgeCount = parsed.data;

    if (process.platform === 'win32') {
      if (badgeCount > lastBadgeCount) mainWindow.flashFrame(true);
      if (badgeCount === 0) mainWindow.flashFrame(false);
    } else if (process.platform === 'darwin') {
      app.dock.setBadge(badgeCount > 0 ? String(badgeCount) : '');
    }
    lastBadgeCount = badgeCount;
  };

  const onTitleBarMenu = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.TITLE_BAR_MENU, 250)) return;
    popupHeaderMenu(mainWindow);
  };

  const onTitleBarReady = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    sendTitleBarWindowState(mainWindow);
    sendUpdaterState(mainWindow);
  };

  const onTitleBarBack = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.TITLE_BAR_BACK, 150)) return;
    const history = mainWindow.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  };

  const onTitleBarMinimize = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.TITLE_BAR_MINIMIZE, 100)) return;
    mainWindow.minimize();
  };

  const onTitleBarToggleMaximize = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.TITLE_BAR_TOGGLE_MAXIMIZE, 100)) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    sendTitleBarWindowState(mainWindow);
  };

  const onTitleBarClose = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.TITLE_BAR_CLOSE, 100)) return;
    mainWindow.close();
  };

  const onUpdateDownload = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.UPDATE_DOWNLOAD, 500)) return;
    void downloadAvailableUpdate().catch((error) => {
      console.warn('[IPC] Could not start update download:', error.message);
    });
  };

  const onUpdateInstall = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.UPDATE_INSTALL, 1000)) return;
    installDownloadedUpdate();
  };

  const onUpdateCancel = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.UPDATE_CANCEL, 500)) return;
    cancelUpdateDownload();
  };

  const onUpdateCheck = (event) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) return;
    if (!allowEvent(IPC_CHANNELS.UPDATE_CHECK, 1000)) return;
    void manualCheck(mainWindow);
  };

  const onReleaseNotes = (event, payload) => {
    const mainWindow = getMainWindow();
    if (!isTitleBarSender(event, mainWindow)) {
      return {
        currentVersion: app.getVersion(),
        status: 'error',
        release: null,
        error: 'Недоступный источник запроса.'
      };
    }
    return getReleaseNotesDetails({ view: payload?.view === 'update' ? 'update' : 'current' });
  };

  ipcMain.on(IPC_CHANNELS.MEDIA_STATE, onMediaState);
  ipcMain.on(IPC_CHANNELS.MEDIA_PROGRESS, onMediaProgress);
  ipcMain.on(IPC_CHANNELS.BADGE_UPDATE, onBadgeUpdate);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_MENU, onTitleBarMenu);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_READY, onTitleBarReady);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_BACK, onTitleBarBack);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_MINIMIZE, onTitleBarMinimize);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_TOGGLE_MAXIMIZE, onTitleBarToggleMaximize);
  ipcMain.on(IPC_CHANNELS.TITLE_BAR_CLOSE, onTitleBarClose);
  ipcMain.on(IPC_CHANNELS.UPDATE_DOWNLOAD, onUpdateDownload);
  ipcMain.on(IPC_CHANNELS.UPDATE_INSTALL, onUpdateInstall);
  ipcMain.on(IPC_CHANNELS.UPDATE_CANCEL, onUpdateCancel);
  ipcMain.on(IPC_CHANNELS.UPDATE_CHECK, onUpdateCheck);
  ipcMain.handle(IPC_CHANNELS.UPDATE_RELEASE_NOTES, onReleaseNotes);

  return () => {
    ipcMain.removeListener(IPC_CHANNELS.MEDIA_STATE, onMediaState);
    ipcMain.removeListener(IPC_CHANNELS.MEDIA_PROGRESS, onMediaProgress);
    ipcMain.removeListener(IPC_CHANNELS.BADGE_UPDATE, onBadgeUpdate);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_MENU, onTitleBarMenu);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_READY, onTitleBarReady);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_BACK, onTitleBarBack);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_MINIMIZE, onTitleBarMinimize);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_TOGGLE_MAXIMIZE, onTitleBarToggleMaximize);
    ipcMain.removeListener(IPC_CHANNELS.TITLE_BAR_CLOSE, onTitleBarClose);
    ipcMain.removeListener(IPC_CHANNELS.UPDATE_DOWNLOAD, onUpdateDownload);
    ipcMain.removeListener(IPC_CHANNELS.UPDATE_INSTALL, onUpdateInstall);
    ipcMain.removeListener(IPC_CHANNELS.UPDATE_CANCEL, onUpdateCancel);
    ipcMain.removeListener(IPC_CHANNELS.UPDATE_CHECK, onUpdateCheck);
    ipcMain.removeHandler(IPC_CHANNELS.UPDATE_RELEASE_NOTES);
  };
}
