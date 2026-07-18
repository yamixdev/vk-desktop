import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CONFIG,
  mergeConfig,
  sanitizeConfig
} from './schema.js';

const SAVE_DEBOUNCE_MS = 500;
const RENAME_RETRY_DELAYS_MS = Object.freeze([50, 100, 200, 400]);
const RETRYABLE_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);

function cloneConfig(config) {
  return structuredClone(config);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default class ConfigManager extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.path = path.join(userDataPath, 'config.json');
    this.data = sanitizeConfig(DEFAULT_CONFIG);
    this.saveTimer = null;
    this.pendingSnapshot = null;
    this.writeQueue = Promise.resolve();
    this.isDestroyed = false;
  }

  async load() {
    let shouldPersistSanitizedConfig = false;

    try {
      const fileContent = await fs.readFile(this.path, 'utf8');
      let parsed;

      try {
        parsed = JSON.parse(fileContent);
      } catch (error) {
        console.warn('[Config] Invalid JSON; safe defaults will be persisted:', error.message);
        parsed = {};
        shouldPersistSanitizedConfig = true;
      }

      this.data = sanitizeConfig(parsed);
      shouldPersistSanitizedConfig ||= JSON.stringify(parsed) !== JSON.stringify(this.data);
    } catch (error) {
      this.data = sanitizeConfig(DEFAULT_CONFIG);
      if (error.code === 'ENOENT') {
        shouldPersistSanitizedConfig = true;
      } else {
        console.error('[Config] Load failed; continuing with safe defaults:', error.message);
      }
    }

    if (shouldPersistSanitizedConfig) {
      await this.save(this.data, true);
    }

    return this.get();
  }

  get() {
    return cloneConfig(this.data);
  }

  async update(patch) {
    if (this.isDestroyed) {
      throw new Error('ConfigManager is destroyed');
    }

    this.data = mergeConfig(this.data, patch);
    const snapshot = this.get();
    this.emit('updated', snapshot);
    await this.save(snapshot);
    return snapshot;
  }

  async save(data = this.data, force = false) {
    if (this.isDestroyed) return;

    this.data = sanitizeConfig({ ...this.data, ...data });
    this.pendingSnapshot = this.get();

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (force) {
      await this.flush();
      return;
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.#enqueuePendingWrite().catch((error) => {
        console.error('[Config] Save failed:', error.message);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  #enqueuePendingWrite() {
    if (!this.pendingSnapshot) return this.writeQueue;

    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = null;
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.#writeSnapshot(snapshot));
    return this.writeQueue;
  }

  async #writeSnapshot(snapshot) {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

      for (let attempt = 0; ; attempt += 1) {
        try {
          await fs.rename(tempPath, this.path);
          break;
        } catch (error) {
          const retryDelay = RENAME_RETRY_DELAYS_MS[attempt];
          if (!RETRYABLE_RENAME_ERRORS.has(error.code) || retryDelay === undefined) {
            throw error;
          }
          await delay(retryDelay);
        }
      }
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    do {
      await this.#enqueuePendingWrite();
    } while (this.pendingSnapshot);

    await this.writeQueue;
  }

  async destroy() {
    if (this.isDestroyed) return;
    await this.flush();
    this.isDestroyed = true;
    this.removeAllListeners();
  }
}
