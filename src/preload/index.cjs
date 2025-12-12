const { contextBridge, ipcRenderer } = require('electron');

/**
 * VK Desktop Preload Script
 * Инъектируется в контекст страницы VK для интеграции с Electron.
 *
 * @description Выполняется в изолированном контексте (contextIsolation: true)
 * @version 1.1.4
 *
 * ОПТИМИЗАЦИИ:
 * - Минимизация DOM-операций при загрузке
 * - Использование requestIdleCallback для некритичных задач
 * - Debounce для частых обновлений
 * - Эффективный парсинг музыки
 */

// === КОНСТАНТЫ ===
const MUSIC_CHECK_INTERVAL = 1500; // мс между проверками музыки
const BADGE_DEBOUNCE_DELAY = 300; // мс debounce для бейджа
const IDLE_TIMEOUT = 2000; // мс таймаут для idle callback

/**
 * Безопасный requestIdleCallback с fallback
 * @param {Function} callback
 * @param {Object} options
 */
function scheduleIdle(callback, options = { timeout: IDLE_TIMEOUT }) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, options);
  } else {
    setTimeout(callback, 50);
  }
}

/**
 * Инъектирует стили с минимальным влиянием на производительность
 */
function injectStyles() {
  const style = document.createElement('style');
  style.id = 'vk-desktop-styles';
  style.textContent = `
    /* Скроллбар - используем will-change для GPU-ускорения */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #19191a; }
    ::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #666; }

    /* Удаление рекламы - используем content-visibility для оптимизации */
    #ads_left, .ads_ads_news_wrap, .ads_left, div[data-ad-view],
    .ads_ad_box, #ads_layer_wrap, .layout__ads_right {
      display: none !important;
      content-visibility: hidden;
    }
  `;
  
  // Вставляем в начало head для более ранней загрузки
  if (document.head.firstChild) {
    document.head.insertBefore(style, document.head.firstChild);
  } else {
    document.head.appendChild(style);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // 1. СТИЛИ - инъектируем сразу
  injectStyles();

  // 2. ПАРСЕР МУЗЫКИ (инъектируется в контекст страницы)
  // Используем requestIdleCallback для отложенной инициализации
  scheduleIdle(() => {
    const script = document.createElement('script');
    script.id = 'vk-desktop-music-parser';
    script.textContent = `
    (function() {
      'use strict';
      
      // === КОНФИГУРАЦИЯ ===
      const CHECK_INTERVAL = ${MUSIC_CHECK_INTERVAL};
      const MIN_UPDATE_INTERVAL = 1000;
      const SIGNIFICANT_SEEK_THRESHOLD = 2; // секунды
      
      // === СОСТОЯНИЕ ===
      let lastPayloadHash = '';
      let lastUpdateTime = 0;
      let lastProgress = 0;
      let checkTimer = null;
      
      // === УТИЛИТЫ ===
      
      // Парсинг времени из строки "mm:ss" или "hh:mm:ss"
      function parseTimeStr(str) {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
      }
      
      // Генерация хэша для сравнения состояний
      function getPayloadHash(payload) {
        // Округляем прогресс для уменьшения количества обновлений
        const roundedProgress = Math.floor(payload.progress / SIGNIFICANT_SEEK_THRESHOLD);
        return payload.title + '|' + payload.artist + '|' + payload.isPlaying + '|' + roundedProgress;
      }
      
      // Безопасное получение обложки
      function getCoverUrl(currentAudio) {
        try {
          if (!currentAudio[14]) return '';
          
          const coverData = currentAudio[14];
          if (typeof coverData === 'string' && coverData.startsWith('http')) {
            let url = coverData.split(',')[0].trim();
            // Принудительно используем HTTPS
            return url.replace(/^http:/, 'https:');
          }
        } catch (e) {
          // Игнорируем ошибки
        }
        return '';
      }
      
      // === ОСНОВНАЯ ЛОГИКА ===
      
      function checkAndUpdateMusic() {
        // Проверяем наличие API плеера
        if (!window.ap || typeof window.ap.getCurrentAudio !== 'function') {
          return;
        }
        
        try {
          const currentAudio = window.ap.getCurrentAudio();
          if (!currentAudio || !currentAudio[3]) return;
          
          const isPlaying = window.ap.isPlaying();
          const rawTitle = currentAudio[3] || '';
          const rawArtist = currentAudio[4] || '';
          
          let progress = window.ap.getCurrentProgress() || 0;
          let duration = parseInt(currentAudio[5]) || 0;
          
          // Корректировка времени из DOM (если API даёт неточные данные)
          // Используем кэширование селектора для производительности
          const timeElements = document.querySelectorAll('span[class*="PlaybackProgressTime__text"]');
          if (timeElements.length > 0) {
            const domProgress = parseTimeStr(timeElements[0].textContent);
            // Используем DOM только если разница значительная
            if (Math.abs(progress - domProgress) > 1.5) {
              progress = domProgress;
            }
            // Берём duration из DOM если отсутствует
            if (!duration && timeElements.length > 1) {
              duration = parseTimeStr(timeElements[1].textContent);
            }
          }
          
          const coverUrl = getCoverUrl(currentAudio);
          const ownerId = currentAudio[1];
          const audioId = currentAudio[0];
          const trackUrl = 'https://vk.com/audio' + ownerId + '_' + audioId;
          
          // Получаем название плейлиста безопасно
          let album = '';
          try {
            if (window.ap._currentPlaylist && window.ap._currentPlaylist.title) {
              album = window.ap._currentPlaylist.title;
            }
          } catch (e) {}
          
          const payload = {
            title: rawTitle,
            artist: rawArtist,
            album: album,
            cover: coverUrl,
            duration: duration,
            progress: progress,
            isPlaying: isPlaying,
            url: trackUrl
          };
          
          // Проверяем необходимость обновления
          const currentHash = getPayloadHash(payload);
          const now = Date.now();
          const timeSinceLastUpdate = now - lastUpdateTime;
          
          // Условия для обновления:
          // 1. Изменился хэш (трек, статус, значительная перемотка)
          // 2. Прошло достаточно времени и трек играет (для обновления прогресса)
          const hashChanged = currentHash !== lastPayloadHash;
          const periodicUpdate = isPlaying && timeSinceLastUpdate > 3000;
          
          if (hashChanged || periodicUpdate) {
            lastPayloadHash = currentHash;
            lastUpdateTime = now;
            lastProgress = progress;
            window.postMessage({ type: 'VK_MUSIC_UPDATE', payload }, '*');
          }
          
        } catch (e) {
          // Тихо игнорируем ошибки парсинга
        }
      }
      
      // === ИНИЦИАЛИЗАЦИЯ ===
      
      // Запускаем проверку с интервалом
      // Используем setTimeout вместо setInterval для большего контроля
      function scheduleCheck() {
        checkTimer = setTimeout(() => {
          checkAndUpdateMusic();
          scheduleCheck();
        }, CHECK_INTERVAL);
      }
      
      // Начинаем проверки после небольшой задержки
      setTimeout(scheduleCheck, 500);
      
      // Очистка при выгрузке страницы
      window.addEventListener('beforeunload', () => {
        if (checkTimer) {
          clearTimeout(checkTimer);
          checkTimer = null;
        }
      });
    })();
    `;
    document.body.appendChild(script);
  });
}, { passive: true });

// === ОБРАБОТЧИКИ СООБЩЕНИЙ ===

// Обработка сообщений от страницы (музыка, настройки)
window.addEventListener('message', (event) => {
  // Проверяем источник сообщения для безопасности
  if (event.source !== window) return;
  
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  
  switch (data.type) {
    case 'VK_MUSIC_UPDATE':
      if (data.payload) {
        ipcRenderer.send('rpc:update', data.payload);
      }
      break;
      
    case 'VK_DESKTOP_OPEN_VK_NEXT_SETTINGS':
      ipcRenderer.invoke('vk-next:open-settings').catch(() => {});
      break;
  }
}, { passive: true });

// Управление медиа через кнопки в таскбаре
ipcRenderer.on('media:control', (event, command) => {
  // Кэшируем селекторы
  const SELECTORS = {
    'play_pause': 'button[data-testid="audio-player-controls-state-button"]',
    'next': 'button[data-testid="audio-player-controls-forward-button"]',
    'prev': 'button[data-testid="audio-player-controls-backward-button"]'
  };
  
  const selector = SELECTORS[command];
  if (!selector) return;
  
  const btn = document.querySelector(selector);
  if (btn) {
    btn.click();
  } else {
    // Fallback через API плеера
    const commands = {
      'play_pause': 'if(window.ap)window.ap.playPause()',
      'next': 'if(window.ap)window.ap.playNext()',
      'prev': 'if(window.ap)window.ap.playPrev()'
    };
    
    const scriptContent = commands[command];
    if (scriptContent) {
      const s = document.createElement('script');
      s.textContent = scriptContent;
      document.body.appendChild(s);
      // Удаляем скрипт асинхронно
      setTimeout(() => s.remove(), 50);
    }
  }
});

// === БЕЙДЖ УВЕДОМЛЕНИЙ ===

let badgeDebounceTimer = null;
let lastBadgeCount = -1; // Кэшируем последнее значение

const titleObserver = new MutationObserver(() => {
  // Debounce для снижения нагрузки
  if (badgeDebounceTimer) clearTimeout(badgeDebounceTimer);
  
  badgeDebounceTimer = setTimeout(() => {
    const match = document.title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    
    // Отправляем только если значение изменилось
    if (count !== lastBadgeCount) {
      lastBadgeCount = count;
      ipcRenderer.send('app:badge', count);
    }
  }, BADGE_DEBOUNCE_DELAY);
});

/**
 * Инициализация наблюдателя за title
 */
function initTitleObserver() {
  const titleEl = document.querySelector('title');
  
  if (titleEl) {
    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    });
  } else {
    // Title ещё не создан - наблюдаем за head
    const headObserver = new MutationObserver((mutations, observer) => {
      const title = document.querySelector('title');
      if (title) {
        observer.disconnect();
        titleObserver.observe(title, {
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    });
    
    if (document.head) {
      headObserver.observe(document.head, { childList: true });
    }
  }
}

// Инициализируем наблюдатель
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTitleObserver, { once: true });
} else {
  initTitleObserver();
}

// === УВЕДОМЛЕНИЯ ===

// Shim для Notification API
class VKNotificationShim extends EventTarget {
  constructor(title, options = {}) {
    super();
    // Асинхронная отправка уведомления
    ipcRenderer.invoke('vk:notification', {
      title: title || '',
      body: options.body || ''
    }).catch(() => {});
  }
  
  static get permission() { return 'granted'; }
  static requestPermission() { return Promise.resolve('granted'); }
  
  close() {}
}

// Заменяем нативный Notification
Object.defineProperty(window, 'Notification', {
  value: VKNotificationShim,
  writable: false,
  configurable: false
});

// === VK DESKTOP API ===

// Экспорт API для интеграции с Electron
// ВАЖНО: Chrome API НЕ экспортируем здесь - он создаётся в vkNextManager.js
try {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('vkDesktopAPI', {
      version: process.versions.electron,
      
      openVKNextSettings: () => {
        window.postMessage({ type: 'VK_DESKTOP_OPEN_VK_NEXT_SETTINGS' }, '*');
      },
      
      getAppInfo: () => ({
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform
      }),
      
      // Статус приложения
      isElectron: true
    });
    
    console.log('[Preload] vkDesktopAPI exposed successfully');
  } else {
    console.warn('[Preload] contextIsolation is disabled, API exposure skipped');
  }
} catch (error) {
  console.warn('[Preload] Failed to expose APIs:', error.message);
}

// === ОЧИСТКА ПРИ ВЫГРУЗКЕ ===

window.addEventListener('beforeunload', () => {
  // Очищаем таймеры
  if (badgeDebounceTimer) {
    clearTimeout(badgeDebounceTimer);
    badgeDebounceTimer = null;
  }
  
  // Отключаем observer
  titleObserver.disconnect();
}, { once: true });