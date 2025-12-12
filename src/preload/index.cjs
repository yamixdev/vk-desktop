const { contextBridge, ipcRenderer } = require('electron');

// ============================================
// VK Desktop — Preload Script
// ============================================
// Этот скрипт запускается ДО загрузки страницы VK и служит мостом
// между веб-страницей и Electron. Здесь мы:
// - Добавляем кастомные стили (скроллбар, скрытие рекламы)
// - Парсим текущий трек для Discord Rich Presence
// - Обрабатываем уведомления и бейдж непрочитанных
// - Пробрасываем управление медиа-кнопками из трея
//
// Важно: скрипт работает в изолированном контексте (contextIsolation: true),
// поэтому для общения с основным процессом используем ipcRenderer,
// а для страницы — postMessage и contextBridge.
// ============================================

// Интервалы и таймауты (в миллисекундах)
const MUSIC_CHECK_INTERVAL = 1500;  // Как часто проверяем, что играет
const BADGE_DEBOUNCE_DELAY = 300;   // Задержка перед обновлением бейджа (чтобы не спамить)
const IDLE_TIMEOUT = 2000;          // Таймаут для отложенных задач

/**
 * Обёртка над requestIdleCallback.
 * Если браузер не поддерживает — просто используем setTimeout.
 * Нужна, чтобы не грузить страницу при загрузке.
 */
function scheduleIdle(callback, options = { timeout: IDLE_TIMEOUT }) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(callback, options);
  } else {
    setTimeout(callback, 50);
  }
}

/**
 * Добавляет наши CSS-стили в страницу.
 * Делаем это первым делом, чтобы скроллбар и скрытие рекламы
 * применились как можно раньше.
 */
function injectStyles() {
  const style = document.createElement('style');
  style.id = 'vk-desktop-styles';
  style.textContent = `
    /* Кастомный скроллбар в стиле VK */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #19191a; }
    ::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #666; }

    /* Прячем рекламные блоки — жить станет легче */
    #ads_left, .ads_ads_news_wrap, .ads_left, div[data-ad-view],
    .ads_ad_box, #ads_layer_wrap, .layout__ads_right {
      display: none !important;
      content-visibility: hidden;
    }
  `;
  
  // Вставляем стили в самое начало head, чтобы они применились раньше
  if (document.head.firstChild) {
    document.head.insertBefore(style, document.head.firstChild);
  } else {
    document.head.appendChild(style);
  }
}

// ============================================
// Инициализация при загрузке DOM
// ============================================
window.addEventListener('DOMContentLoaded', () => {
  // Сразу инжектим стили
  injectStyles();

  // Парсер музыки запускаем чуть позже, когда браузер освободится.
  // Он нужен для Discord Rich Presence — чтобы показывать, что сейчас играет.
  // Скрипт внедряется прямо в контекст страницы VK (через <script>),
  // потому что только там есть доступ к window.ap (API плеера VK).
  scheduleIdle(() => {
    const script = document.createElement('script');
    script.id = 'vk-desktop-music-parser';
    script.textContent = `
    (function() {
      'use strict';
      
      // Настройки
      const CHECK_INTERVAL = ${MUSIC_CHECK_INTERVAL};  // Как часто проверяем плеер
      const MIN_UPDATE_INTERVAL = 1000;                // Минимум между отправками
      const SIGNIFICANT_SEEK_THRESHOLD = 2;            // Порог перемотки (секунды)
      
      // Храним состояние, чтобы не спамить одинаковыми обновлениями
      let lastPayloadHash = '';
      let lastUpdateTime = 0;
      let lastProgress = 0;
      let checkTimer = null;
      
      // Парсим строку времени типа "3:45" или "1:23:45" в секунды
      function parseTimeStr(str) {
        if (!str) return 0;
        const parts = str.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
      }
      
      // Собираем "хэш" из инфы о треке, чтобы понять — изменилось что-то или нет
      function getPayloadHash(payload) {
        const roundedProgress = Math.floor(payload.progress / SIGNIFICANT_SEEK_THRESHOLD);
        return payload.title + '|' + payload.artist + '|' + payload.isPlaying + '|' + roundedProgress;
      }
      
      // Пытаемся вытащить обложку трека. VK хранит её в currentAudio[14].
      function getCoverUrl(currentAudio) {
        try {
          if (!currentAudio[14]) return '';
          
          const coverData = currentAudio[14];
          if (typeof coverData === 'string' && coverData.startsWith('http')) {
            let url = coverData.split(',')[0].trim();
            return url.replace(/^http:/, 'https:');  // Форсим HTTPS
          }
        } catch (e) {
          // Не страшно, если не получилось
        }
        return '';
      }
      
      // Основная функция — смотрим, что сейчас играет, и отправляем данные
      function checkAndUpdateMusic() {
        // window.ap — это внутренний API аудиоплеера VK
        if (!window.ap || typeof window.ap.getCurrentAudio !== 'function') {
          return;
        }
        
        try {
          const currentAudio = window.ap.getCurrentAudio();
          if (!currentAudio || !currentAudio[3]) return;  // [3] — название трека
          
          const isPlaying = window.ap.isPlaying();
          const rawTitle = currentAudio[3] || '';
          const rawArtist = currentAudio[4] || '';  // [4] — исполнитель
          
          let progress = window.ap.getCurrentProgress() || 0;
          let duration = parseInt(currentAudio[5]) || 0;  // [5] — длительность
          
          // Иногда API врёт про прогресс, поэтому сверяем с DOM
          const timeElements = document.querySelectorAll('span[class*="PlaybackProgressTime__text"]');
          if (timeElements.length > 0) {
            const domProgress = parseTimeStr(timeElements[0].textContent);
            if (Math.abs(progress - domProgress) > 1.5) {
              progress = domProgress;
            }
            if (!duration && timeElements.length > 1) {
              duration = parseTimeStr(timeElements[1].textContent);
            }
          }
          
          const coverUrl = getCoverUrl(currentAudio);
          const ownerId = currentAudio[1];
          const audioId = currentAudio[0];
          const trackUrl = 'https://vk.com/audio' + ownerId + '_' + audioId;
          
          // Название плейлиста (если есть)
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
          
          // Проверяем, стоит ли отправлять обновление
          const currentHash = getPayloadHash(payload);
          const now = Date.now();
          const timeSinceLastUpdate = now - lastUpdateTime;
          
          // Отправляем, если:
          // 1) Трек/статус изменился
          // 2) Или прошло 3+ секунды и музыка играет (чтобы обновлять прогресс)
          const hashChanged = currentHash !== lastPayloadHash;
          const periodicUpdate = isPlaying && timeSinceLastUpdate > 3000;
          
          if (hashChanged || periodicUpdate) {
            lastPayloadHash = currentHash;
            lastUpdateTime = now;
            lastProgress = progress;
            // Шлём в preload через postMessage, там поймаем и передадим в main process
            window.postMessage({ type: 'VK_MUSIC_UPDATE', payload }, '*');
          }
          
        } catch (e) {
          // Ошибки парсинга молча игнорируем — не критично
        }
      }
      
      // Запускаем периодическую проверку
      function scheduleCheck() {
        checkTimer = setTimeout(() => {
          checkAndUpdateMusic();
          scheduleCheck();
        }, CHECK_INTERVAL);
      }
      
      // Стартуем с небольшой задержкой, чтобы страница успела загрузиться
      setTimeout(scheduleCheck, 500);
      
      // Чистим за собой при уходе со страницы
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

// ============================================
// Обработка сообщений от страницы
// ============================================
// Страница VK шлёт нам postMessage с инфой о музыке и прочем.
// Мы ловим и пересылаем в main process.

window.addEventListener('message', (event) => {
  // Игнорируем сообщения не от нашего окна (безопасность)
  if (event.source !== window) return;
  
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  
  switch (data.type) {
    case 'VK_MUSIC_UPDATE':
      // Инфа о текущем треке — передаём в Discord RPC
      if (data.payload) {
        ipcRenderer.send('rpc:update', data.payload);
      }
      break;
      
    case 'VK_DESKTOP_OPEN_VK_NEXT_SETTINGS':
      // Открыть настройки расширения VK Next
      ipcRenderer.invoke('vk-next:open-settings').catch(() => {});
      break;
  }
}, { passive: true });

// ============================================
// Медиа-кнопки (play/pause/next/prev)
// ============================================
// Когда юзер жмёт кнопки в трее или на клавиатуре,
// main process шлёт нам команду, а мы кликаем по кнопкам плеера.

ipcRenderer.on('media:control', (event, command) => {
  // Селекторы кнопок плеера VK (могут меняться при обновлениях VK)
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
    // Если кнопку не нашли — пробуем через API плеера напрямую
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
      setTimeout(() => s.remove(), 50);
    }
  }
});

// ============================================
// Бейдж непрочитанных сообщений
// ============================================
// VK пишет количество непрочитанных в заголовок страницы: "(3) ВКонтакте"
// Мы следим за этим и обновляем бейдж на иконке приложения.

let badgeDebounceTimer = null;
let lastBadgeCount = -1;

const titleObserver = new MutationObserver(() => {
  // Не реагируем на каждое изменение — ждём BADGE_DEBOUNCE_DELAY мс
  if (badgeDebounceTimer) clearTimeout(badgeDebounceTimer);
  
  badgeDebounceTimer = setTimeout(() => {
    // Ищем число в скобках в начале заголовка
    const match = document.title.match(/^\((\d+)\)/);
    const count = match ? parseInt(match[1], 10) : 0;
    
    // Отправляем только если число изменилось
    if (count !== lastBadgeCount) {
      lastBadgeCount = count;
      ipcRenderer.send('app:badge', count);
    }
  }, BADGE_DEBOUNCE_DELAY);
});

/**
 * Запускает слежку за заголовком страницы.
 * Если <title> ещё нет — ждём, пока появится.
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
    // Заголовка пока нет — следим за head
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

// Запускаем, как только DOM готов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTitleObserver, { once: true });
} else {
  initTitleObserver();
}

// ============================================
// Подмена Notification API
// ============================================
// VK пытается показывать браузерные уведомления.
// Мы перехватываем их и показываем через систему Electron.

class VKNotificationShim extends EventTarget {
  constructor(title, options = {}) {
    super();
    ipcRenderer.invoke('vk:notification', {
      title: title || '',
      body: options.body || ''
    }).catch(() => {});
  }
  
  static get permission() { return 'granted'; }
  static requestPermission() { return Promise.resolve('granted'); }
  
  close() {}
}

// Заменяем window.Notification нашей заглушкой
Object.defineProperty(window, 'Notification', {
  value: VKNotificationShim,
  writable: false,
  configurable: false
});

// ============================================
// VK Desktop API
// ============================================
// Пробрасываем в страницу несколько полезных штук.
// Например, версию Electron и метод для открытия настроек VK Next.
//
// Важно: Chrome Extension API сюда НЕ добавляем — это делает vkNextManager.js

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
      
      isElectron: true
    });
    
    console.log('[Preload] vkDesktopAPI exposed');
  } else {
    console.warn('[Preload] contextIsolation disabled — skipping API exposure');
  }
} catch (error) {
  console.warn('[Preload] Failed to expose APIs:', error.message);
}

// ============================================
// Очистка при закрытии
// ============================================
window.addEventListener('beforeunload', () => {
  if (badgeDebounceTimer) {
    clearTimeout(badgeDebounceTimer);
    badgeDebounceTimer = null;
  }
  titleObserver.disconnect();
}, { once: true });