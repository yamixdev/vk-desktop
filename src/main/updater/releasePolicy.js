import semver from 'semver';

export const RELEASE_CHECK_STATUS = Object.freeze({
  CURRENT: 'current',
  UPDATE_AVAILABLE: 'update-available',
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

export const MANUAL_CHECK_CACHE_MS = 5 * 60 * 1000;

export class ReleaseCheckError extends Error {
  constructor(message, { code = 'RELEASE_CHECK_FAILED', statusCode, cause } = {}) {
    super(message, { cause });
    this.name = 'ReleaseCheckError';
    this.code = code;
    this.statusCode = statusCode;
  }
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
  url = GITHUB_LATEST_RELEASE_URL
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new ReleaseCheckError('Fetch API is unavailable.', { code: 'FETCH_UNAVAILABLE' });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'VK-Desktop-Updater',
        'X-GitHub-Api-Version': '2022-11-28'
      }
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

  if (!response.ok) {
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

  return compareReleaseVersions(currentVersion, release?.tag_name);
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
