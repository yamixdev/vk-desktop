import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getStoredSafeGraphicsPreference } from '../src/main/graphicsMode.js';

test('reads only an explicit safe graphics preference', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-desktop-graphics-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  assert.equal(getStoredSafeGraphicsPreference(directory), false);
  await fs.writeFile(path.join(directory, 'config.json'), '{bad json');
  assert.equal(getStoredSafeGraphicsPreference(directory), false);
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ safeGraphics: true }));
  assert.equal(getStoredSafeGraphicsPreference(directory), true);
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ safeGraphics: 'true' }));
  assert.equal(getStoredSafeGraphicsPreference(directory), false);
});
