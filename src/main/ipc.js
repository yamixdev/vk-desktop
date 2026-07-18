import {
  BadgeCountSchema,
  IPC_CHANNELS,
  MediaProgressSchema,
  MediaStateSchema
} from '../shared/ipcSchemas.js';
import { isPrivilegedRendererUrl } from '../shared/urlPolicy.js';

function isTrustedSender(event, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;

  const frame = event.senderFrame;
  if (!frame || frame !== mainWindow.webContents.mainFrame) return false;
  return isPrivilegedRendererUrl(frame.url);
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

  ipcMain.on(IPC_CHANNELS.MEDIA_STATE, onMediaState);
  ipcMain.on(IPC_CHANNELS.MEDIA_PROGRESS, onMediaProgress);
  ipcMain.on(IPC_CHANNELS.BADGE_UPDATE, onBadgeUpdate);

  return () => {
    ipcMain.removeListener(IPC_CHANNELS.MEDIA_STATE, onMediaState);
    ipcMain.removeListener(IPC_CHANNELS.MEDIA_PROGRESS, onMediaProgress);
    ipcMain.removeListener(IPC_CHANNELS.BADGE_UPDATE, onBadgeUpdate);
  };
}
