import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLatestGitHubRelease,
  compareReleaseVersions,
  getGitHubReleaseByTag,
  getRateLimitDelayMs,
  GITHUB_RELEASES_PAGE_URL,
  isFreshCurrentCheck,
  RELEASE_CHECK_REASON,
  RELEASE_CHECK_STATUS
} from '../src/main/updater/releasePolicy.js';

test('compares equal, newer local, and newer remote versions', () => {
  assert.deepEqual(compareReleaseVersions('1.2.0', 'v1.2.0'), {
    status: RELEASE_CHECK_STATUS.CURRENT,
    reason: RELEASE_CHECK_REASON.EQUAL,
    currentVersion: '1.2.0',
    remoteVersion: '1.2.0'
  });

  assert.deepEqual(compareReleaseVersions('1.2.0', 'v1.1.3'), {
    status: RELEASE_CHECK_STATUS.CURRENT,
    reason: RELEASE_CHECK_REASON.LOCAL_NEWER,
    currentVersion: '1.2.0',
    remoteVersion: '1.1.3'
  });

  assert.deepEqual(compareReleaseVersions('1.2.0', 'v1.3.0'), {
    status: RELEASE_CHECK_STATUS.UPDATE_AVAILABLE,
    reason: RELEASE_CHECK_REASON.REMOTE_NEWER,
    currentVersion: '1.2.0',
    remoteVersion: '1.3.0'
  });
});

test('treats a missing GitHub release as a current local build', async () => {
  const result = await checkLatestGitHubRelease({
    currentVersion: '1.2.0',
    fetchImpl: async () => ({
      ok: false,
      status: 404
    })
  });

  assert.deepEqual(result, {
    status: RELEASE_CHECK_STATUS.CURRENT,
    reason: RELEASE_CHECK_REASON.NO_RELEASE,
    currentVersion: '1.2.0',
    remoteVersion: null
  });
});

test('reads and compares the latest GitHub release tag', async () => {
  let request;
  const result = await checkLatestGitHubRelease({
    currentVersion: '1.2.0',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.3.0',
          name: 'VK Desktop 1.3.0',
          body: '## Исправления\n\n- Готово',
          html_url: 'https://github.com/yamixdev/vk-desktop/releases/tag/v1.3.0',
          published_at: '2026-07-18T12:00:00.000Z'
        })
      };
    }
  });

  assert.equal(result.status, RELEASE_CHECK_STATUS.UPDATE_AVAILABLE);
  assert.equal(result.remoteVersion, '1.3.0');
  assert.deepEqual(result.release, {
    version: '1.3.0',
    tagName: 'v1.3.0',
    name: 'VK Desktop 1.3.0',
    body: '## Исправления\n\n- Готово',
    htmlUrl: 'https://github.com/yamixdev/vk-desktop/releases/tag/v1.3.0',
    publishedAt: '2026-07-18T12:00:00.000Z'
  });
  assert.equal(request.options.headers['User-Agent'], 'VK-Desktop-Updater');
});

test('reads the installed release by its GitHub tag', async () => {
  let requestUrl;
  const release = await getGitHubReleaseByTag({
    version: '1.2.0',
    fetchImpl: async (url) => {
      requestUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.2.0',
          name: 'VK Desktop 1.2.0',
          body: '## Изменения\n\n- Готово',
          html_url: 'https://github.com/yamixdev/vk-desktop/releases/tag/v1.2.0',
          published_at: '2026-07-24T12:00:00.000Z'
        })
      };
    }
  });

  assert.match(requestUrl, /\/releases\/tags\/v1\.2\.0$/u);
  assert.equal(release.tagName, 'v1.2.0');
  assert.equal(release.version, '1.2.0');
});

test('uses a cached ETag and accepts a not-modified response', async () => {
  let request;
  const result = await checkLatestGitHubRelease({
    currentVersion: '1.2.0',
    etag: '"release-etag"',
    fetchImpl: async (_url, options) => {
      request = options;
      return {
        ok: false,
        status: 304,
        headers: new Headers({ etag: '"release-etag"' })
      };
    }
  });

  assert.equal(request.headers['If-None-Match'], '"release-etag"');
  assert.deepEqual(result, {
    status: RELEASE_CHECK_STATUS.NOT_MODIFIED,
    etag: '"release-etag"'
  });
});

test('turns GitHub rate-limit headers into a cooldown', async () => {
  assert.equal(
    GITHUB_RELEASES_PAGE_URL,
    'https://github.com/yamixdev/vk-desktop/releases/latest'
  );
  const now = Date.parse('2026-07-30T12:00:00.000Z');
  const response = {
    headers: new Headers({ 'retry-after': '120' })
  };
  assert.equal(getRateLimitDelayMs(response, { now }), 120_000);
  assert.equal(getRateLimitDelayMs({
    headers: new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor((now + 90_000) / 1000))
    })
  }, { now }), 90_000);

  await assert.rejects(
    checkLatestGitHubRelease({
      currentVersion: '1.2.0',
      now,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '120' })
      })
    }),
    (error) => error.code === 'RATE_LIMITED' && error.retryAfterMs === 120_000
  );
});

test('turns network and malformed-version failures into typed errors', async () => {
  await assert.rejects(
    checkLatestGitHubRelease({
      currentVersion: '1.2.0',
      fetchImpl: async () => { throw new Error('offline'); }
    }),
    (error) => error.code === 'NETWORK_ERROR'
  );

  await assert.rejects(
    checkLatestGitHubRelease({
      currentVersion: '1.2.0',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ tag_name: 'not-a-version' })
      })
    }),
    (error) => error.code === 'INVALID_VERSION'
  );
});

test('reuses only a recent successful current-version check', () => {
  const now = Date.parse('2026-07-18T12:00:00.000Z');
  const fresh = {
    status: RELEASE_CHECK_STATUS.CURRENT,
    checkedAt: '2026-07-18T11:58:00.000Z'
  };
  const stale = {
    status: RELEASE_CHECK_STATUS.CURRENT,
    checkedAt: '2026-07-18T11:00:00.000Z'
  };

  assert.equal(isFreshCurrentCheck(fresh, { now }), true);
  assert.equal(isFreshCurrentCheck(stale, { now }), false);
  assert.equal(isFreshCurrentCheck({ ...fresh, status: RELEASE_CHECK_STATUS.ERROR }, { now }), false);
});
