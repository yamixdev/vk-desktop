import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { computeExtensionIntegrity } from '../src/main/extensions/integrity.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = path.join(projectRoot, 'extensions', 'vk-next');
const metadataPath = path.join(projectRoot, 'src', 'main', 'extensions', 'vk-next.integrity.json');
const manifest = JSON.parse(await fs.readFile(path.join(extensionDirectory, 'manifest.json'), 'utf8'));
const integrity = await computeExtensionIntegrity(extensionDirectory);
const metadata = {
  artifact: 'vk-next',
  version: manifest.version,
  ...integrity
};

if (process.argv.includes('--write')) {
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  console.log(`[VKNext] Wrote integrity metadata for v${metadata.version}`);
} else if (process.argv.includes('--check')) {
  const expected = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(metadata)) {
    console.error('[VKNext] Integrity metadata is stale. Review the artifact, then run npm run update:extension-integrity.');
    process.exitCode = 1;
  } else {
    console.log(`[VKNext] Integrity verified for v${metadata.version} (${metadata.fileCount} files)`);
  }
} else {
  console.log(JSON.stringify(metadata, null, 2));
}
