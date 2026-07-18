import {
  isInternalNavigationUrl,
  isPrivilegedRendererUrl
} from '../../shared/urlPolicy.js';

export const APP_ROUTES = Object.freeze({
  HOME: '/',
  MUSIC: '/music',
  MESSAGES: '/im'
});

const ALLOWED_ROUTES = new Set(Object.values(APP_ROUTES));

export function createNavigationUrl(domain, route) {
  if (!ALLOWED_ROUTES.has(route)) throw new Error(`Unsupported application route: ${route}`);
  const targetUrl = new URL(route, `https://${domain}`).href;
  if (!isInternalNavigationUrl(targetUrl)) throw new Error(`Unsafe application domain: ${domain}`);
  return targetUrl;
}

function createSpaNavigationScript(route) {
  const serializedRoute = JSON.stringify(route);
  return `(() => {
    const route = ${serializedRoute};
    const target = new URL(route, window.location.origin);
    if (target.origin !== window.location.origin) return false;
    if (window.location.pathname === target.pathname && window.location.search === target.search) {
      return true;
    }

    try {
      if (globalThis.nav && typeof globalThis.nav.go === 'function') {
        globalThis.nav.go(target.pathname + target.search + target.hash);
        return true;
      }
    } catch {}

    for (const link of document.querySelectorAll('a[href]')) {
      try {
        const candidate = new URL(link.href, window.location.href);
        if (
          candidate.origin === target.origin
          && candidate.pathname === target.pathname
          && candidate.search === target.search
        ) {
          link.click();
          return true;
        }
      } catch {}
    }
    return false;
  })()`;
}

export async function navigateMainWindow(mainWindow, route, domain) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window is not available');

  const targetUrl = createNavigationUrl(domain, route);
  const contents = mainWindow.webContents;
  const currentUrl = contents.getURL();

  if (currentUrl === targetUrl) return true;

  try {
    if (
      isPrivilegedRendererUrl(currentUrl)
      && new URL(currentUrl).origin === new URL(targetUrl).origin
      && !contents.isLoadingMainFrame()
    ) {
      const handledBySpa = await contents.executeJavaScript(createSpaNavigationScript(route), true);
      if (handledBySpa === true) return true;
    }
  } catch (error) {
    console.warn('[Navigation] SPA transition failed, using full navigation:', error.message);
  }

  await mainWindow.loadURL(targetUrl);
  return false;
}
