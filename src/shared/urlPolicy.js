const HTTPS_PROTOCOL = 'https:';
const MAILTO_PROTOCOL = 'mailto:';

export const MAIN_APP_HOSTS = Object.freeze([
  'vk.com',
  'vk.ru',
  'm.vk.com',
  'm.vk.ru'
]);

export const AUTH_HOSTS = Object.freeze([
  'id.vk.com',
  'id.vk.ru',
  'login.vk.com',
  'login.vk.ru',
  'oauth.vk.com',
  'oauth.vk.ru',
  'connect.vk.com',
  'connect.vk.ru'
]);

const INTERNAL_NAVIGATION_HOSTS = new Set([...MAIN_APP_HOSTS, ...AUTH_HOSTS]);
const PRIVILEGED_RENDERER_HOSTS = new Set(MAIN_APP_HOSTS);
const EXTERNAL_REDIRECT_PATHS = new Set(['/away', '/away.php']);

const PERMISSION_HOSTS = Object.freeze({
  notifications: new Set(MAIN_APP_HOSTS),
  'clipboard-sanitized-write': new Set(MAIN_APP_HOSTS),
  media: new Set([...MAIN_APP_HOSTS, 'calls.vk.com', 'vkcalls.com']),
  mediaKeySystem: new Set([
    ...MAIN_APP_HOSTS,
    'vkvideo.ru',
    'vksport.vkvideo.ru',
    'video.vk.com',
    'video.vk.ru'
  ]),
  fullscreen: new Set([
    ...MAIN_APP_HOSTS,
    'vkvideo.ru',
    'vksport.vkvideo.ru',
    'video.vk.com',
    'video.vk.ru'
  ])
});

function parseUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isCredentialFreeHttps(url) {
  return url.protocol === HTTPS_PROTOCOL && !url.username && !url.password && !url.port;
}

export function isInternalNavigationUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    isCredentialFreeHttps(url) &&
    INTERNAL_NAVIGATION_HOSTS.has(url.hostname.toLowerCase())
  );
}

export function isPrivilegedRendererUrl(value) {
  const url = parseUrl(value);
  return Boolean(
    url &&
    isCredentialFreeHttps(url) &&
    PRIVILEGED_RENDERER_HOSTS.has(url.hostname.toLowerCase())
  );
}

export function classifyNavigationUrl(value) {
  if (isInternalNavigationUrl(value)) return 'internal';

  const url = parseUrl(value);
  if (!url) return 'deny';
  if (isCredentialFreeHttps(url)) return 'external';
  if (url.protocol === MAILTO_PROTOCOL && !/[\r\n]/u.test(value) && value.length <= 2048) {
    return 'external-confirmation';
  }
  return 'deny';
}

export function normalizeExternalUrl(value) {
  const classification = classifyNavigationUrl(value);
  if (
    classification !== 'internal' &&
    classification !== 'external' &&
    classification !== 'external-confirmation'
  ) {
    return null;
  }

  return parseUrl(value)?.href ?? null;
}

export function getExternalRedirectTarget(value) {
  const redirectUrl = parseUrl(value);
  if (
    !redirectUrl
    || !isCredentialFreeHttps(redirectUrl)
    || !PRIVILEGED_RENDERER_HOSTS.has(redirectUrl.hostname.toLowerCase())
    || !EXTERNAL_REDIRECT_PATHS.has(redirectUrl.pathname)
  ) {
    return null;
  }

  const target = redirectUrl.searchParams.get('to');
  const classification = classifyNavigationUrl(target);
  if (classification !== 'external' && classification !== 'external-confirmation') return null;
  return parseUrl(target)?.href ?? null;
}

export function isPermissionAllowedForUrl(permission, value) {
  const allowedHosts = PERMISSION_HOSTS[permission];
  if (!allowedHosts) return false;

  const url = parseUrl(value);
  return Boolean(
    url &&
    isCredentialFreeHttps(url) &&
    allowedHosts.has(url.hostname.toLowerCase())
  );
}

export function getHttpsOrigin(value) {
  const url = parseUrl(value);
  return url && isCredentialFreeHttps(url) ? url.origin : null;
}
