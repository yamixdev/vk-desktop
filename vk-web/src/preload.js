const { contextBridge, ipcRenderer } = require('electron');

// ========== КОНСТАНТЫ СЕЛЕКТОРОВ ==========
const SELECTORS = {
  ADS: [
    '.ads_ad_box', '.ads_ads_news_wrap', '#ads_left', '.TopBanner',
    '.SideBarAdv', '[data-ad-block-uid]', '[id^="ads_ad_"]',
    '.MarketPromoBanner', '.apps_promo_slider'
  ],
  GIFS: ['img[src*=".gif"]', '.vk_gift--anim']
};

// ========== БЕЗОПАСНОЕ API ДЛЯ РЕНДЕРЕРА ==========
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  requestLogout: () => ipcRenderer.send('request-logout'),
  navigateTo: (url) => ipcRenderer.send('navigate-to-url', url)
});

// ========== LAZY INITIALIZATION ==========
let initializationState = {
  isDone: false,
  observer: null,
  mediaController: null
};

/**
 * Главная функция инициализации (выполняется один раз)
 */
async function initializeApp() {
  if (initializationState.isDone) return;
  initializationState.isDone = true;

  console.log('[Preload] Запуск безопасных оптимизаций...');
  
  const config = await ipcRenderer.invoke('get-config');

  // 1. Применяем CSS патчи
  applyCSSPatches(config);
  
  // 2. Инициализируем блокировщик рекламы
  if (config.enableAdBlock) {
    initializeAdBlocker();
  }
  
  // 3. Инициализируем контроллер медиа
  initializeMediaControls(config);

  // 4. Слушаем команды навигации от main
  setupNavigationListener();

  // 5. Очистка при выгрузке страницы
  window.addEventListener('beforeunload', cleanup);
}

/**
 * Применяет CSS патчи
 */
function applyCSSPatches(config) {
  if (document.getElementById('vk-desktop-patches')) return;

  const style = document.createElement('style');
  style.id = 'vk-desktop-patches';
  
  const cssRules = [];
  
  // Плавная прокрутка
  cssRules.push(`:root { scroll-behavior: ${config.smoothScrolling ? 'smooth' : 'auto'} !important; }`);
  
  // Блокировка GIF
  if (config.blockGifs) {
    cssRules.push(`${SELECTORS.GIFS.join(', ')} { display: none !important; }`);
  }
  
  style.textContent = cssRules.join(' ');
  document.head.appendChild(style);
  console.log('[Preload] CSS патчи применены');
}

/**
 * Инициализирует блокировщик рекламы
 */
function initializeAdBlocker() {
  if (initializationState.observer) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return; // Только Element nodes
        
        SELECTORS.ADS.forEach(selector => {
          if (node.matches(selector)) {
            node.remove();
          } else {
            const elements = node.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach(el => el.remove());
            }
          }
        });
      });
    });
  });

  observer.observe(document.body, { 
    childList: true, 
    subtree: true,
    attributes: false // Оптимизация: не следим за атрибутами
  });
  
  initializationState.observer = observer;
  
  // Первичная очистка
  SELECTORS.ADS.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  console.log('[Preload] AdBlocker активирован');
}

/**
 * Инициализирует контроллер медиа
 */
function initializeMediaControls(config) {
  if (initializationState.mediaController) return;

  const state = {
    playing: [],
    max: config.maxConcurrentMedia || 2
  };

  // Пауза при скрытии окна
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      document.querySelectorAll('video, audio').forEach(media => {
        if (!media.paused) media.pause();
      });
    }
  });

  // Ограничение одновременного воспроизведения
  document.addEventListener('play', (event) => {
    const media = event.target;
    if (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO') return;

    // Очищаем отключенные элементы
    state.playing = state.playing.filter(m => m.isConnected);
    
    state.playing = state.playing.filter(m => m !== media);
    state.playing.unshift(media);

    while (state.playing.length > state.max) {
      const oldMedia = state.playing.pop();
      if (oldMedia && !oldMedia.paused) {
        oldMedia.pause();
      }
    }
  }, true);

  initializationState.mediaController = state;
  console.log(`[Preload] MediaControl активирован (max: ${state.max})`);
}

/**
 * Настраивает слушатель навигации
 */
function setupNavigationListener() {
  ipcRenderer.on('navigate-in-window', (event, url) => {
    if (url && url.startsWith('https://') && isTrustedUrl(url)) {
      window.location.href = url;
    }
  });
}

/**
 * Очищает ресурсы при выгрузке страницы
 */
function cleanup() {
  if (initializationState.observer) {
    initializationState.observer.disconnect();
    initializationState.observer = null;
  }
  
  // Очищаем media state
  if (initializationState.mediaController) {
    initializationState.mediaController.playing = [];
    initializationState.mediaController = null;
  }
  
  console.log('[Preload] Ресурсы очищены');
}

/**
 * Проверка URL на безопасность (для preload)
 */
function isTrustedUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru'].includes(hostname);
  } catch {
    return false;
  }
}

// ========== ЗАПУСК ==========
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}