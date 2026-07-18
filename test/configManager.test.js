import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ConfigManager from '../src/main/config/manager.js';

test('serializes debounced writes and flushes the latest state on destroy', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-desktop-config-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const manager = new ConfigManager(directory);
  await manager.load();
  await manager.update({ domain: 'vk.com' });
  await manager.update({ enableDiscord: true });
  await manager.destroy();

  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8'));
  assert.equal(persisted.domain, 'vk.com');
  assert.equal(persisted.enableDiscord, true);
  assert.equal(persisted.schemaVersion, 2);
});

test('loads a partially invalid file without retaining unknown or unsafe values', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-desktop-config-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(directory, 'config.json'),
    JSON.stringify({ domain: 'evil.test', minimizeToTray: false, unknown: true })
  );

  const manager = new ConfigManager(directory);
  const config = await manager.load();
  await manager.destroy();

  assert.equal(config.domain, 'vk.ru');
  assert.equal(config.minimizeToTray, false);
  assert.equal('unknown' in config, false);
});
