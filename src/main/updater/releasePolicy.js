import semver from 'semver';

export const RELEASE_CHECK_STATUS = Object.freeze({
  CURRENT: 'current',
  UPDATE_AVAILABLE: 'update-available',
  NOT_MODIFIED: 'not-modified',
  ERROR: 'error'
});

export const RELEASE_CHECK_REASON = Object.freeze({
  EQUAL: 'equal',
  LOCAL_NEWER: 'local-newer',
  NO_RELEASE: 'no-release',
  REMOTE_NEWER: 'remote-newer'
});

export const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/yamixdev/vk-desktop/releases/latest';
export const GITHUB_RELEASES_PAGE_URL =
  'https://github.com/yamixdev/vk-desktop/releases/latest';
export const GITHUB_RELEASE_TAG_URL = (version) =>
  `https://api.github.com/repos/yamixdev/vk-desktop/releases/tags/v${encodeURIComponent(version)}`;

export const MANUAL_CHECK_CACHE_MS = 5 * 60 * 1000;

export class ReleaseCheckError extends Error {
  constructor(message, {
    code = 'RELEASE_CHECK_FAILED',
    statusCode,
    retryAfterMs,
    cause
  } = {}) {
    super(message, { cause });
    this.name = 'ReleaseCheckError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

function getResponseHeader(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

function getSafeEtag(value) {
  return typeof value === 'string' && value.length <= 512 && !/[\r\n]/u.test(value)
    ? value
    : null;
}

export function getRateLimitDelayMs(response, { now = Date.now() } = {}) {
  const retryAfterSeconds = Number(getResponseHeader(response, 'retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }

  const remaining = getResponseHeader(response, 'x-ratelimit-remaining');
  const resetSeconds = Number(getResponseHeader(response, 'x-ratelimit-reset'));
  if (remaining === '0' && Number.isFinite(resetSeconds)) {
    return Math.max(0, Math.ceil(resetSeconds * 1000 - now));
  }

  return 60 * 1000;
}

function normalizeVersion(value, label) {
  const cleaned = semver.clean(String(value ?? '').trim());
  if (!cleaned || !semver.valid(cleaned)) {
    throw new ReleaseCheckError(`${label} does not contain a valid semantic version.`, {
      code: 'INVALID_VERSION'
    });
  }
  return cleaned;
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeGitHubRelease(release, version) {
  if (!release || typeof release !== 'object') return null;
  const publishedTimestamp = Date.parse(release.published_at);
  return {
    version,
    tagName: boundedText(release.tag_name, 64) || `v${version}`,
    name: boundedText(release.name, 200),
    body: boundedText(release.body, 100_000),
    htmlUrl: normalizeHttpsUrl(release.html_url),
    publishedAt: Number.isFinite(publishedTimestamp)
      ? new Date(publishedTimestamp).toISOString()
      : null
  };
}

export function compareReleaseVersions(currentVersion, remoteVersion) {
  const current = normalizeVersion(currentVersion, 'Current application version');
  const remote = normalizeVersion(remoteVersion, 'Latest release version');

  if (semver.gt(remote, current)) {
    return {
      status: RELEASE_CHECK_STATUS.UPDATE_AVAILABLE,
      reason: RELEASE_CHECK_REASON.REMOTE_NEWER,
      currentVersion: current,
      remoteVersion: remote
    };
  }

  return {
    status: RELEASE_CHECK_STATUS.CURRENT,
    reason: semver.eq(remote, current)
      ? RELEASE_CHECK_REASON.EQUAL
      : RELEASE_CHECK_REASON.LOCAL_NEWER,
    currentVersion: current,
    remoteVersion: remote
  };
}

export async function checkLatestGitHubRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
  signal,
  etag,
  now = Date.now(),
  url = GITHUB_LATEST_RELEASE_URL
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ReleaseCheckError('Fetch API is unavailable.', { code: 'FETCH_UNAVAILABLE' });
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VK-Desktop-Updater',
    'X-GitHub-Api-Version': '2026-03-10'
  };
  const safeEtag = getSafeEtag(etag);
  if (safeEtag) headers['If-None-Match'] = safeEtag;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers
    });
  } catch (error) {
    throw new ReleaseCheckError(
      error?.name === 'AbortError'
        ? 'Release check timed out.'
        : 'Could not reach the release server.',
      {
        code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        cause: error
      }
    );
  }

  if (response.status === 404) {
    return {
      status: RELEASE_CHECK_STATUS.CURRENT,
      reason: RELEASE_CHECK_REASON.NO_RELEASE,
      currentVersion: normalizeVersion(currentVersion, 'Current application version'),
      remoteVersion: null
    };
  }

  if (response.status === 304) {
    return {
      status: RELEASE_CHECK_STATUS.NOT_MODIFIED,
      etag: getSafeEtag(getResponseHeader(response, 'etag')) ?? safeEtag
    };
  }

  if (!response.ok) {
    const isRateLimited = response.status === 429
      || (response.status === 403 && (
        getResponseHeader(response, 'x-ratelimit-remaining') === '0'
        || Boolean(getResponseHeader(response, 'retry-after'))
      ));
    if (isRateLimited) {
      const retryAfterMs = getRateLimitDelayMs(response, { now });
      throw new ReleaseCheckError('GitHub API rate limit reached. Update checks are temporarily paused.', {
        code: 'RATE_LIMITED',
        statusCode: response.status,
        retryAfterMs
      });
    }
    throw new ReleaseCheckError(`Release server returned HTTP ${response.status}.`, {
      code: 'HTTP_ERROR',
      statusCode: response.status
    });
  }

  let release;
  try {
    release = await response.json();
  } catch (error) {
    throw new ReleaseCheckError('Release server returned invalid JSON.', {
      code: 'INVALID_RESPONSE',
      cause: error
    });
  }

  const comparison = compareReleaseVersions(currentVersion, release?.tag_name);
  const result = {
    ...comparison,
    release: normalizeGitHubRelease(release, comparison.remoteVersion)
  };
  const responseEtag = getSafeEtag(getResponseHeader(response, 'etag'));
  return responseEtag ? { ...result, etag: responseEtag } : result;
}

export async function getGitHubReleaseByTag({
  version,
  fetchImpl = globalThis.fetch,
  signal,
  now = Date.now(),
  url
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ReleaseCheckError('Fetch API is unavailable.', { code: 'FETCH_UNAVAILABLE' });
  }
  const normalizedVersion = normalizeVersion(version, 'Current application version');
  const requestUrl = url ?? GITHUB_RELEASE_TAG_URL(normalizedVersion);
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'VK-Desktop-Updater',
        'X-GitHub-Api-Version': '2026-03-10'
      }
    });
  } catch (error) {
    throw new ReleaseCheckError(
      error?.name === 'AbortError'
        ? 'Release lookup timed out.'
        : 'Could not reach the release server.',
      {
        code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        cause: error
      }
    );
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    const isRateLimited = response.status === 429
      || (response.status === 403 && (
        getResponseHeader(response, 'x-ratelimit-remaining') === '0'
        || Boolean(getResponseHeader(response, 'retry-after'))
      ));
    if (isRateLimited) {
      throw new ReleaseCheckError('GitHub API rate limit reached. Release lookup is temporarily paused.', {
        code: 'RATE_LIMITED',
        statusCode: response.status,
        retryAfterMs: getRateLimitDelayMs(response, { now })
      });
    }
    throw new ReleaseCheckError(`Release server returned HTTP ${response.status}.`, {
      code: 'HTTP_ERROR',
      statusCode: response.status
    });
  }

  let release;
  try {
    release = await response.json();
  } catch (error) {
    throw new ReleaseCheckError('Release server returned invalid JSON.', {
      code: 'INVALID_RESPONSE',
      cause: error
    });
  }
  return normalizeGitHubRelease(release, normalizedVersion);
}

export function isFreshCurrentCheck(lastCheck, {
  now = Date.now(),
  maxAgeMs = MANUAL_CHECK_CACHE_MS
} = {}) {
  if (lastCheck?.status !== RELEASE_CHECK_STATUS.CURRENT) return false;
  const checkedAt = Date.parse(lastCheck.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  const age = now - checkedAt;
  return age >= 0 && age <= maxAgeMs;
}
