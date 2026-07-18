import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNavigationUrl,
  getExternalRedirectTarget,
  isInternalNavigationUrl,
  isPermissionAllowedForUrl,
  isPrivilegedRendererUrl,
  normalizeExternalUrl
} from '../src/shared/urlPolicy.js';

test('allows only exact HTTPS VK navigation hosts', () => {
  assert.equal(isInternalNavigationUrl('https://vk.com/music'), true);
  assert.equal(isInternalNavigationUrl('https://oauth.vk.ru/authorize'), true);
  assert.equal(isInternalNavigationUrl('http://vk.com'), false);
  assert.equal(isInternalNavigationUrl('https://vk.com.evil.test'), false);
  assert.equal(isInternalNavigationUrl('https://user:pass@vk.com'), false);
  assert.equal(isInternalNavigationUrl('https://vk.com:8443/music'), false);
});

test('unwraps VK external redirectors without loading their intermediate page', () => {
  assert.equal(
    getExternalRedirectTarget('https://vk.ru/away.php?to=https%3A%2F%2Fexample.com%2Fdocs'),
    'https://example.com/docs'
  );
  assert.equal(getExternalRedirectTarget('https://vk.ru/feed?to=https://example.com'), null);
  assert.equal(getExternalRedirectTarget('https://evil.test/away.php?to=https://example.com'), null);
  assert.equal(getExternalRedirectTarget('https://vk.ru/away.php?to=javascript%3Aalert(1)'), null);
});

test('keeps privileged IPC origins narrower than auth navigation', () => {
  assert.equal(isPrivilegedRendererUrl('https://m.vk.ru/im'), true);
  assert.equal(isPrivilegedRendererUrl('https://oauth.vk.ru/authorize'), false);
});

test('classifies external protocols fail closed', () => {
  assert.equal(classifyNavigationUrl('https://example.com/path'), 'external');
  assert.equal(classifyNavigationUrl('mailto:test@example.com'), 'external-confirmation');
  assert.equal(classifyNavigationUrl('javascript:alert(1)'), 'deny');
  assert.equal(classifyNavigationUrl('file:///C:/secret.txt'), 'deny');
  assert.equal(normalizeExternalUrl('data:text/html,hello'), null);
});

test('permissions are origin-specific', () => {
  assert.equal(isPermissionAllowedForUrl('notifications', 'https://vk.com/feed'), true);
  assert.equal(isPermissionAllowedForUrl('media', 'https://calls.vk.com/room'), true);
  assert.equal(isPermissionAllowedForUrl('notifications', 'https://calls.vk.com/room'), false);
  assert.equal(isPermissionAllowedForUrl('fullscreen', 'https://vkvideo.ru/video'), true);
  assert.equal(isPermissionAllowedForUrl('mediaKeySystem', 'https://vkvideo.ru/video'), true);
  assert.equal(isPermissionAllowedForUrl('clipboard-sanitized-write', 'https://vk.ru/im'), true);
  assert.equal(isPermissionAllowedForUrl('clipboard-read', 'https://vk.ru/im'), false);
  assert.equal(isPermissionAllowedForUrl('media', 'https://evil.test'), false);
});
