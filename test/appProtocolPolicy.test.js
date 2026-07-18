import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_PAGE_URLS,
  getAppAssetDescriptor,
  isAppPageUrl
} from '../src/shared/appProtocolPolicy.js';

test('allows only the fixed app-protocol asset set', () => {
  assert.deepEqual(getAppAssetDescriptor(`${APP_PAGE_URLS.offline}?target=https%3A%2F%2Fvk.ru`), {
    fileName: 'offline.html',
    contentType: 'text/html; charset=utf-8',
    document: true
  });
  assert.equal(getAppAssetDescriptor('vk-desktop://local/offline.css')?.fileName, 'offline.css');
  assert.equal(getAppAssetDescriptor('vk-desktop://local/update-progress.js')?.fileName, 'update-progress.js');
  assert.equal(isAppPageUrl(APP_PAGE_URLS.error), true);
  assert.equal(isAppPageUrl('vk-desktop://local/error.js'), false);
});

test('rejects malformed, privileged and non-GET app-protocol requests', () => {
  const rejected = [
    'https://local/offline.html',
    'vk-desktop://evil.test/offline.html',
    'vk-desktop://user:pass@local/offline.html',
    'vk-desktop://local:443/offline.html',
    'vk-desktop://local/../package.json',
    'vk-desktop://local/%2e%2e/package.json',
    'vk-desktop://local/unknown.html',
    'not a URL',
    `vk-desktop://local/offline.html?${'x'.repeat(2048)}`
  ];
  for (const target of rejected) assert.equal(getAppAssetDescriptor(target), null, target);
  assert.equal(getAppAssetDescriptor(APP_PAGE_URLS.offline, 'POST'), null);
  assert.equal(getAppAssetDescriptor(null), null);
});
