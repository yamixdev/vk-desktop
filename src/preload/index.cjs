const { ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  MEDIA_STATE: 'media:state',
  MEDIA_PROGRESS: 'media:progress',
  MEDIA_CONTROL: 'media:control',
  BADGE_UPDATE: 'app:badge',
  PERFORMANCE_PROFILE: 'app:profile',
  TITLE_BAR_MENU: 'window:titlebar-menu',
  TITLE_BAR_READY: 'window:titlebar-ready',
  TITLE_BAR_STATE: 'window:titlebar-state',
  TITLE_BAR_BACK: 'window:titlebar-back',
  TITLE_BAR_MINIMIZE: 'window:titlebar-minimize',
  TITLE_BAR_TOGGLE_MAXIMIZE: 'window:titlebar-toggle-maximize',
  TITLE_BAR_CLOSE: 'window:titlebar-close',
  UPDATE_STATE: 'update:state',
  UPDATE_OPEN_DIALOG: 'update:open-dialog',
  UPDATE_RELEASE_NOTES: 'update:release-notes',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_CANCEL: 'update:cancel'
});
const ALLOWED_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);
const ALLOWED_PROFILES = new Set(['balanced', 'performance', 'powersave']);
const MEDIA_COMMAND_SELECTORS = Object.freeze({
  play_pause: 'button[data-testid="audio-player-controls-state-button"]',
  next: 'button[data-testid="audio-player-controls-forward-button"]',
  prev: 'button[data-testid="audio-player-controls-backward-button"]'
});
const BADGE_DEBOUNCE_MS = 300;
const TITLE_BAR_HEIGHT = 40;
const TITLE_BAR_ID = 'vk-desktop-titlebar';
const UPDATE_PHASES = new Set([
  'idle',
  'checking',
  'current',
  'available',
  'downloading',
  'downloaded',
  'error'
]);

function isTrustedPage() {
  return window.location.protocol === 'https:' && ALLOWED_HOSTS.has(window.location.hostname.toLowerCase());
}

function isTrustedPageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.port
      && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
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

function isNullableIdentifier(value) {
  return value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= 128)
    || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value));
}

function isNullableString(value, maxLength) {
  return value === null || isBoundedString(value, maxLength);
}

function isNullableVkUrl(value) {
  return value === null || (isBoundedString(value, 4096, false) && isTrustedPageUrl(value));
}

function isValidMediaState(payload) {
  if (!isPlainObject(payload) || typeof payload.active !== 'boolean') return false;
  if (!payload.active) return payload.reason === 'unavailable';

  return (
    ['initial', 'track', 'playback', 'seek', 'metadata'].includes(payload.reason) &&
    isBoundedString(payload.title, 128, false) &&
    isBoundedString(payload.artist, 128) &&
    isFinitePosition(payload.duration) &&
    isFinitePosition(payload.position) &&
    typeof payload.paused === 'boolean' &&
    isNullableString(payload.artwork, 4096) &&
    isNullableString(payload.contextTitle, 100) &&
    isNullableIdentifier(payload.contextId) &&
    isNullableIdentifier(payload.trackId) &&
    isNullableIdentifier(payload.trackOwnerId) &&
    isNullableString(payload.trackAccessKey, 256) &&
    isNullableVkUrl(payload.trackUrl) &&
    isNullableString(payload.releaseTitle, 128) &&
    [null, 'album', 'single', 'ep', 'maxi-single'].includes(payload.releaseType) &&
    isNullableIdentifier(payload.releaseId) &&
    isNullableIdentifier(payload.releaseOwnerId) &&
    isNullableVkUrl(payload.releaseUrl) &&
    isNullableIdentifier(payload.artistId) &&
    isNullableString(payload.artistDomain, 128) &&
    isNullableVkUrl(payload.artistUrl)
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

function isSafeHttpsUrl(value) {
  if (!isBoundedString(value, 4096, false)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function createTitleBarButton(className, label, title = label) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = title;
  return button;
}

function appendInlineMarkdown(parent, value) {
  const text = String(value ?? '');
  const tokenPattern = /(!\[([^\]]{0,200})\]\((https:\/\/[^)\s]{1,4096})\)|\[([^\]]{1,200})\]\((https:\/\/[^)\s]{1,4096})\)|`([^`\n]{1,500})`|\*\*([^*\n]{1,500})\*\*|__([^_\n]{1,500})__|~~([^~\n]{1,500})~~|(?<!\*)\*([^*\n]{1,500})\*(?!\*)|(?<!_)_([^_\n]{1,500})_(?!_))/gu;
  let offset = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > offset) parent.append(document.createTextNode(text.slice(offset, match.index)));
    if (match[2] && isSafeHttpsUrl(match[3])) {
      const image = document.createElement('img');
      image.alt = match[2];
      image.className = 'vk-desktop-release__image';
      image.loading = 'lazy';
      image.src = match[3];
      parent.append(image);
    } else if (match[4] && isSafeHttpsUrl(match[5])) {
      const link = document.createElement('a');
      link.href = match[5];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = match[4];
      parent.append(link);
    } else if (match[6]) {
      const code = document.createElement('code');
      code.textContent = match[6];
      parent.append(code);
    } else if (match[7] || match[8]) {
      const strong = document.createElement('strong');
      strong.textContent = match[7] ?? match[8];
      parent.append(strong);
    } else if (match[9]) {
      const strike = document.createElement('s');
      strike.textContent = match[9];
      parent.append(strike);
    } else if (match[10] || match[11]) {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[10] ?? match[11];
      parent.append(emphasis);
    } else {
      parent.append(document.createTextNode(match[0]));
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parent.append(document.createTextNode(text.slice(offset)));
}

function getMarkdownTableCells(line) {
  return String(line ?? '')
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownTableDivider(line) {
  const cells = getMarkdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function renderSafeMarkdown(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown ?? '').slice(0, 100_000).split(/\r?\n/u);
  let currentList = null;
  let currentParagraph = null;
  let codeLines = null;

  const resetFlow = () => {
    currentList = null;
    currentParagraph = null;
  };

  const appendCodeBlock = () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeLines.join('\n');
    pre.append(code);
    container.append(pre);
    codeLines = null;
    resetFlow();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/u.test(line.trim())) {
      if (codeLines) appendCodeBlock();
      else {
        codeLines = [];
        resetFlow();
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      resetFlow();
      continue;
    }

    if (line.includes('|') && isMarkdownTableDivider(lines[index + 1])) {
      resetFlow();
      const headerCells = getMarkdownTableCells(line);
      const table = document.createElement('table');
      const head = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const cellText of headerCells) {
        const cell = document.createElement('th');
        appendInlineMarkdown(cell, cellText);
        headerRow.append(cell);
      }
      head.append(headerRow);
      table.append(head);

      const body = document.createElement('tbody');
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const cells = getMarkdownTableCells(lines[index]);
        const row = document.createElement('tr');
        for (let cellIndex = 0; cellIndex < headerCells.length; cellIndex += 1) {
          const cell = document.createElement('td');
          appendInlineMarkdown(cell, cells[cellIndex] ?? '');
          row.append(cell);
        }
        body.append(row);
        index += 1;
      }
      table.append(body);
      container.append(table);
      index -= 1;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) {
      resetFlow();
      const element = document.createElement(`h${Math.min(heading[1].length + 1, 4)}`);
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,})\s*$/u.test(line)) {
      resetFlow();
      container.append(document.createElement('hr'));
      continue;
    }

    const listItem = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/u);
    if (listItem) {
      currentParagraph = null;
      const tagName = listItem[2] ? 'ol' : 'ul';
      if (!currentList || currentList.tagName.toLowerCase() !== tagName) {
        currentList = document.createElement(tagName);
        container.append(currentList);
      }
      const item = document.createElement('li');
      const task = listItem[3].match(/^\[([ xX])\]\s+(.+)$/u);
      if (task) {
        item.className = 'vk-desktop-release__task';
        const marker = document.createElement('span');
        marker.className = 'vk-desktop-release__task-marker';
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = task[1].toLowerCase() === 'x' ? '✓' : '';
        item.append(marker);
        appendInlineMarkdown(item, task[2]);
      } else {
        appendInlineMarkdown(item, listItem[3]);
      }
      currentList.append(item);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/u);
    if (quote) {
      resetFlow();
      const blockquote = document.createElement('blockquote');
      appendInlineMarkdown(blockquote, quote[1]);
      container.append(blockquote);
      continue;
    }

    currentList = null;
    if (!currentParagraph) {
      currentParagraph = document.createElement('p');
      container.append(currentParagraph);
    } else {
      currentParagraph.append(document.createTextNode(' '));
    }
    appendInlineMarkdown(currentParagraph, line.trim());
  }

  if (codeLines) appendCodeBlock();
  if (!container.childElementCount) {
    const empty = document.createElement('p');
    empty.textContent = 'Для этого релиза описание пока не добавлено.';
    container.append(empty);
  }
}

function normalizeTitleBarWindowState(payload) {
  if (!isPlainObject(payload)) return null;
  if (
    typeof payload.canGoBack !== 'boolean'
    || typeof payload.isMaximized !== 'boolean'
    || typeof payload.isFullScreen !== 'boolean'
  ) return null;
  return {
    canGoBack: payload.canGoBack,
    isMaximized: payload.isMaximized,
    isFullScreen: payload.isFullScreen,
    platform: isBoundedString(payload.platform, 16) ? payload.platform : 'win32'
  };
}

function normalizeUpdaterSnapshot(payload) {
  if (!isPlainObject(payload) || !UPDATE_PHASES.has(payload.phase)) return null;
  return {
    phase: payload.phase,
    progress: Math.max(0, Math.min(100, Number(payload.progress) || 0)),
    speed: isBoundedString(payload.speed, 40) ? payload.speed : '—',
    currentVersion: isBoundedString(payload.currentVersion, 64, false) ? payload.currentVersion : '—',
    availableVersion: isBoundedString(payload.availableVersion, 64, false)
      ? payload.availableVersion
      : null,
    error: isBoundedString(payload.error, 500, false) ? payload.error : null,
    runtimeSupported: Boolean(payload.runtimeSupported)
  };
}

function normalizeReleaseNotesResponse(payload) {
  if (!isPlainObject(payload)) return null;
  const release = isPlainObject(payload.release) ? payload.release : null;
  return {
    currentVersion: isBoundedString(payload.currentVersion, 64, false) ? payload.currentVersion : '—',
    availableVersion: isBoundedString(payload.availableVersion, 64, false)
      ? payload.availableVersion
      : null,
    view: payload.view === 'update' ? 'update' : 'current',
    status: isBoundedString(payload.status, 40, false) ? payload.status : 'error',
    reason: isBoundedString(payload.reason, 80) ? payload.reason : '',
    error: isBoundedString(payload.error, 500, false) ? payload.error : null,
    releasesUrl: isSafeHttpsUrl(payload.releasesUrl) ? payload.releasesUrl : null,
    release: release ? {
      version: isBoundedString(release.version, 64, false) ? release.version : '',
      tagName: isBoundedString(release.tagName, 64) ? release.tagName : '',
      name: isBoundedString(release.name, 200) ? release.name : '',
      body: isBoundedString(release.body, 100_000) ? release.body : '',
      htmlUrl: isSafeHttpsUrl(release.htmlUrl) ? release.htmlUrl : null,
      publishedAt: isBoundedString(release.publishedAt, 40) ? release.publishedAt : null
    } : null
  };
}

function initializeTitleBarBridge() {
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const offsetTimers = new Set();
  let titleBar = null;
  let themeObserver = null;
  let readyTimer = null;
  let releaseRequestId = 0;
  let releaseDialog = null;
  let releaseDialogTitle = null;
  let releaseDialogMeta = null;
  let releaseDialogStatus = null;
  let releaseDialogVersions = null;
  let releaseDialogContent = null;
  let releaseDialogActions = null;
  let releaseDialogAction = null;
  let releaseDialogExternal = null;
  let releaseDialogDismiss = null;
  let releaseDialogClose = null;
  let releaseDialogPayload = null;
  let releaseDialogView = 'current';
  let backButton = null;
  let maximizeButton = null;
  let versionButton = null;
  let versionText = null;
  let updateDot = null;
  let downloadPercent = null;
  let installButton = null;
  let previousFocus = null;
  let windowState = {
    canGoBack: false,
    isMaximized: false,
    isFullScreen: false,
    platform: 'win32'
  };
  let updaterState = {
    phase: 'idle',
    progress: 0,
    speed: '—',
    currentVersion: '—',
    availableVersion: null,
    error: null,
    runtimeSupported: false
  };

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
    if (releaseDialog) releaseDialog.dataset.theme = theme;
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

  function renderWindowState() {
    if (!titleBar) return;
    titleBar.dataset.platform = windowState.platform;
    titleBar.dataset.fullscreen = String(windowState.isFullScreen);
    if (backButton) backButton.disabled = !windowState.canGoBack;
    if (maximizeButton) {
      maximizeButton.dataset.maximized = String(windowState.isMaximized);
      const label = windowState.isMaximized ? 'Восстановить окно' : 'Развернуть окно';
      maximizeButton.setAttribute('aria-label', label);
      maximizeButton.title = label;
    }
  }

  function renderReleaseDialogAction() {
    if (!releaseDialogAction || !releaseDialogDismiss) return;
    const phase = updaterState.phase;
    const rateLimited = releaseDialogPayload?.reason === 'RATE_LIMITED';
    releaseDialogAction.hidden = true;
    releaseDialogAction.dataset.action = '';
    releaseDialogAction.disabled = false;
    releaseDialogDismiss.hidden = false;
    releaseDialogDismiss.textContent = phase === 'available' || phase === 'downloaded'
      ? 'Позже'
      : 'Закрыть';
    releaseDialogDismiss.setAttribute('aria-label', releaseDialogDismiss.textContent);

    if (phase === 'available') {
      releaseDialogAction.textContent = updaterState.availableVersion
        ? `Скачать v${updaterState.availableVersion}`
        : 'Скачать обновление';
      releaseDialogAction.dataset.action = 'download';
      releaseDialogAction.hidden = false;
    } else if (phase === 'downloading') {
      releaseDialogAction.textContent = `Отменить загрузку · ${Math.round(updaterState.progress)}%`;
      releaseDialogAction.dataset.action = 'cancel';
      releaseDialogAction.hidden = false;
    } else if (phase === 'downloaded') {
      releaseDialogAction.textContent = 'Установить и перезапустить';
      releaseDialogAction.dataset.action = 'install';
      releaseDialogAction.hidden = false;
    } else if (phase === 'error' && !rateLimited) {
      releaseDialogAction.textContent = 'Проверить снова';
      releaseDialogAction.dataset.action = 'check';
      releaseDialogAction.hidden = false;
    }
    if (!releaseDialogAction.hidden) {
      releaseDialogAction.setAttribute('aria-label', releaseDialogAction.textContent);
    }
  }

  function renderUpdaterState() {
    if (!titleBar || !versionText) return;
    titleBar.dataset.updatePhase = updaterState.phase;
    versionText.textContent = `v${updaterState.currentVersion}`;
    updateDot.hidden = updaterState.phase !== 'available';
    downloadPercent.hidden = updaterState.phase !== 'downloading';
    installButton.hidden = updaterState.phase !== 'downloaded';

    if (updaterState.phase === 'downloading') {
      downloadPercent.textContent = `${Math.round(updaterState.progress)}%`;
      versionButton.title = `Скачивание обновления — ${Math.round(updaterState.progress)}% (${updaterState.speed})`;
    } else if (updaterState.phase === 'available') {
      versionButton.title = updaterState.availableVersion
        ? `Доступно обновление v${updaterState.availableVersion}`
        : 'Доступно обновление';
    } else if (updaterState.phase === 'downloaded') {
      versionButton.title = 'Обновление скачано и готово к установке';
    } else {
      versionButton.title = 'Открыть список изменений';
    }
    versionButton.setAttribute(
      'aria-label',
      `${versionButton.title}. Установленная версия v${updaterState.currentVersion}`
    );
    renderReleaseDialogAction();
  }

  function closeReleaseDialog() {
    if (!releaseDialog || releaseDialog.hidden) return;
    releaseDialog.hidden = true;
    releaseRequestId += 1;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  function setReleaseDialogLoading() {
    releaseDialogPayload = null;
    releaseDialogTitle.textContent = 'Проверяем обновления';
    releaseDialogMeta.textContent = `Установлена версия v${updaterState.currentVersion}`;
    releaseDialogStatus.hidden = false;
    releaseDialogStatus.textContent = 'Получаем информацию о релизе…';
    releaseDialogStatus.dataset.state = 'loading';
    releaseDialogExternal.hidden = true;
    releaseDialogVersions.replaceChildren();
    releaseDialogContent.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'vk-desktop-release__loading';
    loading.textContent = 'Получаем данные с GitHub.';
    releaseDialogContent.append(loading);
    renderReleaseDialogAction();
  }

  function renderReleaseDialogVersions(payload) {
    releaseDialogVersions.replaceChildren();
    const makeVersion = (label, version, variant) => {
      const item = document.createElement('div');
      item.className = 'vk-desktop-release__version';
      item.dataset.variant = variant;
      const itemLabel = document.createElement('span');
      itemLabel.textContent = label;
      const itemValue = document.createElement('strong');
      itemValue.textContent = `v${version}`;
      item.append(itemLabel, itemValue);
      return item;
    };

    releaseDialogVersions.append(makeVersion('Установлено', payload.currentVersion, 'current'));
    const availableVersion = payload.availableVersion ?? updaterState.availableVersion;
    if (availableVersion) {
      const arrow = document.createElement('span');
      arrow.className = 'vk-desktop-release__version-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      releaseDialogVersions.append(arrow, makeVersion('Доступно', availableVersion, 'available'));
    }
  }

  function renderReleaseNotes(payload) {
    releaseDialogPayload = payload;
    const release = payload.release;
    const phase = updaterState.phase;
    const rateLimited = payload.reason === 'RATE_LIMITED';
    const availableVersion = payload.availableVersion ?? updaterState.availableVersion;
    if (rateLimited) {
      releaseDialogTitle.textContent = 'Проверка обновлений приостановлена';
    } else if (phase === 'checking') {
      releaseDialogTitle.textContent = 'Проверяем обновления';
    } else if (phase === 'downloading') {
      releaseDialogTitle.textContent = 'Скачиваем обновление';
    } else if (phase === 'downloaded') {
      releaseDialogTitle.textContent = 'Обновление готово';
    } else if (availableVersion) {
      releaseDialogTitle.textContent = `Доступна версия v${availableVersion}`;
    } else {
      releaseDialogTitle.textContent = release?.name
        || (release?.tagName ? `Что нового в ${release.tagName}` : 'Что нового');
    }

    const meta = [`Установлено: v${payload.currentVersion}`];
    if (availableVersion) meta.push(`Доступно: v${availableVersion}`);
    else if (release?.tagName) meta.push(`Релиз: ${release.tagName}`);
    if (release?.publishedAt) {
      const timestamp = Date.parse(release.publishedAt);
      if (Number.isFinite(timestamp)) {
        meta.push(new Date(timestamp).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }));
      }
    }
    releaseDialogMeta.textContent = meta.join(' · ');

    let statusMessage = payload.error ?? (phase === 'error' ? updaterState.error : null);
    if (!statusMessage && phase === 'checking') {
      statusMessage = 'Проверяем GitHub и сверяем версии.';
    } else if (!statusMessage && phase === 'downloading') {
      statusMessage = `Скачано ${Math.round(updaterState.progress)}%${updaterState.speed ? ` · ${updaterState.speed}` : ''}`;
    } else if (!statusMessage && phase === 'downloaded') {
      statusMessage = 'Файл обновления скачан. Можно перезапустить приложение и установить его.';
    } else if (!statusMessage && availableVersion) {
      statusMessage = `У тебя v${payload.currentVersion}. Доступна v${availableVersion}.`;
    } else if (!statusMessage && payload.reason === 'local-newer') {
      statusMessage = 'Установленная версия новее последнего опубликованного релиза.';
    } else if (!statusMessage && payload.reason === 'no-release') {
      statusMessage = 'Опубликованных релизов пока нет.';
    } else if (!statusMessage && payload.view === 'update') {
      statusMessage = 'Установлена актуальная версия.';
    }
    releaseDialogStatus.hidden = !statusMessage;
    releaseDialogStatus.textContent = statusMessage ?? '';
    releaseDialogStatus.dataset.state = rateLimited || phase === 'error'
      ? 'error'
      : availableVersion
        ? 'available'
        : phase === 'checking' || phase === 'downloading'
          ? 'loading'
          : 'current';
    renderReleaseDialogVersions(payload);
    renderSafeMarkdown(releaseDialogContent, release?.body ?? '');

    const externalUrl = rateLimited
      ? payload.releasesUrl
      : release?.htmlUrl ?? payload.releasesUrl;
    if (externalUrl) {
      releaseDialogExternal.href = externalUrl;
      releaseDialogExternal.textContent = rateLimited
        ? 'Открыть последние релизы ↗'
        : 'Открыть релиз на GitHub ↗';
      releaseDialogExternal.dataset.variant = rateLimited ? 'button' : 'link';
      releaseDialogExternal.hidden = false;
    } else {
      releaseDialogExternal.hidden = true;
      releaseDialogExternal.removeAttribute('href');
      releaseDialogExternal.dataset.variant = 'link';
    }
    renderReleaseDialogAction();
  }

  async function openReleaseDialog({ view = 'current' } = {}) {
    if (!releaseDialog) return;
    if (releaseDialog.hidden) previousFocus = document.activeElement;
    releaseDialogView = view === 'update' ? 'update' : 'current';
    releaseDialog.hidden = false;
    setReleaseDialogLoading();
    releaseDialogClose.focus({ preventScroll: true });
    const requestId = ++releaseRequestId;

    try {
      const response = normalizeReleaseNotesResponse(
        await ipcRenderer.invoke(CHANNELS.UPDATE_RELEASE_NOTES, { view: releaseDialogView })
      );
      if (requestId !== releaseRequestId) return;
      if (!response) {
        renderReleaseNotes({
          currentVersion: updaterState.currentVersion,
          availableVersion: updaterState.availableVersion,
          view: releaseDialogView,
          reason: 'invalid-release-notes',
          release: null,
          error: 'Получен некорректный ответ от сервиса обновлений.'
        });
        return;
      }
      renderReleaseNotes(response);
    } catch {
      if (requestId !== releaseRequestId) return;
      renderReleaseNotes({
        currentVersion: updaterState.currentVersion,
        availableVersion: updaterState.availableVersion,
        view: releaseDialogView,
        reason: 'release-notes-failed',
        release: null,
        error: 'Не удалось загрузить описание релиза.'
      });
    }
  }

  function createReleaseDialog() {
    releaseDialog = document.createElement('div');
    releaseDialog.className = 'vk-desktop-release';
    releaseDialog.hidden = true;
    releaseDialog.setAttribute('role', 'presentation');

    const card = document.createElement('section');
    card.className = 'vk-desktop-release__card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'vk-desktop-release-title');
    card.setAttribute('aria-describedby', 'vk-desktop-release-status');

    const header = document.createElement('header');
    header.className = 'vk-desktop-release__header';
    const headingGroup = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'vk-desktop-release__eyebrow';
    eyebrow.textContent = 'VK Desktop';
    releaseDialogTitle = document.createElement('h2');
    releaseDialogTitle.id = 'vk-desktop-release-title';
    releaseDialogTitle.textContent = 'Что нового';
    releaseDialogMeta = document.createElement('p');
    releaseDialogMeta.className = 'vk-desktop-release__meta';
    headingGroup.append(eyebrow, releaseDialogTitle, releaseDialogMeta);

    releaseDialogClose = createTitleBarButton(
      'vk-desktop-release__close',
      'Закрыть список изменений'
    );
    const closeIcon = document.createElement('span');
    closeIcon.className = 'vk-desktop-window-icon vk-desktop-window-icon--close';
    closeIcon.setAttribute('aria-hidden', 'true');
    releaseDialogClose.append(closeIcon);
    header.append(headingGroup, releaseDialogClose);

    releaseDialogStatus = document.createElement('p');
    releaseDialogStatus.id = 'vk-desktop-release-status';
    releaseDialogStatus.className = 'vk-desktop-release__status';
    releaseDialogStatus.setAttribute('role', 'status');
    releaseDialogStatus.setAttribute('aria-live', 'polite');
    releaseDialogVersions = document.createElement('div');
    releaseDialogVersions.className = 'vk-desktop-release__versions';
    releaseDialogContent = document.createElement('div');
    releaseDialogContent.className = 'vk-desktop-release__markdown';

    const footer = document.createElement('footer');
    footer.className = 'vk-desktop-release__footer';
    releaseDialogExternal = document.createElement('a');
    releaseDialogExternal.className = 'vk-desktop-release__external';
    releaseDialogExternal.target = '_blank';
    releaseDialogExternal.rel = 'noopener noreferrer';
    releaseDialogExternal.textContent = 'Открыть релиз на GitHub ↗';
    releaseDialogDismiss = createTitleBarButton(
      'vk-desktop-release__dismiss',
      'Закрыть окно списка изменений'
    );
    releaseDialogDismiss.textContent = 'Закрыть';
    releaseDialogDismiss.hidden = false;
    releaseDialogAction = createTitleBarButton(
      'vk-desktop-release__action',
      'Действие с обновлением'
    );
    releaseDialogActions = document.createElement('div');
    releaseDialogActions.className = 'vk-desktop-release__actions';
    releaseDialogActions.append(releaseDialogDismiss, releaseDialogAction);
    footer.append(releaseDialogExternal, releaseDialogActions);
    card.append(header, releaseDialogStatus, releaseDialogVersions, releaseDialogContent, footer);
    releaseDialog.append(card);
    document.body.append(releaseDialog);

    releaseDialogClose.addEventListener('click', closeReleaseDialog);
    releaseDialogDismiss.addEventListener('click', closeReleaseDialog);
    releaseDialog.addEventListener('mousedown', (event) => {
      if (event.target === releaseDialog) closeReleaseDialog();
    });
    releaseDialogAction.addEventListener('click', () => {
      if (releaseDialogAction.dataset.action === 'download') {
        releaseDialogAction.disabled = true;
        ipcRenderer.send(CHANNELS.UPDATE_DOWNLOAD);
      } else if (releaseDialogAction.dataset.action === 'cancel') {
        ipcRenderer.send(CHANNELS.UPDATE_CANCEL);
      } else if (releaseDialogAction.dataset.action === 'install') {
        ipcRenderer.send(CHANNELS.UPDATE_INSTALL);
      } else if (releaseDialogAction.dataset.action === 'check') {
        ipcRenderer.send(CHANNELS.UPDATE_CHECK);
      }
    });
  }

  function mountTitleBar() {
    if (!document.body || document.getElementById(TITLE_BAR_ID)) return;

    titleBar = document.createElement('div');
    titleBar.id = TITLE_BAR_ID;
    titleBar.setAttribute('role', 'banner');

    const leftControls = document.createElement('div');
    leftControls.className = 'vk-desktop-titlebar__left';
    const menuButton = createTitleBarButton(
      'vk-desktop-titlebar__button vk-desktop-titlebar__menu',
      'Открыть меню VK Desktop',
      'Меню VK Desktop'
    );
    const menuLines = document.createElement('span');
    menuLines.className = 'vk-desktop-titlebar__menu-lines';
    menuLines.setAttribute('aria-hidden', 'true');
    menuButton.append(menuLines);

    backButton = createTitleBarButton(
      'vk-desktop-titlebar__button vk-desktop-titlebar__back',
      'Назад'
    );
    const backIcon = document.createElement('span');
    backIcon.className = 'vk-desktop-titlebar__back-icon';
    backIcon.setAttribute('aria-hidden', 'true');
    backButton.append(backIcon);
    leftControls.append(menuButton, backButton);

    const brand = document.createElement('div');
    brand.className = 'vk-desktop-titlebar__brand';
    const logo = document.createElement('span');
    logo.className = 'vk-desktop-titlebar__logo';
    logo.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span');
    title.className = 'vk-desktop-titlebar__title';
    title.textContent = 'ВКонтакте';
    versionButton = createTitleBarButton(
      'vk-desktop-titlebar__version',
      'Открыть список изменений'
    );
    versionText = document.createElement('span');
    versionText.className = 'vk-desktop-titlebar__version-text';
    versionText.textContent = 'v—';
    updateDot = document.createElement('span');
    updateDot.className = 'vk-desktop-titlebar__update-dot';
    updateDot.hidden = true;
    updateDot.setAttribute('aria-hidden', 'true');
    downloadPercent = document.createElement('span');
    downloadPercent.className = 'vk-desktop-titlebar__download-percent';
    downloadPercent.hidden = true;
    versionButton.append(versionText, updateDot, downloadPercent);

    installButton = createTitleBarButton(
      'vk-desktop-titlebar__install',
      'Установить обновление и перезапустить'
    );
    installButton.hidden = true;
    const installIcon = document.createElement('span');
    installIcon.className = 'vk-desktop-titlebar__install-icon';
    installIcon.setAttribute('aria-hidden', 'true');
    installButton.append(installIcon);
    brand.append(logo, title, versionButton, installButton);

    const windowControls = document.createElement('div');
    windowControls.className = 'vk-desktop-titlebar__window-controls';
    const minimizeButton = createTitleBarButton(
      'vk-desktop-titlebar__window-button vk-desktop-titlebar__window-button--minimize',
      'Свернуть окно'
    );
    const minimizeIcon = document.createElement('span');
    minimizeIcon.className = 'vk-desktop-window-icon vk-desktop-window-icon--minimize';
    minimizeIcon.setAttribute('aria-hidden', 'true');
    minimizeButton.append(minimizeIcon);
    maximizeButton = createTitleBarButton(
      'vk-desktop-titlebar__window-button vk-desktop-titlebar__window-button--maximize',
      'Развернуть окно'
    );
    const maximizeIcon = document.createElement('span');
    maximizeIcon.className = 'vk-desktop-window-icon vk-desktop-window-icon--maximize';
    maximizeIcon.setAttribute('aria-hidden', 'true');
    maximizeButton.append(maximizeIcon);
    const closeButton = createTitleBarButton(
      'vk-desktop-titlebar__window-button vk-desktop-titlebar__window-button--close',
      'Закрыть окно'
    );
    const closeIcon = document.createElement('span');
    closeIcon.className = 'vk-desktop-window-icon vk-desktop-window-icon--close';
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.append(closeIcon);
    windowControls.append(minimizeButton, maximizeButton, closeButton);
    titleBar.append(leftControls, brand, windowControls);

    menuButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.TITLE_BAR_MENU));
    backButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.TITLE_BAR_BACK));
    minimizeButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.TITLE_BAR_MINIMIZE));
    maximizeButton.addEventListener('click', () => {
      ipcRenderer.send(CHANNELS.TITLE_BAR_TOGGLE_MAXIMIZE);
    });
    closeButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.TITLE_BAR_CLOSE));
    versionButton.addEventListener('click', () => void openReleaseDialog({ view: 'current' }));
    installButton.addEventListener('click', () => ipcRenderer.send(CHANNELS.UPDATE_INSTALL));
    document.documentElement.classList.add('vk-desktop-titlebar-active');
    document.body.prepend(titleBar);
    createReleaseDialog();

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
    renderWindowState();
    renderUpdaterState();
    for (const delay of [0, 250, 1000, 3000]) scheduleOffsetCheck(delay);
    ipcRenderer.send(CHANNELS.TITLE_BAR_READY);
    readyTimer = setTimeout(() => ipcRenderer.send(CHANNELS.TITLE_BAR_READY), 750);
  }

  function onWindowState(_event, payload) {
    const nextState = normalizeTitleBarWindowState(payload);
    if (!nextState) return;
    windowState = nextState;
    renderWindowState();
  }

  function onUpdaterState(_event, payload) {
    const nextState = normalizeUpdaterSnapshot(payload);
    if (!nextState) return;
    updaterState = nextState;
    renderUpdaterState();
    if (!releaseDialog || releaseDialog.hidden) return;
    if (updaterState.phase === 'checking') {
      releaseDialogTitle.textContent = 'Проверяем обновления';
      releaseDialogStatus.hidden = false;
      releaseDialogStatus.dataset.state = 'loading';
      releaseDialogStatus.textContent = 'Проверяем GitHub и сверяем версии.';
    } else if (updaterState.phase === 'downloading') {
      releaseDialogTitle.textContent = 'Скачиваем обновление';
      releaseDialogStatus.hidden = false;
      releaseDialogStatus.dataset.state = 'loading';
      releaseDialogStatus.textContent = `Скачано ${Math.round(updaterState.progress)}% · ${updaterState.speed}`;
    } else if (updaterState.phase === 'downloaded') {
      releaseDialogTitle.textContent = 'Обновление готово';
      releaseDialogStatus.hidden = false;
      releaseDialogStatus.dataset.state = 'current';
      releaseDialogStatus.textContent = 'Файл обновления скачан. Можно перезапустить приложение и установить его.';
    } else if (updaterState.phase === 'error' && updaterState.error) {
      releaseDialogTitle.textContent = 'Не удалось завершить обновление';
      releaseDialogStatus.hidden = false;
      releaseDialogStatus.dataset.state = 'error';
      releaseDialogStatus.textContent = updaterState.error;
    }
  }

  function onOpenUpdateDialog(_event, payload) {
    const view = payload?.view === 'current' ? 'current' : 'update';
    void openReleaseDialog({ view });
  }

  function onKeyDown(event) {
    if (!releaseDialog || releaseDialog.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReleaseDialog();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...releaseDialog.querySelectorAll('a[href], button:not([disabled])')]
        .filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus();
    }
  }

  ipcRenderer.on(CHANNELS.TITLE_BAR_STATE, onWindowState);
  ipcRenderer.on(CHANNELS.UPDATE_STATE, onUpdaterState);
  ipcRenderer.on(CHANNELS.UPDATE_OPEN_DIALOG, onOpenUpdateDialog);
  window.addEventListener('keydown', onKeyDown, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTitleBar, { once: true });
  } else {
    mountTitleBar();
  }

  window.addEventListener('beforeunload', () => {
    releaseRequestId += 1;
    if (readyTimer) clearTimeout(readyTimer);
    themeObserver?.disconnect();
    darkMediaQuery.removeEventListener('change', updateTheme);
    for (const timer of offsetTimers) clearTimeout(timer);
    offsetTimers.clear();
    ipcRenderer.removeListener(CHANNELS.TITLE_BAR_STATE, onWindowState);
    ipcRenderer.removeListener(CHANNELS.UPDATE_STATE, onUpdaterState);
    ipcRenderer.removeListener(CHANNELS.UPDATE_OPEN_DIALOG, onOpenUpdateDialog);
    window.removeEventListener('keydown', onKeyDown, true);
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
