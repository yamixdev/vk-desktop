import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_ROUTES,
  createNavigationUrl,
  navigateMainWindow
} from '../src/main/window/navigation.js';

function createWindow({ spaResult = true, currentUrl = 'https://vk.ru/feed' } = {}) {
  const calls = { execute: 0, load: [] };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: {
      getURL: () => currentUrl,
      isLoadingMainFrame: () => false,
      executeJavaScript: async () => {
        calls.execute += 1;
        return spaResult;
      }
    },
    loadURL: async (url) => { calls.load.push(url); }
  };
  return { calls, mainWindow };
}

test('uses VK SPA navigation before falling back to a full load', async () => {
  const spa = createWindow();
  assert.equal(await navigateMainWindow(spa.mainWindow, APP_ROUTES.MUSIC, 'vk.ru'), true);
  assert.equal(spa.calls.execute, 1);
  assert.deepEqual(spa.calls.load, []);

  const fallback = createWindow({ spaResult: false });
  assert.equal(await navigateMainWindow(fallback.mainWindow, APP_ROUTES.MESSAGES, 'vk.ru'), false);
  assert.deepEqual(fallback.calls.load, ['https://vk.ru/im']);
});

test('rejects routes and domains outside the fixed VK navigation policy', () => {
  assert.equal(createNavigationUrl('vk.ru', APP_ROUTES.HOME), 'https://vk.ru/');
  assert.throws(() => createNavigationUrl('evil.test', APP_ROUTES.MUSIC));
  assert.throws(() => createNavigationUrl('vk.ru', '/away.php'));
});
