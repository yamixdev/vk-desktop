import { session, BrowserWindow, app, dialog } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getUnpackedPath, getRootPath } from '../utils.js';

function getExtensionSession() {
  return session.defaultSession;
}

export default class VKNextManager {
  constructor() {
    this.extension = null;
    this.manifest = null;
    this.settingsWindow = null;
    this.available = false;
    this.extensionPath = null;
  }

  /**
   * Логика поиска пути.
   * Пытаемся найти папку и возвращаем путь, если нашли manifest.json
   */
  _findPath() {
    const pathsToCheck = [];

    // 1. Путь для Production (собранное приложение)
    // C:\...\resources\app.asar.unpacked\extensions\vk-next
    if (app.isPackaged) {
      pathsToCheck.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'vk-next'));
      // На всякий случай проверим и просто в resources (вдруг конфиг билдера изменился)
      pathsToCheck.push(path.join(process.resourcesPath, 'extensions', 'vk-next'));
    }

    // 2. Путь для Dev (разработка)
    pathsToCheck.push(path.join(app.getAppPath(), 'extensions', 'vk-next'));
    pathsToCheck.push(path.join(process.cwd(), 'extensions', 'vk-next'));

    // Перебираем все варианты
    for (const p of pathsToCheck) {
      try {
        if (fsSync.existsSync(path.join(p, 'manifest.json'))) {
          console.log(`[VKNext] Found at: ${p}`);
          return p;
        }
      } catch (e) {}
    }

    // Если ничего не нашли - возвращаем null и список проверенных путей для отладки
    return { error: true, checked: pathsToCheck };
  }
  
  async load() {
    const result = this._findPath();

    // Если не нашли путь
    if (result && result.error) {
      console.error('[VKNext] Extension not found!');
      
      // ПОКАЗЫВАЕМ ОШИБКУ ТОЛЬКО В БИЛДЕ
      if (app.isPackaged) {
        dialog.showErrorBox(
          'VK Next Error', 
          `Не удалось найти расширение.\n\nЯ искал здесь:\n${result.checked.join('\n')}\n\nПроверьте папку resources.`
        );
      }
      this.available = false;
      return;
    }

    this.extensionPath = result;

    try {
      console.log(`[VKNext] Loading from: ${this.extensionPath}`);
      
      const manifestPath = path.join(this.extensionPath, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestContent);
      
      const sess = getExtensionSession();
      
      if (sess.extensions && typeof sess.extensions.loadExtension === 'function') {
         this.extension = await sess.extensions.loadExtension(this.extensionPath, { allowFileAccess: true });
      } else {
         this.extension = await sess.loadExtension(this.extensionPath, { allowFileAccess: true });
      }
      
      this.available = true;
      console.log(`[VKNext] Loaded: ${this.extension.name}`);
      
    } catch (error) {
      this.available = false;
      console.warn('[VKNext] Failed to load:', error.message);
      
      if (app.isPackaged) {
        dialog.showErrorBox('VK Next Load Error', `Ошибка загрузки:\n${error.message}\nПуть: ${this.extensionPath}`);
      }
    }
  }

  isAvailable() {
    return this.available && this.extension !== null;
  }

  getInfo() {
    if (!this.extension || !this.manifest) return null;
    return {
      id: this.extension.id,
      name: this.extension.name || 'VK Next',
      version: this.manifest.version || 'unknown',
    };
  }

  createSettingsWindow(parentWindow) {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    if (!this.extension) return null;

    const popupUrl = `chrome-extension://${this.extension.id}/popup.html`;
    
    this.settingsWindow = new BrowserWindow({
      width: 400, height: 600,
      parent: parentWindow,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });

    this.settingsWindow.loadURL(popupUrl);
    this.settingsWindow.once('ready-to-show', () => this.settingsWindow.show());
    this.settingsWindow.on('closed', () => { this.settingsWindow = null; });
    return this.settingsWindow;
  }

  async unload() {
    // тут пусто =)
  }

  destroy() {
    if (this.settingsWindow) this.settingsWindow.close();
    this.settingsWindow = null;
    this.extension = null;
    this.available = false;
  }
}