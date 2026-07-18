import test from 'node:test';
import assert from 'node:assert/strict';
import { IPC_CHANNELS } from '../src/shared/ipcSchemas.js';
import {
  getTitleBarWindowState,
  sendTitleBarWindowState,
  TITLE_BAR_HEIGHT
} from '../src/main/window/titleBar.js';

function createWindow(overrides = {}) {
  const messages = [];
  const window = {
    isDestroyed: () => false,
    isMaximized: () => true,
    isFullScreen: () => false,
    webContents: {
      isDestroyed: () => false,
      navigationHistory: { canGoBack: () => true },
      send: (...message) => messages.push(message)
    },
    ...overrides
  };
  return { window, messages };
}

test('uses a compact 40px title bar and reports native window state', () => {
  const { window } = createWindow();
  assert.equal(TITLE_BAR_HEIGHT, 40);
  assert.deepEqual(getTitleBarWindowState(window), {
    canGoBack: true,
    isMaximized: true,
    isFullScreen: false,
    platform: process.platform
  });
});

test('sends title bar state only to a live renderer', () => {
  const { window, messages } = createWindow();
  sendTitleBarWindowState(window);
  assert.deepEqual(messages, [[IPC_CHANNELS.TITLE_BAR_STATE, getTitleBarWindowState(window)]]);
  assert.equal(getTitleBarWindowState(null), null);
});
