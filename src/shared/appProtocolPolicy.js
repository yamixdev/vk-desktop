export const APP_SCHEME = 'vk-desktop';
export const APP_HOST = 'local';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MAX_URL_LENGTH = 2048;

const APP_ASSETS = Object.freeze({
  '/offline.html': Object.freeze({
    fileName: 'offline.html',
    contentType: 'text/html; charset=utf-8',
    document: true
  }),
  '/offline.css': Object.freeze({
    fileName: 'offline.css',
    contentType: 'text/css; charset=utf-8',
    document: false
  }),
  '/offline.js': Object.freeze({
    fileName: 'offline.js',
    contentType: 'text/javascript; charset=utf-8',
    document: false
  }),
  '/error.html': Object.freeze({
    fileName: 'error.html',
    contentType: 'text/html; charset=utf-8',
    document: true
  }),
  '/error.js': Object.freeze({
    fileName: 'error.js',
    contentType: 'text/javascript; charset=utf-8',
    document: false
  }),
  '/update-progress.html': Object.freeze({
    fileName: 'update-progress.html',
    contentType: 'text/html; charset=utf-8',
    document: true
  }),
  '/update-progress.css': Object.freeze({
    fileName: 'update-progress.css',
    contentType: 'text/css; charset=utf-8',
    document: false
  }),
  '/update-progress.js': Object.freeze({
    fileName: 'update-progress.js',
    contentType: 'text/javascript; charset=utf-8',
    document: false
  })
});

export const APP_PAGE_URLS = Object.freeze({
  offline: `${APP_ORIGIN}/offline.html`,
  error: `${APP_ORIGIN}/error.html`,
  updateProgress: `${APP_ORIGIN}/update-progress.html`
});

export function getAppAssetDescriptor(rawUrl, method = 'GET') {
  if (
    typeof rawUrl !== 'string'
    || rawUrl.length === 0
    || rawUrl.length > MAX_URL_LENGTH
    || method !== 'GET'
  ) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== `${APP_SCHEME}:`
      || parsed.hostname !== APP_HOST
      || parsed.username
      || parsed.password
      || parsed.port
    ) {
      return null;
    }
    return APP_ASSETS[parsed.pathname] ?? null;
  } catch {
    return null;
  }
}

export function isAppPageUrl(rawUrl) {
  return getAppAssetDescriptor(rawUrl)?.document === true;
}
