/**
 * Конфигурация VK Desktop Client
 * Централизованное хранение всех констант приложения
 *
 * @version 1.1.3
 * @author YamixDev
 */

// ============================================
// === ENVIRONMENT DETECTION ===
// ============================================

/**
 * Определение окружения (dev/prod)
 * ИЗМЕНЕНО: безопасная проверка без require('electron') в preload
 * @returns {boolean} true если development
 */
export const isDevelopment = () => {
  try {
    // Проверяем переменные окружения (работает везде)
    if (process.env.NODE_ENV === 'development') return true;
    if (process.env.DEBUG === 'true') return true;
    
    // Пробуем проверить через electron (только в main process)
    // ИЗМЕНЕНО: динамический require с try-catch для безопасности в preload
    try {
      const electron = require('electron');
      if (electron && electron.app) {
        return !electron.app.isPackaged;
      }
    } catch {
      // В preload electron.app недоступен - это нормально
    }
    
    return false;
  } catch {
    return false;
  }
};

// ============================================
// === APP CONFIG ===
// ============================================

export const APP_CONFIG = Object.freeze({
  NAME: 'VK Desktop',
  ID: 'com.yamixdev.vkdesktop',
  VERSION: '1.1.3',
  AUTHOR: 'yamixdev',
  HOMEPAGE: 'https://github.com/yamixdev/vk-desktop',
  REPOSITORY: 'https://github.com/yamixdev/vk-desktop',
  
  // Дополнительные метаданные
  DESCRIPTION: 'Unofficial VK Desktop Client with Discord RPC integration',
  LICENSE: 'MIT',
  MIN_ELECTRON_VERSION: '28.0.0'
});

// ============================================
// === TRUSTED DOMAINS ===
// ============================================

/**
 * ИЗМЕНЕНО: Расширенный список доверенных доменов VK
 * Используется для безопасной навигации и CSP
 */
export const TRUSTED_DOMAINS = Object.freeze([
  // ============================================
  // === ОСНОВНЫЕ ДОМЕНЫ VK ===
  // ============================================
  'vk.com',
  'vk.ru',
  'vk.me',
  'vkontakte.ru',
  
  // === Мобильные версии ===
  'm.vk.com',
  'm.vk.ru',
  
  // ============================================
  // === АУТЕНТИФИКАЦИЯ И АВТОРИЗАЦИЯ ===
  // ============================================
  'id.vk.com',
  'id.vk.ru',
  'login.vk.com',
  'login.vk.ru',
  'oauth.vk.com',
  'oauth.vk.ru',
  'account.vk.com',
  'account.vk.ru',
  
  // ============================================
  // === API И ПЛАТФОРМА ===
  // ============================================
  'api.vk.com',
  'api.vk.ru',
  'connect.vk.com',
  'connect.vk.ru',
  'platform.vk.com',
  'platform.vk.ru',
  'vkuseraudio.net',
  'vkuservideo.net',
  
  // ============================================
  // === СТАТИЧЕСКИЕ РЕСУРСЫ ===
  // ============================================
  'static.vk.com',
  'static.vk.ru',
  'st.vk.com',
  'st.vk.ru',
  'vk.cc',
  
  // ============================================
  // === USERAPI (CDN для медиа) ===
  // ============================================
  'userapi.com',
  'pp.userapi.com',
  'psv.userapi.com',
  'vkuseraudio.com',
  'vkuservideo.com',
  'vkuserphoto.com',
  
  // ============================================
  // === CDN ДЛЯ ФОТО И АВАТАРОВ ===
  // ============================================
  // sun1-99.vk.me (покрываются паттерном)
  'pp.vk.me',
  'pu.vk.com',
  'pu.vk.me',
  
  // ============================================
  // === CDN ДЛЯ МУЗЫКИ И АУДИО ===
  // ============================================
  'cs.vk.me',
  'psv.vk.me',
  'audio.vk.com',
  'music.vk.com',
  
  // ============================================
  // === ВИДЕО И СТРИМИНГ ===
  // ============================================
  'vkvideo.ru',
  'vksport.vkvideo.ru',
  'vk-cdn-video.ru',
  'video.vk.com',
  'video.vk.ru',
  'vkvd.ru',
  'live.vk.com',
  'stream.vk.com',
  
  // ============================================
  // === VK APPS И MINI APPS ===
  // ============================================
  'vk-apps.com',
  'pages.vk-apps.com',
  'pages.vk.com',
  'pages.vk.ru',
  'dev.vk.com',
  'miniapp.vk.com',
  'apps.vk.com',
  
  // ============================================
  // === ПЛАТЕЖИ И МАГАЗИН ===
  // ============================================
  'pay.vk.com',
  'pay.vk.ru',
  'vkpay.io',
  
  // ============================================
  // === МЕССЕНДЖЕР VK ===
  // ============================================
  'web.vk.me',
  'im.vk.com',
  
  // ============================================
  // === СЕРВИСЫ И ИНТЕГРАЦИИ ===
  // ============================================
  'push.vk.com',
  'push.vk.ru',
  'r.vk.com',
  'ad.vk.com',
  'stats.vk.com',
  'pixel.vk.com',
  'top.vk.com',
  
  // ============================================
  // === КАПЧА И ВЕРИФИКАЦИЯ ===
  // ============================================
  'captcha.vk.com',
  'captcha.vk.ru',
  
  // ============================================
  // === ЗАГРУЗКА ФАЙЛОВ ===
  // ============================================
  'upload.vk.com',
  'upload.vk.ru',
  
  // ============================================
  // === МАРКЕТПЛЕЙС VK ===
  // ============================================
  'market.vk.com',
  'aliexpress.vk.com',
  
  // ============================================
  // === ДРУГИЕ СЕРВИСЫ VK ===
  // ============================================
  'zen.vk.com',
  'dzen.ru',
  'mail.ru',
  'my.mail.ru',
  'e.mail.ru'
]);

/**
 * ИЗМЕНЕНО: Расширенные паттерны для динамических CDN-доменов
 * Покрывает все варианты sun*.*, cs*.*, im*.*, lp*.* доменов
 */
export const TRUSTED_DOMAIN_PATTERNS = Object.freeze([
  // CDN для фото (sun1-1.userapi.com, sun9-99.vk.me и т.д.)
  /^sun\d+(-\d+)?\.vk\.me$/i,
  /^sun\d+(-\d+)?\.userapi\.com$/i,
  /^sun\d+(-\d+)?\.vk\.com$/i,
  /^sun\d+(-\d+)?\.vkuserphoto\.ru$/i,
  
  // CDN для файлов (cs*.vk.me, cs*.userapi.com)
  /^cs\d+\.vk\.me$/i,
  /^cs\d+\.userapi\.com$/i,
  /^cs\d+\.vkuserphoto\.com$/i,
  /^cs\d+\.vkuseraudio\.com$/i,
  /^cs\d+\.vkuseraudio\.net$/i,
  /^cs\d+\.vkuservideo\.com$/i,
  /^cs\d+\.vkuservideo\.net$/i,
  
  // Аудио CDN (psv*.vk.me, aud*.vk.me)
  /^psv\d+\.vk\.me$/i,
  /^psv\d+\.userapi\.com$/i,
  /^aud\d+(-\d+)?\.vk\.me$/i,
  /^aud\d+(-\d+)?\.userapi\.com$/i,
  
  // Long Poll серверы (im*.vk.com, lp*.vk.com)
  /^im\d+\.vk\.(com|ru)$/i,
  /^lp\d+\.vk\.(com|ru)$/i,
  
  // Видео CDN
  /^vod\d+\.vk\.me$/i,
  /^vod\d+\.userapi\.com$/i,
  /^vod\d+(-\d+)?\.vkvideo\.ru$/i,
  
  // Pages для VK Apps
  /^.+\.pages\.vk-apps\.com$/i,
  /^.+\.vk-apps\.com$/i,
  
  // Upload серверы
  /^pu\d+\.vk\.me$/i,
  /^upload\d+\.vk\.com$/i,
  
  // PP (фото профилей) с цифрами
  /^pp\d+\.vk\.me$/i,
  /^pp\d+\.userapi\.com$/i,
  
  // Субдомены vkuseraudio/video/photo
  /^.+\.vkuseraudio\.(com|net)$/i,
  /^.+\.vkuservideo\.(com|net)$/i,
  /^.+\.vkuserphoto\.(com|ru)$/i,
  
  // Субдомены userapi
  /^.+\.userapi\.com$/i
]);

// ============================================
// === VK API CONFIG ===
// ============================================

/**
 * Конфигурация VK API
 * Содержит все endpoints, версии и параметры API
 */
export const VK_API = Object.freeze({
  // Основные параметры
  BASE_URL: 'https://api.vk.com/method/',
  VERSION: '5.236',
  CLIENT_ID: '2274003', // Официальный ID VK для Android
  CLIENT_SECRET: 'hHbZxrka2uZ6jB1inYsH', // Публичный secret для Android
  SCOPE: 'audio,offline,messages,notifications,photos,docs',
  
  // Полный список endpoints
  ENDPOINTS: Object.freeze({
    // API методы
    METHOD: 'https://api.vk.com/method/',
    METHOD_RU: 'https://api.vk.ru/method/',
    
    // OAuth авторизация
    OAUTH: 'https://oauth.vk.com/',
    OAUTH_RU: 'https://oauth.vk.ru/',
    AUTHORIZE: 'https://oauth.vk.com/authorize',
    TOKEN: 'https://oauth.vk.com/access_token',
    
    // Загрузка файлов
    UPLOAD: 'https://pu.vk.com/',
    UPLOAD_DOC: 'https://vk.com/doc_uploader.php',
    UPLOAD_PHOTO: 'https://pu.vk.com/c',
    
    // Long Poll (real-time)
    LONGPOLL_TEMPLATE: 'https://{server}',
    
    // WebSocket
    WEBSOCKET: 'wss://pubsub.vk.com/subscribe',
    
    // Streaming API
    STREAMING: 'https://streaming.vk.com/',
    
    // Callback API
    CALLBACK: 'https://api.vk.com/callback/'
  }),
  
  // Таймауты и лимиты
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RATE_LIMIT: 3,
  RATE_LIMIT_BURST: 10,
  
  // Языковые настройки
  LANGUAGE: 'ru',
  HTTPS: true
});

// ============================================
// === LONG POLL CONFIG ===
// ============================================

/**
 * ИЗМЕНЕНО: Конфигурация для Long Poll (real-time уведомления)
 */
export const LONG_POLL_CONFIG = Object.freeze({
  // Режим подключения
  MODE: 2 | 8 | 32 | 64 | 128, // Получать вложения, расширенные события, pts
  
  // Версия Long Poll
  VERSION: 10,
  
  // Таймауты
  WAIT: 25, // секунд ожидания событий
  RECONNECT_DELAY: 1000, // мс задержка перед переподключением
  MAX_RECONNECT_ATTEMPTS: 5,
  
  // Обработка ошибок
  ERROR_HANDLERS: Object.freeze({
    1: 'UPDATE_TS', // Неверный ts, обновить через messages.getLongPollHistory
    2: 'NEW_KEY', // Истек ключ, получить новый через messages.getLongPollServer
    3: 'NEW_KEY', // Потеряны события, получить новый ключ
    4: 'CHECK_VERSION' // Неверная версия
  })
});

// ============================================
// === NETWORK CONFIG ===
// ============================================

/**
 * ИЗМЕНЕНО: Сетевые настройки и таймауты
 */
export const NETWORK_CONFIG = Object.freeze({
  // HTTP таймауты
  TIMEOUTS: Object.freeze({
    DEFAULT: 30000, // 30 сек
    UPLOAD: 120000, // 2 минуты для загрузки файлов
    DOWNLOAD: 60000, // 1 минута для скачивания
    API_CALL: 15000 // 15 сек для API-запросов
  }),
  
  // Retry стратегия
  RETRY: Object.freeze({
    MAX_ATTEMPTS: 3,
    BACKOFF: [1000, 3000, 5000], // мс между попытками
    RETRY_ON_CODES: [408, 429, 500, 502, 503, 504] // HTTP коды для retry
  }),
  
  // Кэширование
  CACHE: Object.freeze({
    MAX_AGE: 3600000, // 1 час
    MAX_SIZE: 100, // Максимум записей в кэше
    STORAGE: 'memory' // 'memory' или 'disk'
  }),
  
  // User Agent
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
});

// ИЗМЕНЕНО: Экспорт USER_AGENT отдельно для обратной совместимости
export const USER_AGENT = NETWORK_CONFIG.USER_AGENT;

// ============================================
// === IPC CHANNELS ===
// ============================================

/**
 * ИЗМЕНЕНО: Расширенные каналы IPC с группировкой
 */
export const IPC_CHANNELS = Object.freeze({
  // === Конфигурация ===
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  CONFIG_RESET: 'config:reset',
  
  // === Управление окном ===
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_RESTORE: 'window:restore',
  WINDOW_FULLSCREEN: 'window:fullscreen',
  WINDOW_ALWAYS_ON_TOP: 'window:always-on-top',
  
  // === Discord RPC ===
  RPC_ENABLE: 'rpc:enable',
  RPC_DISABLE: 'rpc:disable',
  RPC_UPDATE: 'rpc:update',
  RPC_STATUS: 'rpc:status',
  
  // === Уведомления ===
  NOTIFICATION_SEND: 'notification:send',
  NOTIFICATION_CLICK: 'notification:click',
  NOTIFICATION_CLOSE: 'notification:close',
  
  // === Бейдж (непрочитанные) ===
  BADGE_UPDATE: 'badge:update',
  BADGE_CLEAR: 'badge:clear',
  
  // === Медиа управление ===
  MEDIA_CONTROL: 'media:control',
  MEDIA_PLAY: 'media:play',
  MEDIA_PAUSE: 'media:pause',
  MEDIA_NEXT: 'media:next',
  MEDIA_PREV: 'media:prev',
  MEDIA_SEEK: 'media:seek',
  
  // ИЗМЕНЕНО: Добавлены новые каналы
  // === Кэш и данные ===
  CACHE_CLEAR: 'cache:clear',
  CACHE_SIZE: 'cache:size',
  
  // === Обновления ===
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  
  // === Аутентификация ===
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  
  // === Плагины/расширения ===
  EXTENSION_LOAD: 'extension:load',
  EXTENSION_UNLOAD: 'extension:unload',
  EXTENSION_LIST: 'extension:list'
});

// ============================================
// === VK NEXT INTEGRATION ===
// ============================================

/**
 * ИЗМЕНЕНО: Расширенная конфигурация для VK Next
 */
export const VK_NEXT_CONFIG = Object.freeze({
  // Путь к расширению
  EXTENSION_PATH: 'extensions/vk-next',
  MANIFEST_FILE: 'manifest.json',
  
  // Настройки загрузки
  ENABLED_BY_DEFAULT: true,
  LAZY_LOAD: false, // Загружать сразу или по требованию
  PRELOAD_SCRIPT: 'preload.js',
  
  // Окно расширения (если нужно отдельное окно)
  POPUP_WINDOW: Object.freeze({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    skipTaskbar: false,
    frame: true
  }),
  
  // ИЗМЕНЕНО: Настройки интеграции
  INTEGRATION: Object.freeze({
    INJECT_CSS: true, // Внедрять стили расширения
    INJECT_JS: true, // Внедрять скрипты расширения
    ISOLATED_CONTEXT: true, // Изолированный контекст для безопасности
    ALLOW_CSP: ['script-src', 'style-src'] // Разрешенные CSP директивы
  })
});

// ============================================
// === DISCORD RPC CONFIG ===
// ============================================

/**
 * Конфигурация Discord Rich Presence
 */
export const DISCORD_CONFIG = Object.freeze({
  // ID приложения Discord
  CLIENT_ID: '1437127619069087814',
  
  // Лейблы и текст
  LABELS: Object.freeze({
    BUTTON_LISTEN: 'Слушать в VK',
    BUTTON_PROFILE: 'Профиль VK',
    LARGE_IMAGE_TEXT: 't.me/ilushadevz',
    SMALL_IMAGE_PLAYING: 'VK Music',
    SMALL_IMAGE_PAUSED: 'Paused'
  }),
  
  // Изображения
  IMAGES: Object.freeze({
    LOGO: 'logo',
    PAUSE: 'pause'
  }),
  
  // Таймауты и интервалы
  TIMEOUTS: Object.freeze({
    RECONNECT_DELAYS: [5000, 10000, 30000, 60000], // Прогрессивные задержки
    UPDATE_DEBOUNCE: 100, // ms - debounce для частых обновлений
    MIN_UPDATE_INTERVAL: 1000, // ms - минимальный интервал между обновлениями
    SEEK_THRESHOLD: 2000 // ms - порог для детекции seek
  }),
  
  // Лимиты
  LIMITS: Object.freeze({
    MAX_CONSECUTIVE_ERRORS: 5,
    MAX_TITLE_LENGTH: 128,
    MAX_ARTIST_LENGTH: 128,
    MAX_TRACK_DURATION: 3600 // 1 час
  })
});

// ============================================
// === FEATURE FLAGS ===
// ============================================

/**
 * ИЗМЕНЕНО: Feature flags для управления функциональностью
 */
export const FEATURE_FLAGS = Object.freeze({
  DISCORD_RPC: true,
  AUTO_UPDATE: true,
  NOTIFICATIONS: true,
  MEDIA_KEYS: true,
  VK_NEXT: true,
  
  // Экспериментальные возможности
  EXPERIMENTAL: Object.freeze({
    HARDWARE_ACCELERATION: true,
    GPU_RASTERIZATION: true,
    WEBGL: true,
    PICTURE_IN_PICTURE: false // В разработке
  })
});

// ============================================
// === VALIDATION HELPERS ===
// ============================================

/**
 * ИЗМЕНЕНО: Утилиты для валидации
 */

/**
 * Проверка, является ли домен доверенным
 * @param {string} url - URL для проверки
 * @returns {boolean}
 */
export function isTrustedDomain(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Проверка в статическом списке
    if (TRUSTED_DOMAINS.includes(hostname)) return true;
    
    // Проверка по паттернам
    return TRUSTED_DOMAIN_PATTERNS.some(pattern => pattern.test(hostname));
  } catch (e) {
    return false;
  }
}

/**
 * Проверка валидности IPC-канала
 * @param {string} channel - Имя канала
 * @returns {boolean}
 */
export function isValidIPCChannel(channel) {
  if (!channel || typeof channel !== 'string') return false;
  return Object.values(IPC_CHANNELS).includes(channel);
}

/**
 * Получение URL для API-метода
 * @param {string} method - Название метода (например, 'users.get')
 * @returns {string}
 */
export function getAPIMethodURL(method) {
  return `${VK_API.BASE_URL}${method}`;
}

/**
 * ИЗМЕНЕНО: Определение окружения для конфигурации
 * @returns {'development' | 'production'}
 */
export function getEnvironment() {
  return isDevelopment() ? 'development' : 'production';
}

// ============================================
// === DEV/PROD SPECIFIC CONFIGS ===
// ============================================

/**
 * ИЗМЕНЕНО: Конфигурация в зависимости от окружения
 */
export const ENV_CONFIG = Object.freeze({
  development: Object.freeze({
    DEBUG_MODE: true,
    VERBOSE_LOGGING: true,
    DISABLE_CSP: true,
    OPEN_DEVTOOLS: true,
    HOT_RELOAD: true
  }),
  
  production: Object.freeze({
    DEBUG_MODE: false,
    VERBOSE_LOGGING: false,
    DISABLE_CSP: false,
    OPEN_DEVTOOLS: false,
    HOT_RELOAD: false
  })
});

/**
 * Получить текущую конфигурацию окружения
 * @returns {Object}
 */
export function getCurrentEnvConfig() {
  const env = getEnvironment();
  return ENV_CONFIG[env];
}

// ============================================
// === EXPORTS SUMMARY ===
// ============================================

/**
 * ИЗМЕНЕНО: Экспорт всех констант одним объектом (для удобства)
 */
export const CONSTANTS = Object.freeze({
  APP_CONFIG,
  TRUSTED_DOMAINS,
  TRUSTED_DOMAIN_PATTERNS,
  VK_API,
  LONG_POLL_CONFIG,
  NETWORK_CONFIG,
  USER_AGENT,
  IPC_CHANNELS,
  VK_NEXT_CONFIG,
  DISCORD_CONFIG,
  FEATURE_FLAGS,
  ENV_CONFIG
});

export default CONSTANTS;