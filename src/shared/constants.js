// ============================================
// VK Desktop — Константы и конфигурация
// ============================================
// Здесь собраны все константы, которые используются по всему приложению:
// - Доверенные домены VK (для безопасности и CSP)
// - Настройки API VK
// - Каналы IPC (общение между процессами)
// - Конфиг Discord RPC
// - И прочие полезные штуки
//
// Если нужно что-то поменять глобально — скорее всего, это здесь.
// ============================================

// ============================================
// Определение окружения
// ============================================

/**
 * Проверяем, запущено ли приложение в режиме разработки.
 * Работает и в main process, и в preload (там electron.app недоступен).
 */
export const isDevelopment = () => {
  try {
    // Сначала смотрим переменные окружения
    if (process.env.NODE_ENV === 'development') return true;
    if (process.env.DEBUG === 'true') return true;
    
    // В main process можем проверить через electron.app
    try {
      const electron = require('electron');
      if (electron && electron.app) {
        return !electron.app.isPackaged;
      }
    } catch {
      // В preload electron.app недоступен — это ок
    }
    
    return false;
  } catch {
    return false;
  }
};

// ============================================
// Информация о приложении
// ============================================

export const APP_CONFIG = Object.freeze({
  NAME: 'VK Desktop',
  ID: 'com.yamixdev.vkdesktop',
  VERSION: '1.1.3',
  AUTHOR: 'yamixdev',
  HOMEPAGE: 'https://github.com/yamixdev/vk-desktop',
  REPOSITORY: 'https://github.com/yamixdev/vk-desktop',
  
  DESCRIPTION: 'Unofficial VK Desktop Client with Discord RPC integration',
  LICENSE: 'MIT',
  MIN_ELECTRON_VERSION: '28.0.0'
});

// ============================================
// Доверенные домены VK
// ============================================
// Белый список доменов, которым мы доверяем.
// Используется для:
// - Content Security Policy (CSP)
// - Проверки навигации (чтобы не уходить на левые сайты)
// - Разрешения загрузки ресурсов

export const TRUSTED_DOMAINS = Object.freeze([
  // Основные домены
  'vk.com',
  'vk.ru',
  'vk.me',
  'vkontakte.ru',
  
  // Мобилки
  'm.vk.com',
  'm.vk.ru',
  
  // Авторизация
  'id.vk.com',
  'id.vk.ru',
  'login.vk.com',
  'login.vk.ru',
  'oauth.vk.com',
  'oauth.vk.ru',
  'account.vk.com',
  'account.vk.ru',
  
  // API
  'api.vk.com',
  'api.vk.ru',
  'connect.vk.com',
  'connect.vk.ru',
  'platform.vk.com',
  'platform.vk.ru',
  'vkuseraudio.net',
  'vkuservideo.net',
  
  // Статика (JS, CSS, шрифты)
  'static.vk.com',
  'static.vk.ru',
  'st.vk.com',
  'st.vk.ru',
  'vk.cc',
  
  // CDN для медиа (фото, музыка, видео)
  'userapi.com',
  'pp.userapi.com',
  'psv.userapi.com',
  'vkuseraudio.com',
  'vkuservideo.com',
  'vkuserphoto.com',
  
  // Фото и аватарки
  'pp.vk.me',
  'pu.vk.com',
  'pu.vk.me',
  
  // Музыка
  'cs.vk.me',
  'psv.vk.me',
  'audio.vk.com',
  'music.vk.com',
  
  // Видео и стримы
  'vkvideo.ru',
  'vksport.vkvideo.ru',
  'vk-cdn-video.ru',
  'video.vk.com',
  'video.vk.ru',
  'vkvd.ru',
  'live.vk.com',
  'stream.vk.com',
  
  // Мини-приложения
  'vk-apps.com',
  'pages.vk-apps.com',
  'pages.vk.com',
  'pages.vk.ru',
  'dev.vk.com',
  'miniapp.vk.com',
  'apps.vk.com',
  
  // Платежи
  'pay.vk.com',
  'pay.vk.ru',
  'vkpay.io',
  
  // Мессенджер
  'web.vk.me',
  'im.vk.com',
  
  // Всякие сервисы
  'push.vk.com',
  'push.vk.ru',
  'r.vk.com',
  'ad.vk.com',
  'stats.vk.com',
  'pixel.vk.com',
  'top.vk.com',
  
  // Капча
  'captcha.vk.com',
  'captcha.vk.ru',
  
  // Загрузка файлов
  'upload.vk.com',
  'upload.vk.ru',
  
  // Маркет
  'market.vk.com',
  'aliexpress.vk.com',
  
  // Связанные сервисы (Mail.ru Group)
  'zen.vk.com',
  'dzen.ru',
  'mail.ru',
  'my.mail.ru',
  'e.mail.ru'
]);

// ============================================
// Паттерны для динамических CDN-доменов
// ============================================
// У VK куча CDN-серверов с номерами: sun1-23.userapi.com, cs9999.vk.me и т.д.
// Их невозможно перечислить все, поэтому используем регулярки.

export const TRUSTED_DOMAIN_PATTERNS = Object.freeze([
  // Фото CDN: sun1-1.userapi.com, sun9-99.vk.me
  /^sun\d+(-\d+)?\.vk\.me$/i,
  /^sun\d+(-\d+)?\.userapi\.com$/i,
  /^sun\d+(-\d+)?\.vk\.com$/i,
  /^sun\d+(-\d+)?\.vkuserphoto\.ru$/i,
  
  // Файловые серверы: cs123.vk.me
  /^cs\d+\.vk\.me$/i,
  /^cs\d+\.userapi\.com$/i,
  /^cs\d+\.vkuserphoto\.com$/i,
  /^cs\d+\.vkuseraudio\.com$/i,
  /^cs\d+\.vkuseraudio\.net$/i,
  /^cs\d+\.vkuservideo\.com$/i,
  /^cs\d+\.vkuservideo\.net$/i,
  
  // Аудио CDN: psv4.vk.me, aud-12.vk.me
  /^psv\d+\.vk\.me$/i,
  /^psv\d+\.userapi\.com$/i,
  /^aud\d+(-\d+)?\.vk\.me$/i,
  /^aud\d+(-\d+)?\.userapi\.com$/i,
  
  // Long Poll серверы (для real-time сообщений)
  /^im\d+\.vk\.(com|ru)$/i,
  /^lp\d+\.vk\.(com|ru)$/i,
  
  // Видео CDN
  /^vod\d+\.vk\.me$/i,
  /^vod\d+\.userapi\.com$/i,
  /^vod\d+(-\d+)?\.vkvideo\.ru$/i,
  
  // VK Apps
  /^.+\.pages\.vk-apps\.com$/i,
  /^.+\.vk-apps\.com$/i,
  
  // Серверы загрузки
  /^pu\d+\.vk\.me$/i,
  /^upload\d+\.vk\.com$/i,
  
  // Аватарки с номерами
  /^pp\d+\.vk\.me$/i,
  /^pp\d+\.userapi\.com$/i,
  
  // Любые субдомены медиа-сервисов
  /^.+\.vkuseraudio\.(com|net)$/i,
  /^.+\.vkuservideo\.(com|net)$/i,
  /^.+\.vkuserphoto\.(com|ru)$/i,
  /^.+\.userapi\.com$/i
]);

// ============================================
// Настройки VK API
// ============================================
// Эндпоинты, версия API, таймауты.
// CLIENT_ID и CLIENT_SECRET — публичные ключи от Android-клиента VK
// (да, они публичные, так задумано).

export const VK_API = Object.freeze({
  BASE_URL: 'https://api.vk.com/method/',
  VERSION: '5.236',
  CLIENT_ID: '2274003',                    // Офиц. ID VK Android
  CLIENT_SECRET: 'hHbZxrka2uZ6jB1inYsH',   // Публичный secret
  SCOPE: 'audio,offline,messages,notifications,photos,docs',
  
  ENDPOINTS: Object.freeze({
    METHOD: 'https://api.vk.com/method/',
    METHOD_RU: 'https://api.vk.ru/method/',
    
    OAUTH: 'https://oauth.vk.com/',
    OAUTH_RU: 'https://oauth.vk.ru/',
    AUTHORIZE: 'https://oauth.vk.com/authorize',
    TOKEN: 'https://oauth.vk.com/access_token',
    
    UPLOAD: 'https://pu.vk.com/',
    UPLOAD_DOC: 'https://vk.com/doc_uploader.php',
    UPLOAD_PHOTO: 'https://pu.vk.com/c',
    
    LONGPOLL_TEMPLATE: 'https://{server}',
    WEBSOCKET: 'wss://pubsub.vk.com/subscribe',
    STREAMING: 'https://streaming.vk.com/',
    CALLBACK: 'https://api.vk.com/callback/'
  }),
  
  TIMEOUT: 30000,       // 30 сек
  MAX_RETRIES: 3,
  RATE_LIMIT: 3,        // Запросов в секунду
  RATE_LIMIT_BURST: 10,
  
  LANGUAGE: 'ru',
  HTTPS: true
});

// ============================================
// Long Poll (real-time сообщения)
// ============================================
// Long Poll — это способ получать новые сообщения мгновенно,
// без постоянных запросов к серверу.

export const LONG_POLL_CONFIG = Object.freeze({
  // Битовая маска: какие события получать
  // 2 = вложения, 8 = расширенные события, и т.д.
  MODE: 2 | 8 | 32 | 64 | 128,
  
  VERSION: 10,
  
  WAIT: 25,                    // Сколько секунд ждать событий
  RECONNECT_DELAY: 1000,       // Пауза перед переподключением
  MAX_RECONNECT_ATTEMPTS: 5,
  
  // Что делать при ошибках Long Poll
  ERROR_HANDLERS: Object.freeze({
    1: 'UPDATE_TS',    // Устарел timestamp — обновить
    2: 'NEW_KEY',      // Истёк ключ — получить новый
    3: 'NEW_KEY',      // Потеряны события
    4: 'CHECK_VERSION' // Проблема с версией
  })
});

// ============================================
// Сетевые настройки
// ============================================

export const NETWORK_CONFIG = Object.freeze({
  TIMEOUTS: Object.freeze({
    DEFAULT: 30000,   // 30 сек — стандарт
    UPLOAD: 120000,   // 2 мин — загрузка файлов
    DOWNLOAD: 60000,  // 1 мин — скачивание
    API_CALL: 15000   // 15 сек — API-запросы
  }),
  
  // Повторные попытки при ошибках
  RETRY: Object.freeze({
    MAX_ATTEMPTS: 3,
    BACKOFF: [1000, 3000, 5000],  // Паузы между попытками
    RETRY_ON_CODES: [408, 429, 500, 502, 503, 504]
  }),
  
  CACHE: Object.freeze({
    MAX_AGE: 3600000,   // 1 час
    MAX_SIZE: 100,
    STORAGE: 'memory'
  }),
  
  // Притворяемся обычным Chrome
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
});

// Для обратной совместимости
export const USER_AGENT = NETWORK_CONFIG.USER_AGENT;

// ============================================
// IPC-каналы
// ============================================
// IPC (Inter-Process Communication) — общение между main и renderer процессами.
// Каждый канал — это как "тема" сообщения.

export const IPC_CHANNELS = Object.freeze({
  // Настройки приложения
  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  CONFIG_RESET: 'config:reset',
  
  // Управление окном
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_RESTORE: 'window:restore',
  WINDOW_FULLSCREEN: 'window:fullscreen',
  WINDOW_ALWAYS_ON_TOP: 'window:always-on-top',
  
  // Discord Rich Presence
  RPC_ENABLE: 'rpc:enable',
  RPC_DISABLE: 'rpc:disable',
  RPC_UPDATE: 'rpc:update',
  RPC_STATUS: 'rpc:status',
  
  // Системные уведомления
  NOTIFICATION_SEND: 'notification:send',
  NOTIFICATION_CLICK: 'notification:click',
  NOTIFICATION_CLOSE: 'notification:close',
  
  // Бейдж (число на иконке)
  BADGE_UPDATE: 'badge:update',
  BADGE_CLEAR: 'badge:clear',
  
  // Медиа-кнопки
  MEDIA_CONTROL: 'media:control',
  MEDIA_PLAY: 'media:play',
  MEDIA_PAUSE: 'media:pause',
  MEDIA_NEXT: 'media:next',
  MEDIA_PREV: 'media:prev',
  MEDIA_SEEK: 'media:seek',
  
  // Кэш
  CACHE_CLEAR: 'cache:clear',
  CACHE_SIZE: 'cache:size',
  
  // Авто-обновления
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  
  // Авторизация (на будущее)
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATUS: 'auth:status',
  
  // Расширения
  EXTENSION_LOAD: 'extension:load',
  EXTENSION_UNLOAD: 'extension:unload',
  EXTENSION_LIST: 'extension:list'
});

// ============================================
// Настройки VK Next
// ============================================
// VK Next — это браузерное расширение для улучшения VK.
// Мы его встраиваем прямо в приложение.

export const VK_NEXT_CONFIG = Object.freeze({
  EXTENSION_PATH: 'extensions/vk-next',
  MANIFEST_FILE: 'manifest.json',
  
  ENABLED_BY_DEFAULT: true,
  LAZY_LOAD: false,          // Грузить сразу
  PRELOAD_SCRIPT: 'preload.js',
  
  // Если понадобится отдельное окно для расширения
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
  
  INTEGRATION: Object.freeze({
    INJECT_CSS: true,
    INJECT_JS: true,
    ISOLATED_CONTEXT: true,
    ALLOW_CSP: ['script-src', 'style-src']
  })
});

// ============================================
// Discord Rich Presence
// ============================================
// Показываем в Discord, что сейчас играет в VK Music.

export const DISCORD_CONFIG = Object.freeze({
  // ID приложения в Discord Developer Portal
  CLIENT_ID: '1437127619069087814',
  
  // Текст на кнопках и картинках
  LABELS: Object.freeze({
    BUTTON_LISTEN: 'Слушать в VK',
    BUTTON_PROFILE: 'Профиль VK',
    LARGE_IMAGE_TEXT: 't.me/ilushadevz',
    SMALL_IMAGE_PLAYING: 'VK Music',
    SMALL_IMAGE_PAUSED: 'Paused'
  }),
  
  IMAGES: Object.freeze({
    LOGO: 'logo',
    PAUSE: 'pause'
  }),
  
  TIMEOUTS: Object.freeze({
    RECONNECT_DELAYS: [5000, 10000, 30000, 60000],  // Если Discord отвалился
    UPDATE_DEBOUNCE: 100,       // Не спамим обновлениями
    MIN_UPDATE_INTERVAL: 1000,  // Минимум между обновлениями
    SEEK_THRESHOLD: 2000        // Когда считаем перемотку
  }),
  
  LIMITS: Object.freeze({
    MAX_CONSECUTIVE_ERRORS: 5,
    MAX_TITLE_LENGTH: 128,
    MAX_ARTIST_LENGTH: 128,
    MAX_TRACK_DURATION: 3600    // 1 час максимум
  })
});

// ============================================
// Feature Flags
// ============================================
// Тут можно быстро включить/выключить фичи.

export const FEATURE_FLAGS = Object.freeze({
  DISCORD_RPC: true,
  AUTO_UPDATE: true,
  NOTIFICATIONS: true,
  MEDIA_KEYS: true,
  VK_NEXT: true,
  
  // Экспериментальное
  EXPERIMENTAL: Object.freeze({
    HARDWARE_ACCELERATION: true,
    GPU_RASTERIZATION: true,
    WEBGL: true,
    PICTURE_IN_PICTURE: false  // Пока не готово
  })
});

// ============================================
// Вспомогательные функции
// ============================================

/**
 * Проверяет, принадлежит ли URL доверенному домену VK.
 */
export function isTrustedDomain(url) {
  if (!url || typeof url !== 'string') return false;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Сначала в списке
    if (TRUSTED_DOMAINS.includes(hostname)) return true;
    
    // Потом по паттернам
    return TRUSTED_DOMAIN_PATTERNS.some(pattern => pattern.test(hostname));
  } catch (e) {
    return false;
  }
}

/**
 * Проверяет, существует ли такой IPC-канал.
 */
export function isValidIPCChannel(channel) {
  if (!channel || typeof channel !== 'string') return false;
  return Object.values(IPC_CHANNELS).includes(channel);
}

/**
 * Собирает полный URL для вызова метода VK API.
 */
export function getAPIMethodURL(method) {
  return `${VK_API.BASE_URL}${method}`;
}

/**
 * Возвращает текущее окружение.
 */
export function getEnvironment() {
  return isDevelopment() ? 'development' : 'production';
}

// ============================================
// Настройки для dev/prod
// ============================================

export const ENV_CONFIG = Object.freeze({
  development: Object.freeze({
    DEBUG_MODE: true,
    VERBOSE_LOGGING: true,
    DISABLE_CSP: true,        // В dev CSP мешает
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
 * Возвращает конфиг текущего окружения.
 */
export function getCurrentEnvConfig() {
  const env = getEnvironment();
  return ENV_CONFIG[env];
}

// ============================================
// Экспорт всего одним объектом
// ============================================
// На случай, если удобнее импортировать одну переменную.

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