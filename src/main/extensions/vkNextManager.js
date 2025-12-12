/**
 * VK Next Extension Manager
 * Управляет загрузкой расширения VK Next через нативный Electron API.
 *
 * Использует session.extensions.loadExtension() для полноценной загрузки Chrome расширения,
 * как это работает в обычном Chrome браузере.
 *
 * @description Выполняется в Main Process
 * @version 2.1.0
 */

import { session, BrowserWindow, app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { getRootPath } from '../utils.js';

/**
 * Проверяет, поддерживает ли текущая версия Electron новый API extensions
 * @returns {boolean}
 */
function supportsExtensionsAPI() {
  // Electron 28+ поддерживает session.extensions
  const electronVersion = process.versions.electron;
  const majorVersion = parseInt(electronVersion.split('.')[0], 10);
  return majorVersion >= 28 && typeof session.defaultSession.extensions !== 'undefined';
}

/**
 * Менеджер расширения VK Next
 * Обеспечивает загрузку расширения через нативный Electron API.
 */
export default class VKNextManager {
  constructor() {
    /** @type {Electron.Extension|null} Загруженное расширение */
    this.extension = null;
    
    /** @type {string} Путь к директории расширения */
    this.extensionPath = path.join(getRootPath(), 'extensions', 'vk-next');
    
    /** @type {boolean} Флаг доступности расширения */
    this.available = false;
    
    /** @type {Object|null} Данные манифеста расширения */
    this.manifest = null;
    
    /** @type {BrowserWindow|null} Окно настроек расширения */
    this.settingsWindow = null;
  }

  /**
   * Создает полифилл для chrome.storage.sync
   * Electron не поддерживает sync storage, поэтому эмулируем через local
   * @returns {string} JavaScript код полифилла
   */
  _createStorageSyncPolyfill() {
    return `
      (function() {
        'use strict';
        
        // Проверяем, нужен ли полифилл
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Если sync не определен или выбрасывает ошибку, создаем полифилл
          const originalSync = chrome.storage.sync;
          
          // Полифилл sync через local storage
          const syncPolyfill = {
            get: function(keys, callback) {
              return chrome.storage.local.get(keys, callback);
            },
            set: function(items, callback) {
              return chrome.storage.local.set(items, callback);
            },
            remove: function(keys, callback) {
              return chrome.storage.local.remove(keys, callback);
            },
            clear: function(callback) {
              return chrome.storage.local.clear(callback);
            },
            getBytesInUse: function(keys, callback) {
              if (callback) callback(0);
              return Promise.resolve(0);
            },
            QUOTA_BYTES: 102400,
            QUOTA_BYTES_PER_ITEM: 8192,
            MAX_ITEMS: 512,
            MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
            MAX_WRITE_OPERATIONS_PER_MINUTE: 120
          };
          
          // Переопределяем sync
          try {
            Object.defineProperty(chrome.storage, 'sync', {
              value: syncPolyfill,
              writable: false,
              configurable: true
            });
            console.log('[VKNext] chrome.storage.sync polyfill installed');
          } catch (e) {
            // Если не удалось переопределить, пробуем другой способ
            chrome.storage.sync = syncPolyfill;
          }
        }
      })();
    `;
  }
  
  /**
   * Загружает расширение через session.extensions.loadExtension() (Electron 28+)
   * или session.loadExtension() (legacy)
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const manifestPath = path.join(this.extensionPath, 'manifest.json');
      
      // Проверяем существование файла манифеста
      await fs.access(manifestPath);
      
      // Читаем манифест для получения информации
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestContent);
      
      // Добавляем полифилл для chrome.storage.sync перед загрузкой расширения
      // Это нужно делать через webRequest, чтобы полифилл загружался до скриптов расширения
      this._setupStorageSyncPolyfill();
      
      // Загружаем расширение через нативный Electron API
      // Используем новый API если доступен (Electron 28+)
      const loadOptions = { allowFileAccess: true };
      
      if (supportsExtensionsAPI()) {
        // Новый API (Electron 28+)
        this.extension = await session.defaultSession.extensions.loadExtension(
          this.extensionPath,
          loadOptions
        );
      } else {
        // Legacy API (deprecated в Electron 28+)
        this.extension = await session.defaultSession.loadExtension(
          this.extensionPath,
          loadOptions
        );
      }
      
      this.available = true;
      console.log(`[VKNext] Extension loaded: ${this.extension.name} v${this.manifest.version}`);
      console.log(`[VKNext] Extension ID: ${this.extension.id}`);
      
    } catch (error) {
      this.available = false;
      console.warn('[VKNext] Failed to load extension:', error.message);
      
      // Подробная диагностика ошибки
      if (error.message.includes('Loading extension')) {
        console.warn('[VKNext] Extension manifest may be invalid or incompatible');
      }
      
      throw error;
    }
  }
  
  /**
   * Настраивает полифилл для chrome.storage.sync
   * Инъектирует скрипт в страницы перед загрузкой расширения
   */
  _setupStorageSyncPolyfill() {
    const polyfillCode = this._createStorageSyncPolyfill();
    
    // Инъектируем полифилл при загрузке страницы
    session.defaultSession.webRequest.onCompleted(
      { urls: ['*://*.vk.com/*', '*://*.vk.ru/*'] },
      (details) => {
        if (details.resourceType === 'mainFrame') {
          // Получаем webContents и инъектируем полифилл
          // BrowserWindow уже импортирован в начале файла
          const allWindows = BrowserWindow.getAllWindows();
          
          for (const win of allWindows) {
            if (!win.isDestroyed() && win.webContents.id === details.webContentsId) {
              win.webContents.executeJavaScript(polyfillCode, true)
                .catch(err => console.warn('[VKNext] Polyfill injection failed:', err.message));
              break;
            }
          }
        }
      }
    );
    
    console.log('[VKNext] Storage sync polyfill handler registered');
  }

  /**
   * Проверяет, доступно ли расширение
   * @returns {boolean}
   */
  isAvailable() {
    return this.available && this.extension !== null;
  }

  /**
   * Получает информацию о расширении
   * @returns {Object|null}
   */
  getInfo() {
    if (!this.extension || !this.manifest) return null;
    
    return {
      id: this.extension.id,
      name: this.extension.name || this.manifest.name || 'VK Next',
      version: this.manifest.version || 'unknown',
      description: this.manifest.description || '',
      homepage: this.manifest.homepage_url || null,
      permissions: this.manifest.permissions || [],
      path: this.extension.path
    };
  }

  /**
   * Инъектирует content scripts в webContents
   * При использовании loadExtension() это делается автоматически!
   * Этот метод оставлен для совместимости, но ничего не делает.
   * @param {Electron.WebContents} webContents - WebContents для инъекции
   * @returns {Promise<void>}
   */
  async injectContentScripts(webContents) {
    // При использовании session.loadExtension() 
    // content scripts инъектируются автоматически!
    // Этот метод оставлен для обратной совместимости.
    
    if (!this.isAvailable()) {
      return;
    }
    
    // Логируем для отладки
    console.log('[VKNext] Content scripts are injected automatically by Electron');
  }

  /**
   * Создает окно настроек расширения (popup)
   * @param {BrowserWindow} parentWindow - Родительское окно
   * @returns {BrowserWindow|null}
   */
  createSettingsWindow(parentWindow) {
    // Если окно уже открыто - фокусируемся на нём
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return this.settingsWindow;
    }

    if (!this.extension) {
      console.warn('[VKNext] Cannot open settings - extension not loaded');
      return null;
    }

    // Получаем URL popup страницы расширения
    const popupUrl = `chrome-extension://${this.extension.id}/popup.html`;
    
    this.settingsWindow = new BrowserWindow({
      width: 400,
      height: 600,
      parent: parentWindow,
      modal: false,
      show: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        // Для popup расширения используем те же настройки что и для расширения
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.settingsWindow.loadURL(popupUrl);
    
    this.settingsWindow.once('ready-to-show', () => {
      if (!this.settingsWindow.isDestroyed()) {
        this.settingsWindow.show();
      }
    });

    // Очищаем ссылку при закрытии
    this.settingsWindow.on('closed', () => {
      this.settingsWindow = null;
    });

    return this.settingsWindow;
  }

  /**
   * Выгружает расширение
   * @returns {Promise<void>}
   */
  async unload() {
    if (this.extension) {
      try {
        if (supportsExtensionsAPI()) {
          // Новый API (Electron 28+)
          await session.defaultSession.extensions.removeExtension(this.extension.id);
        } else {
          // Legacy API
          await session.defaultSession.removeExtension(this.extension.id);
        }
        console.log(`[VKNext] Extension unloaded: ${this.extension.id}`);
      } catch (error) {
        console.warn('[VKNext] Failed to unload extension:', error.message);
      }
    }
  }

  /**
   * Очищает ресурсы
   * @returns {void}
   */
  destroy() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.close();
      this.settingsWindow = null;
    }
    
    // Не выгружаем расширение при destroy, так как это может быть при закрытии приложения
    // и session уже может быть недоступен
    
    this.manifest = null;
    this.extension = null;
    this.available = false;
    
    console.log('[VKNext] Manager destroyed');
  }

  /**
   * Получает список всех загруженных расширений
   * @returns {Electron.Extension[]}
   */
  static getAllExtensions() {
    if (supportsExtensionsAPI()) {
      return session.defaultSession.extensions.getAllExtensions();
    }
    return session.defaultSession.getAllExtensions();
  }

  /**
   * Проверяет, включено ли расширение в конфигурации
   * @param {Object} config - Конфигурация приложения
   * @returns {boolean}
   */
  static isEnabled(config) {
    return config.enableVKNext !== false;
  }
}