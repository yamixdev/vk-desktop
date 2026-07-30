import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_CONFIG_VERSION,
  DEFAULT_CONFIG,
  mergeConfig,
  sanitizeConfig
} from '../src/main/config/schema.js';

test('sanitizes invalid fields independently and strips unknown keys', () => {
  const result = sanitizeConfig({
    profile: 'turbo',
    domain: 'evil.test',
    minimizeToTray: false,
    enableDiscord: 'yes',
    enableVKNext: true,
    safeGraphics: true,
    injected: 'drop-me'
  });

  assert.deepEqual(result, {
    schemaVersion: CURRENT_CONFIG_VERSION,
    profile: DEFAULT_CONFIG.profile,
    domain: DEFAULT_CONFIG.domain,
    minimizeToTray: false,
    enableDiscord: DEFAULT_CONFIG.enableDiscord,
    enableVKNext: true,
    safeGraphics: true,
    windowState: {}
  });
  assert.equal('injected' in result, false);
});

test('migrates an unversioned config and validates patches', () => {
  const migrated = sanitizeConfig({ domain: 'vk.com', enableDiscord: true });
  assert.equal(migrated.schemaVersion, CURRENT_CONFIG_VERSION);
  assert.equal(migrated.domain, 'vk.com');
  assert.equal(migrated.enableDiscord, true);

  assert.throws(() => mergeConfig(migrated, { domain: 'example.com' }));
  assert.equal(mergeConfig(migrated, { profile: 'powersave' }).profile, 'powersave');
});
