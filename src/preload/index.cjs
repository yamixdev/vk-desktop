const { ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  MEDIA_STATE: 'media:state',
  MEDIA_PROGRESS: 'media:progress',
  MEDIA_CONTROL: 'media:control',
  BADGE_UPDATE: 'app:badge',
  PERFORMANCE_PROFILE: 'app:profile',
  TITLE_BAR_MENU: 'window:titlebar-menu',
  TITLE_BAR_THEME: 'window:titlebar-theme'
});
const ALLOWED_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);
const ALLOWED_PROFILES = new Set(['balanced', 'performance', 'powersave']);
const MEDIA_COMMAND_SELECTORS = Object.freeze({
  play_pause: 'button[data-testid="audio-player-controls-state-button"]',
  next: 'button[data-testid="audio-player-controls-forward-button"]',
  prev: 'button[data-testid="audio-player-controls-backward-button"]'
});
const BADGE_DEBOUNCE_MS = 300;
const TITLE_BAR_HEIGHT = 48;
const TITLE_BAR_ID = 'vk-desktop-titlebar';

function isTrustedPage() {
  return window.location.protocol === 'https:' && ALLOWED_HOSTS.has(window.location.hostname.toLowerCase());
}

function isAppPage() {
  return window.location.protocol === 'vk-desktop:' && window.location.hostname === 'local';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBoundedString(value, maxLength, allowEmpty = true) {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function isFinitePosition(value) {
  return Number.isFinite(value) && value >= 0 && value <= 7200;
}

function isValidMediaState(payload) {
  if (!isPlainObject(payload) || typeof payload.active !== 'boolean') return false;
  if (!payload.active) return payload.reason === 'unavailable';

  return (
    ['initial', 'track', 'playback', 'seek'].includes(payload.reason) &&
    isBoundedString(payload.title, 128, false) &&
    isBoundedString(payload.artist, 128) &&
    isBoundedString(payload.album, 100) &&
    isBoundedString(payload.cover, 4096) &&
    isBoundedString(payload.url, 4096, false) &&
    isFinitePosition(payload.duration) &&
    isFinitePosition(payload.progress) &&
    typeof payload.isPlaying === 'boolean'
  );
}

function isValidMediaProgress(payload) {
  return Boolean(
    isPlainObject(payload) &&
    isFinitePosition(payload.progress) &&
    isFinitePosition(payload.duration) &&
    typeof payload.isPlaying === 'boolean'
  );
}

function getColorLuminance(color) {
  const value = color.trim().toLowerCase();
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/u)?.[1];
  let channels;
  let alpha = 1;

  if (hex) {
    const expanded = hex.length <= 4
      ? [...hex].map((character) => `${character}${character}`).join('')
      : hex;
    channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
    if (expanded.length === 8) alpha = Number.parseInt(expanded.slice(6, 8), 16) / 255;
  } else {
    const match = value.match(/^rgba?\(([^)]+)\)$/u);
    if (!match) return null;
    const components = match[1].split(/[\s,/]+/u).filter(Boolean).map(Number);
    if (components.length < 3 || components.slice(0, 3).some((component) => !Number.isFinite(component))) {
      return null;
    }
    channels = components.slice(0, 3);
    if (components.length > 3) alpha = components[3];
  }

  if (!Number.isFinite(alpha) || alpha <= 0.05) return null;
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function initializeTitleBarBridge() {
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const offsetTimers = new Set();
  const themeTimers = new Set();
  let titleBar = null;
  let themeObserver = null;
  let lastTheme = null;

  function detectTheme() {
    const rootStyles = getComputedStyle(document.documentElement);
    const bodyStyles = document.body ? getComputedStyle(document.body) : null;
    const pageSurface = document.querySelector('#page_wrap, #page_layout, #root, #app');
    const candidates = [
      rootStyles.getPropertyValue('--vkui--color_background_content'),
      rootStyles.getPropertyValue('--vkui--color_background'),
      bodyStyles?.getPropertyValue('--vkui--color_background_content') ?? '',
      bodyStyles?.getPropertyValue('--vkui--color_background') ?? '',
      bodyStyles?.backgroundColor ?? '',
      pageSurface ? getComputedStyle(pageSurface).backgroundColor : ''
    ];

    for (const candidate of candidates) {
      const luminance = getColorLuminance(candidate);
      if (luminance !== null) return luminance < 128 ? 'dark' : 'light';
    }
    return darkMediaQuery.matches ? 'dark' : 'light';
  }

  function updateTheme() {
    if (!titleBar) return;
    const theme = detectTheme();
    titleBar.dataset.theme = theme;
    if (theme === lastTheme) return;
    lastTheme = theme;
    ipcRenderer.send(CHANNELS.TITLE_BAR_THEME, theme);
  }

  function offsetPageHeader() {
    const candidates = document.querySelectorAll([
      '#page_header_cont',
      '[class*="TopNavigation__root"]',
      '[class*="TopNav__root"]',
      'header[role="banner"]'
    ].join(','));

    for (const candidate of candidates) {
      if (candidate.closest(`#${TITLE_BAR_ID}`)) continue;
      const styles = getComputedStyle(candidate);
      const bounds = candidate.getBoundingClientRect();
      if (
        (styles.position === 'fixed' || styles.position === 'sticky')
        && bounds.top < 8
        && bounds.height > 0
        && bounds.height <= TITLE_BAR_HEIGHT * 2
      ) {
        candidate.classList.add('vk-desktop-titlebar-offset');
      }
    }
  }

  function scheduleOffsetCheck(delayMs) {
    const timer = setTimeout(() => {
      offsetTimers.delete(timer);
      offsetPageHeader();
    }, delayMs);
    offsetTimers.add(timer);
  }

  function scheduleThemeSync(delayMs) {
    const timer = setTimeout(() => {
      themeTimers.delete(timer);
      if (lastTheme) ipcRenderer.send(CHANNELS.TITLE_BAR_THEME, lastTheme);
    }, delayMs);
    themeTimers.add(timer);
  }

  function mountTitleBar() {
    if (!document.body || document.getElementById(TITLE_BAR_ID)) return;

    titleBar = document.createElement('div');
    titleBar.id = TITLE_BAR_ID;
    titleBar.setAttribute('role', 'banner');

    const safeArea = document.createElement('div');
    safeArea.className = 'vk-desktop-titlebar__safe-area';

    const menuButton = document.createElement('button');
    menuButton.className = 'vk-desktop-titlebar__menu';
    menuButton.type = 'button';
    menuButton.setAttribute('aria-label', 'Открыть меню VK Desktop');
    menuButton.title = 'Меню VK Desktop';
    const menuLines = document.createElement('span');
    menuLines.className = 'vk-desktop-titlebar__menu-lines';
    menuLines.setAttribute('aria-hidden', 'true');
    menuButton.append(menuLines);

    const brand = document.createElement('div');
    brand.className = 'vk-desktop-titlebar__brand';
    const logo = document.createElement('span');
    logo.className = 'vk-desktop-titlebar__logo';
    logo.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.textContent = 'ВКонтакте';
    brand.append(logo, title);
    safeArea.append(brand);
    titleBar.append(safeArea, menuButton);

    menuButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.TITLE_BAR_MENU));
    document.documentElement.classList.add('vk-desktop-titlebar-active');
    document.body.prepend(titleBar);

    themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme']
    });
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme']
    });
    darkMediaQuery.addEventListener('change', updateTheme);
    updateTheme();
    for (const delay of [0, 250, 1000, 3000]) scheduleOffsetCheck(delay);
    scheduleThemeSync(750);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTitleBar, { once: true });
  } else {
    mountTitleBar();
  }

  window.addEventListener('beforeunload', () => {
    themeObserver?.disconnect();
    darkMediaQuery.removeEventListener('change', updateTheme);
    for (const timer of offsetTimers) clearTimeout(timer);
    offsetTimers.clear();
    for (const timer of themeTimers) clearTimeout(timer);
    themeTimers.clear();
  }, { once: true });
}

function initializeTrustedPageBridge() {
  const lastSentAt = new Map();
  let badgeDebounceTimer = null;
  let lastBadgeCount = -1;
  let titleObserver = null;
  let headObserver = null;

  function isRateAllowed(channel, intervalMs) {
    const now = Date.now();
    const previous = lastSentAt.get(channel) ?? 0;
    if (now - previous < intervalMs) return false;
    lastSentAt.set(channel, now);
    return true;
  }

  function onWindowMessage(event) {
    if (event.source !== window || event.origin !== window.location.origin || !isPlainObject(event.data)) return;

    if (
      event.data.type === 'VK_DESKTOP_MEDIA_STATE' &&
      isValidMediaState(event.data.payload) &&
      isRateAllowed(CHANNELS.MEDIA_STATE, 150)
    ) {
      ipcRenderer.send(CHANNELS.MEDIA_STATE, event.data.payload);
      return;
    }

    if (
      event.data.type === 'VK_DESKTOP_MEDIA_PROGRESS' &&
      isValidMediaProgress(event.data.payload) &&
      isRateAllowed(CHANNELS.MEDIA_PROGRESS, 1000)
    ) {
      ipcRenderer.send(CHANNELS.MEDIA_PROGRESS, event.data.payload);
    }
  }

  function onProfile(_event, profile) {
    if (!ALLOWED_PROFILES.has(profile)) return;
    window.postMessage({ type: 'VK_DESKTOP_PROFILE', profile }, window.location.origin);
  }

  function onMediaControl(_event, command) {
    const selector = MEDIA_COMMAND_SELECTORS[command];
    if (!selector) return;
    document.querySelector(selector)?.click();
  }

  function observeTitle(titleElement) {
    const updateBadge = () => {
      const match = document.title.match(/^\((\d{1,4})\)/u);
      const count = Math.min(match ? Number.parseInt(match[1], 10) : 0, 9999);
      if (count !== lastBadgeCount) {
        lastBadgeCount = count;
        ipcRenderer.send(CHANNELS.BADGE_UPDATE, count);
      }
    };

    titleObserver = new MutationObserver(() => {
      if (badgeDebounceTimer) clearTimeout(badgeDebounceTimer);
      badgeDebounceTimer = setTimeout(updateBadge, BADGE_DEBOUNCE_MS);
    });
    titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
    updateBadge();
  }

  function initializeTitleObserver() {
    const titleElement = document.querySelector('title');
    if (titleElement) {
      observeTitle(titleElement);
      return;
    }

    headObserver = new MutationObserver(() => {
      const nextTitleElement = document.querySelector('title');
      if (!nextTitleElement) return;
      headObserver.disconnect();
      headObserver = null;
      observeTitle(nextTitleElement);
    });
    if (document.head) headObserver.observe(document.head, { childList: true });
  }

  window.addEventListener('message', onWindowMessage, { passive: true });
  ipcRenderer.on(CHANNELS.PERFORMANCE_PROFILE, onProfile);
  ipcRenderer.on(CHANNELS.MEDIA_CONTROL, onMediaControl);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTitleObserver, { once: true });
  } else {
    initializeTitleObserver();
  }

  window.addEventListener('beforeunload', () => {
    if (badgeDebounceTimer) clearTimeout(badgeDebounceTimer);
    titleObserver?.disconnect();
    headObserver?.disconnect();
    window.removeEventListener('message', onWindowMessage);
    ipcRenderer.removeListener(CHANNELS.PERFORMANCE_PROFILE, onProfile);
    ipcRenderer.removeListener(CHANNELS.MEDIA_CONTROL, onMediaControl);
  }, { once: true });
}

if (isTrustedPage() || isAppPage()) initializeTitleBarBridge();
if (isTrustedPage()) initializeTrustedPageBridge();
