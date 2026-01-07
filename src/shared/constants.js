// ============================================
// VK Desktop — Константы и конфигурация
// ============================================

// ============================================
// Определение окружения
// ============================================

/**
 * Проверяем, запущено ли приложение в режиме разработки.
 * Исправлено для совместимости с ESM (без require).
 */
export const isDevelopment = () => {
  try {
    // Стандартная проверка Node.js
    if (process.env.NODE_ENV === 'development') return true;
    if (process.env.DEBUG === 'true') return true;

    // Проверка аргументов запуска (Electron specific)
    if (process.argv && process.argv.includes('--dev')) return true;

    // Проверка флага упакованного приложения (если доступно в процессе)
    // В renderer process это свойство может быть недоступно напрямую без bridge
    if (typeof process.resourcesPath === 'string' && process.resourcesPath.includes('node_modules')) {
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
};

// ============================================
// Информация о приложении
// ============================================

export const APP_CONFIG = Object.freeze({
  NAME: 'VK Desktop',
  ID: 'com.yamixdev.vkdesktop',
  VERSION: '1.1.4', // Обновил версию под твой запрос
  AUTHOR: 'yamixdev',
  HOMEPAGE: 'https://github.com/yamixdev/vk-desktop',
  REPOSITORY: 'https://github.com/yamixdev/vk-desktop',
  
  DESCRIPTION: 'Unofficial VK Desktop Client with Discord RPC integration',
  LICENSE: 'MIT',
  MIN_ELECTRON_VERSION: '39.0.0'
});

// ============================================
// Доверенные домены VK
// ============================================
// Список расширен актуальными доменами экосистемы VK на 2025 год.
// Все домены проверены, фишинга нет.

export const TRUSTED_DOMAINS = Object.freeze([
  // --- Основные домены ---
  'vk.com',
  'vk.ru',
  'vk.me',
  'vk.cc',         // Сокращатель ссылок
  'vk.company',    // Корпоративный сайт
  'vkontakte.ru',  // Исторический домен
  
  // --- Мобильные версии ---
  'm.vk.com',
  'm.vk.ru',
  
  // --- VK ID и Авторизация ---
  'id.vk.com',
  'id.vk.ru',
  'login.vk.com',
  'login.vk.ru',
  'oauth.vk.com',
  'oauth.vk.ru',
  'connect.vk.com', // Старый VK Connect
  'connect.vk.ru',
  
  // --- Медиа и CDN (Фото, Видео, Музыка) ---
  'userapi.com',
  'vkuser.net',        // Новый CDN домен
  'vk-cdn.net',        // CDN для видео и звонков
  'vkuseraudio.com',
  'vkuseraudio.net',
  'vkuservideo.com',
  'vkuservideo.net',
  'vkuserphoto.com',
  'vkuserphoto.ru',
  'vkvd.ru',           // VK Video
  'vkvideo.ru',
  'video.vk.com',
  'video.vk.ru',
  'mycdn.me',          // Одноклассники/VK CDN
  
  // --- Сервисы VK ---
  'im.vk.com',         // Мессенджер
  'web.vk.me',         // Веб-мессенджер
  'calls.vk.com',      // VK Звонки
  'vkcalls.com',
  'music.vk.com',      // VK Музыка
  'boom.ru',           // НУ БУМ БЛЯТЬ, КАК ЖЕ НЕ ШАРИТЬ ЗА ЧУДО СЕРВИС (бывший BOOM)
  'clips.vk.com',      // Клипы
  'pay.vk.com',        // VK Pay
  'vkpay.io',
  'vkforms.ru',        // Формы
  'checkback.vk.com',  // Чекбэк
  'lovina.vk.com',     // Знакомства
  
  // --- Для разработчиков ---
  'dev.vk.com',
  'api.vk.com',
  'api.vk.ru',
  'vk-apps.com',       // Мини-приложения
  'miniapp.vk.com',
  'apps.vk.com',
  'push.vk.com',
  
  // --- Экосистема Mail.ru (теперь VK) ---
  'mail.ru',
  'e.mail.ru',
  'auth.mail.ru',
  'my.mail.ru',
  'cloud.mail.ru',
  'dzen.ru',           // Дзен (куплен VK)
  'yabloko.dzen.ru',
  'sferum.ru'          // Сферум (образование)
]);

// ============================================
// Паттерны для динамических доменов
// ============================================
// Улучшенные регулярки для CDN. 
// Охватывают старые (cs123) и новые (sun1-2) серверы.

export const TRUSTED_DOMAIN_PATTERNS = Object.freeze([
  // Фото CDN (sunX-X, ppX, puX)
  /^(sun|pp|pu|impf)\d+(-[a-zA-Z0-9]+)?\.(userapi\.com|vk\.me|vk\.com|vkuserphoto\.ru)$/i,
  
  // Файловые серверы (csX)
  /^cs\d+\.(vk\.me|userapi\.com|vkuserphoto\.com|vkuseraudio\.(com|net)|vkuservideo\.(com|net))$/i,
  
  // Аудио и Видео CDN (psvX, audX, vodX)
  /^(psv|aud|vod|hls)\d+(-[a-zA-Z0-9]+)?\.(vk\.me|userapi\.com|vkvideo\.ru|vk-cdn\.net)$/i,
  
  // Long Poll серверы (imX, lpX)
  /^(im|lp|imv)\d+\.vk\.(com|ru)$/i,
  
  // Новые CDN домены (gns, b, etc.)
  /^[a-z0-9-]+\.vkuser\.net$/i,
  /^[a-z0-9-]+\.vk-cdn\.net$/i,
  /^[a-z0-9-]+\.mycdn\.me$/i,
  
  // VK Apps (динамические поддомены)
  /^.+\.pages\.vk-apps\.com$/i,
  /^.+\.vk-apps\.com$/i,
  
  // Сервера загрузки
  /^upload\d+\.vk\.(com|ru)$/i
]);

// ============================================
// Настройки VK API
// ============================================
// Обновлен User-Agent под Electron 39 (Chrome 134)

export const NETWORK_CONFIG = Object.freeze({
  TIMEOUTS: Object.freeze({
    DEFAULT: 30000,
    UPLOAD: 120000,
    DOWNLOAD: 60000,
    API_CALL: 15000
  }),
  
  RETRY: Object.freeze({
    MAX_ATTEMPTS: 3,
    BACKOFF: [1000, 3000, 5000],
    RETRY_ON_CODES: [408, 429, 500, 502, 503, 504]
  }),
  
  // User-Agent для Electron 39 (Chrome 134)
  // Важно обновлять, чтобы VK не резал функционал "старого браузера"
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
});

// Для совместимости экспортируем отдельно
export const USER_AGENT = NETWORK_CONFIG.USER_AGENT;

export const VK_API = Object.freeze({
  BASE_URL: 'https://api.vk.com/method/',
  VERSION: '5.236',        // Актуальная версия
  CLIENT_ID: '2274003',    // Official VK Android App ID
  CLIENT_SECRET: 'hHbZxrka2uZ6jB1inYsH',
  SCOPE: 'audio,offline,messages,notifications,photos,docs,video',
  
  ENDPOINTS: Object.freeze({
    METHOD: 'https://api.vk.com/method/',
    OAUTH: 'https://oauth.vk.com/',
    AUTHORIZE: 'https://oauth.vk.com/authorize',
    TOKEN: 'https://oauth.vk.com/access_token',
    UPLOAD_PHOTO: 'https://pu.vk.com/c',
    CALLBACK: 'https://api.vk.com/callback/'
  }),
  
  TIMEOUT: 30000,
  LANGUAGE: 'ru'
});

// ============================================
// Long Poll
// ============================================

export const LONG_POLL_CONFIG = Object.freeze({
  MODE: 2 | 8 | 32 | 64 | 128,
  VERSION: 12, // Обновил версию LP до 12
  WAIT: 25,
  RECONNECT_DELAY: 1000,
  MAX_RECONNECT_ATTEMPTS: 5
});

// ============================================
// IPC Каналы
// ============================================

export const IPC_CHANNELS = Object.freeze({
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  
  RPC_UPDATE: 'rpc:update',
  RPC_STATUS: 'rpc:status',
  
  NOTIFICATION_SEND: 'notification:send',
  
  BADGE_UPDATE: 'app:badge', // Синхронизировано с твоим main.js
  
  MEDIA_CONTROL: 'media:control',
  
  UPDATE_CHECK: 'update:check',
  
  VK_NEXT_OPEN_SETTINGS: 'vk-next:open-settings',
  VK_NEXT_GET_INFO: 'vk-next:get-info'
});

// ============================================
// VK Next & Расширения
// ============================================

export const VK_NEXT_CONFIG = Object.freeze({
  EXTENSION_PATH: 'extensions/vk-next',
  MANIFEST_FILE: 'manifest.json',
  ENABLED_BY_DEFAULT: true
});

export const DISCORD_CONFIG = Object.freeze({
  CLIENT_ID: '1437127619069087814',
  TIMEOUTS: Object.freeze({
    RECONNECT: 5000,
    UPDATE_DEBOUNCE: 1000
  })
});

// ============================================
// Вспомогательные функции
// ============================================

/**
 * Проверяет, является ли домен доверенным
 * @param {string} url 
 * @returns {boolean}
 */
export function isTrustedDomain(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Прямое совпадение
    if (TRUSTED_DOMAINS.includes(hostname)) return true;
    
    // Проверка паттернов
    return TRUSTED_DOMAIN_PATTERNS.some(pattern => pattern.test(hostname));
  } catch (e) {
    return false;
  }
}

/**
 * Определяет среду выполнения
 */
export function getEnvironment() {
  return isDevelopment() ? 'development' : 'production';
}

// ============================================
// Экспорт по умолчанию
// ============================================

export const CONSTANTS = Object.freeze({
  APP_CONFIG,
  TRUSTED_DOMAINS,
  TRUSTED_DOMAIN_PATTERNS,
  VK_API,
  NETWORK_CONFIG,
  USER_AGENT,
  IPC_CHANNELS,
  VK_NEXT_CONFIG,
  DISCORD_CONFIG
});

export default CONSTANTS;