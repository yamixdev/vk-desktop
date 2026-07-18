import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeExtensionIntegrity,
  verifyExtensionIntegrity
} from '../src/main/extensions/integrity.js';

test('matches the pinned VK Next artifact', async () => {
  const expected = JSON.parse(await fs.readFile(
    new URL('../src/main/extensions/vk-next.integrity.json', import.meta.url),
    'utf8'
  ));
  const actual = await computeExtensionIntegrity(fileURLToPath(new URL('../extensions/vk-next', import.meta.url)));
  assert.equal(actual.sha256, expected.sha256);
  assert.equal(actual.fileCount, expected.fileCount);
});

test('fails closed when an extension file changes', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-next-integrity-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'manifest.json'), '{"version":"1"}');
  const expected = await computeExtensionIntegrity(directory);
  await fs.writeFile(path.join(directory, 'manifest.json'), '{"version":"2"}');
  await assert.rejects(() => verifyExtensionIntegrity(directory, expected), /integrity mismatch/u);
});
