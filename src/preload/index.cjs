const { ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  MEDIA_STATE: 'media:state',
  MEDIA_PROGRESS: 'media:progress',
  MEDIA_CONTROL: 'media:control',
  BADGE_UPDATE: 'app:badge',
  PERFORMANCE_PROFILE: 'app:profile'
});
const ALLOWED_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);
const ALLOWED_PROFILES = new Set(['balanced', 'performance', 'powersave']);
const MEDIA_COMMAND_SELECTORS = Object.freeze({
  play_pause: 'button[data-testid="audio-player-controls-state-button"]',
  next: 'button[data-testid="audio-player-controls-forward-button"]',
  prev: 'button[data-testid="audio-player-controls-backward-button"]'
});
const BADGE_DEBOUNCE_MS = 300;

function isTrustedPage() {
  return window.location.protocol === 'https:' && ALLOWED_HOSTS.has(window.location.hostname.toLowerCase());
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

if (isTrustedPage()) initializeTrustedPageBridge();
