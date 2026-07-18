import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { classifyNavigationUrl } from '../../shared/urlPolicy.js';
import { verifyExtensionIntegrity } from './integrity.js';

const INTEGRITY_METADATA_URL = new URL('./vk-next.integrity.json', import.meta.url);

export default class VKNextManager {
  constructor({ openExternalUrl } = {}) {
    this.extension = null;
    this.manifest = null;
    this.settingsWindow = null;
    this.available = false;
    this.extensionPath = null;
    this.integrity = null;
    this.openExternalUrl = openExternalUrl;
  }

  #findPath() {
    const pathsToCheck = [];

    if (app.isPackaged) {
      pathsToCheck.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'vk-next'));
      pathsToCheck.push(path.join(process.resourcesPath, 'extensions', 'vk-next'));
    }

    pathsToCheck.push(path.join(app.getAppPath(), 'extensions', 'vk-next'));
    pathsToCheck.push(path.join(process.cwd(), 'extensions', 'vk-next'));

    const extensionPath = pathsToCheck.find((candidate) =>
      fsSync.existsSync(path.join(candidate, 'manifest.json'))
    );

    if (!extensionPath) {
      throw new Error(`VK Next was not found in: ${pathsToCheck.join(', ')}`);
    }
    return extensionPath;
  }

  async load() {
    if (this.extension) return this.getInfo();

    this.extensionPath = this.#findPath();
    const [manifestContent, integrityContent] = await Promise.all([
      fs.readFile(path.join(this.extensionPath, 'manifest.json'), 'utf8'),
      fs.readFile(INTEGRITY_METADATA_URL, 'utf8')
    ]);
    this.manifest = JSON.parse(manifestContent);
    const expectedIntegrity = JSON.parse(integrityContent);

    if (this.manifest.version !== expectedIntegrity.version) {
      throw new Error(`VK Next version mismatch: expected ${expectedIntegrity.version}, got ${this.manifest.version}`);
    }

    this.integrity = await verifyExtensionIntegrity(this.extensionPath, expectedIntegrity);
    this.extension = await session.defaultSession.extensions.loadExtension(this.extensionPath);
    this.available = true;
    console.log(`[VKNext] Loaded verified artifact v${this.manifest.version}`);
    return this.getInfo();
  }

  isAvailable() {
    return this.available && Boolean(this.extension);
  }

  getInfo() {
    if (!this.extension || !this.manifest || !this.integrity) return null;
    return {
      id: this.extension.id,
      name: this.extension.name || 'VK Next',
      version: this.manifest.version,
      integrity: this.integrity.sha256,
      verified: true
    };
  }

  createSettingsWindow(parentWindow) {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return this.settingsWindow;
    }
    if (!this.extension) return null;

    const extensionOrigin = `chrome-extension://${this.extension.id}`;
    const popupUrl = `${extensionOrigin}/popup.html`;
    const allowedPages = new Set(['/popup.html', '/permissions.html']);
    const isAllowedExtensionPage = (targetUrl) => {
      try {
        const parsedUrl = new URL(targetUrl);
        return parsedUrl.protocol === 'chrome-extension:'
          && parsedUrl.hostname === this.extension.id
          && !parsedUrl.username
          && !parsedUrl.password
          && !parsedUrl.port
          && allowedPages.has(parsedUrl.pathname);
      } catch {
        return false;
      }
    };
    const openExternal = (targetUrl) => {
      const classification = classifyNavigationUrl(targetUrl);
      if (classification !== 'external' && classification !== 'external-confirmation') return;
      void this.openExternalUrl?.(targetUrl).catch((error) => {
        console.warn('[VKNext] Failed to open external URL:', error.message);
      });
    };

    this.settingsWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      minWidth: 960,
      minHeight: 600,
      parent: parentWindow,
      show: false,
      title: 'Настройки VK Next',
      autoHideMenuBar: true,
      backgroundColor: '#19191a',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    this.settingsWindow.center();

    this.settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExtensionPage(url)) {
        void this.settingsWindow?.loadURL(url).catch((error) => {
          console.warn('[VKNext] Internal settings navigation failed:', error.message);
        });
      } else {
        openExternal(url);
      }
      return { action: 'deny' };
    });
    this.settingsWindow.webContents.on('will-navigate', (event, targetUrl) => {
      if (isAllowedExtensionPage(targetUrl)) return;
      event.preventDefault();
      openExternal(targetUrl);
    });
    this.settingsWindow.webContents.on('did-fail-load', (
      _event,
      errorCode,
      errorDescription,
      failedUrl,
      isMainFrame
    ) => {
      if (!isMainFrame || errorCode === -3 || this.settingsWindow?.isDestroyed()) return;
      console.warn('[VKNext] Settings page failed:', errorCode, errorDescription);
      if (failedUrl === popupUrl) {
        this.settingsWindow?.destroy();
      } else {
        void this.settingsWindow?.loadURL(popupUrl).catch(() => this.settingsWindow?.destroy());
      }
    });
    void this.settingsWindow.loadURL(popupUrl).catch((error) => {
      console.warn('[VKNext] Failed to open settings:', error.message);
      this.settingsWindow?.destroy();
    });
    this.settingsWindow.once('ready-to-show', () => this.settingsWindow?.show());
    this.settingsWindow.on('closed', () => { this.settingsWindow = null; });
    return this.settingsWindow;
  }

  async unload() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.destroy();
    }
    this.settingsWindow = null;

    if (this.extension) {
      await session.defaultSession.extensions.removeExtension(this.extension.id);
    }
    this.extension = null;
    this.available = false;
    this.manifest = null;
    this.integrity = null;
  }

  async destroy() {
    await this.unload();
    this.extensionPath = null;
  }
}
