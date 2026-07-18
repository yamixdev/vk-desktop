import { IPC_CHANNELS } from '../../shared/ipcSchemas.js';

export const TITLE_BAR_HEIGHT = 40;

export function getTitleBarWindowState(window) {
  if (!window || window.isDestroyed()) return null;
  return {
    canGoBack: Boolean(window.webContents.navigationHistory?.canGoBack()),
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
    platform: process.platform
  };
}

export function sendTitleBarWindowState(window) {
  const state = getTitleBarWindowState(window);
  if (!state || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC_CHANNELS.TITLE_BAR_STATE, state);
}
