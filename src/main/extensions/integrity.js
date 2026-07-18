import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const TREE_ALGORITHM = 'sha256-tree-v1';

async function collectFiles(rootDirectory, currentDirectory = rootDirectory) {
  const directoryEntries = await fs.readdir(currentDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in extension artifacts: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectFiles(rootDirectory, absolutePath));
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(rootDirectory, absolutePath).split(path.sep).join('/')
      });
    }
  }

  return files;
}

export async function computeExtensionIntegrity(rootDirectory) {
  const files = await collectFiles(rootDirectory);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));

  const treeHash = crypto.createHash('sha256');
  let totalBytes = 0;

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath);
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    totalBytes += content.length;
    treeHash.update(file.relativePath, 'utf8');
    treeHash.update('\0');
    treeHash.update(String(content.length), 'utf8');
    treeHash.update('\0');
    treeHash.update(fileHash, 'ascii');
    treeHash.update('\n');
  }

  return {
    algorithm: TREE_ALGORITHM,
    fileCount: files.length,
    totalBytes,
    sha256: treeHash.digest('hex')
  };
}

export async function verifyExtensionIntegrity(rootDirectory, expected) {
  if (!expected || expected.algorithm !== TREE_ALGORITHM) {
    throw new Error('Unsupported or missing VK Next integrity metadata');
  }

  const actual = await computeExtensionIntegrity(rootDirectory);
  for (const key of ['algorithm', 'fileCount', 'totalBytes', 'sha256']) {
    if (actual[key] !== expected[key]) {
      throw new Error(`VK Next integrity mismatch (${key})`);
    }
  }

  return actual;
}
