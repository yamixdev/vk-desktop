(function bootstrapMusicMonitor(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;

  root.__VK_DESKTOP_MUSIC_MONITOR__?.destroy();
  const monitor = api.createMonitor(root);
  root.__VK_DESKTOP_MUSIC_MONITOR__ = monitor;
  monitor.start();
})(typeof window === 'undefined' ? null : window, function createMusicMonitorApi() {
  'use strict';

  const DEBUG_VK_RPC = false;
  const MAX_CACHE_ENTRIES = 500;
  const MAX_RESPONSE_TEXT_LENGTH = 2 * 1024 * 1024;
  const MAX_NETWORK_WALK_ITEMS = 750;
  const MAX_NETWORK_WALK_DEPTH = 7;
  const PROGRESS_INTERVAL_MS = 5000;
  const SEEK_THRESHOLD_SECONDS = 3;
  const GENERIC_CONTEXT_TITLES = new Set([
    'vk микс',
    'мои треки',
    'моя музыка',
    'рекомендации',
    'перемешать всё',
    'unnamed'
  ]);
  const ALLOWED_VK_HOSTS = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);
  const INTERVALS = Object.freeze({
    balanced: Object.freeze({ visiblePlaying: 1000, visiblePaused: 5000, hiddenPlaying: 4000, hiddenPaused: 15000 }),
    performance: Object.freeze({ visiblePlaying: 1000, visiblePaused: 3000, hiddenPlaying: 4000, hiddenPaused: 15000 }),
    powersave: Object.freeze({ visiblePlaying: 2500, visiblePaused: 8000, hiddenPlaying: 6000, hiddenPaused: 20000 })
  });

  function debugLog(...args) {
    if (DEBUG_VK_RPC) console.debug('[VK RPC]', ...args);
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function boundedText(value, maximum) {
    const text = firstString(value);
    return text ? text.slice(0, maximum) : null;
  }

  function isIdentifier(value) {
    return (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && /^-?\d+$/u.test(value.trim()));
  }

  function normalizeIdentifier(value) {
    if (!isIdentifier(value)) return null;
    return String(value).trim();
  }

  function clampPosition(value, maximum = 7200) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(number, maximum) : 0;
  }

  function decodeHtmlEntities(value) {
    return String(value ?? '')
      .replace(/&nbsp;/giu, ' ')
      .replace(/&amp;/giu, '&')
      .replace(/&lt;/giu, '<')
      .replace(/&gt;/giu, '>')
      .replace(/&quot;/giu, '"')
      .replace(/&#0*39;/giu, "'")
      .replace(/&apos;/giu, "'");
  }

  function normalizeTrackText(value) {
    return decodeHtmlEntities(value)
      .replace(/[‐‑‒–—―−]/gu, '-')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function isGenericPlaybackContext(value) {
    return !normalizeTrackText(value) || GENERIC_CONTEXT_TITLES.has(normalizeTrackText(value));
  }

  function normalizeVkUrl(value, origin = 'https://vk.ru') {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim(), origin);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (!ALLOWED_VK_HOSTS.has(url.hostname.toLowerCase())) return null;
      if (url.username || url.password || url.port) return null;

      // VK pages work over HTTPS. Dropping params keeps auth and internal data
      // out of Discord while preserving the public destination.
      url.protocol = 'https:';
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function normalizeArtwork(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.split(',')[0].trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.protocol = 'https:';
      return url.href;
    } catch {
      return null;
    }
  }

  function buildVkTrackUrl(ownerId, trackId, origin = 'https://vk.ru') {
    const normalizedOwnerId = normalizeIdentifier(ownerId);
    const normalizedTrackId = normalizeIdentifier(trackId);
    if (!normalizedOwnerId || !normalizedTrackId) return null;

    // VK's current audio links, including the existing client implementation,
    // use /audio{ownerId}_{trackId}. Do not add access keys or other params.
    return normalizeVkUrl(`/audio${normalizedOwnerId}_${normalizedTrackId}`, origin);
  }

  function normalizeTrackUrl(value, origin = 'https://vk.ru') {
    const url = normalizeVkUrl(value, origin);
    return url && /^\/audio-?\d+_\d+$/u.test(new URL(url).pathname) ? url : null;
  }

  function normalizeReleaseUrl(value, origin = 'https://vk.ru') {
    const url = normalizeVkUrl(value, origin);
    return url && /^\/music\/album\//u.test(new URL(url).pathname) ? url : null;
  }

  function buildVkArtistUrl({ artistId, artistDomain, artistUrl }, origin = 'https://vk.ru') {
    const directUrl = normalizeVkUrl(artistUrl, origin);
    if (directUrl) return directUrl;

    if (typeof artistDomain === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/u.test(artistDomain.trim())) {
      return normalizeVkUrl(`/${artistDomain.trim()}`, origin);
    }

    const normalizedArtistId = normalizeIdentifier(artistId);
    return normalizedArtistId ? normalizeVkUrl(`/artist/${normalizedArtistId}`, origin) : null;
  }

  function getTrackCacheKey(ownerId, trackId) {
    const normalizedOwnerId = normalizeIdentifier(ownerId);
    const normalizedTrackId = normalizeIdentifier(trackId);
    return normalizedOwnerId && normalizedTrackId ? `${normalizedOwnerId}_${normalizedTrackId}` : null;
  }

  function getFallbackCacheKey(artist, title, duration) {
    const normalizedArtist = normalizeTrackText(artist);
    const normalizedTitle = normalizeTrackText(title);
    const normalizedDuration = Math.round(Number(duration));
    if (!normalizedArtist || !normalizedTitle || !Number.isFinite(normalizedDuration)) return null;
    return `${normalizedArtist}|${normalizedTitle}|${normalizedDuration}`;
  }

  function mapReleaseType(value) {
    const normalized = normalizeTrackText(value).replace(/_/gu, '-');
    const types = {
      album: 'album',
      single: 'single',
      ep: 'ep',
      'maxi-single': 'maxi-single',
      maxisingle: 'maxi-single'
    };
    return types[normalized] ?? null;
  }

  function extractUrl(source, origin, keys = ['url', 'href', 'share_url', 'web_url']) {
    if (!source || typeof source !== 'object') return null;
    for (const key of keys) {
      const normalized = normalizeVkUrl(source[key], origin);
      if (normalized) return normalized;
    }
    return null;
  }

  function extractArtist(source, origin) {
    const mainArtist = Array.isArray(source?.main_artists)
      ? source.main_artists[0]
      : Array.isArray(source?.mainArtists)
        ? source.mainArtists[0]
        : Array.isArray(source?.artists)
          ? source.artists[0]
          : null;
    const artistObject = mainArtist && typeof mainArtist === 'object' ? mainArtist : {};
    const artistId = normalizeIdentifier(
      artistObject.id ?? artistObject.artist_id ?? source?.artist_id ?? source?.main_artist_id
    );
    const artistDomain = firstString(
      artistObject.domain,
      artistObject.screen_name,
      source?.artist_domain,
      source?.artistDomain
    ) || null;
    const artistUrl = buildVkArtistUrl({
      artistId,
      artistDomain,
      artistUrl: extractUrl(artistObject, origin) ?? firstString(source?.artist_url, source?.artistUrl)
    }, origin);

    return {
      artist: firstString(
        artistObject.name,
        artistObject.title,
        source?.artist,
        source?.performer,
        source?.subtitle
      ),
      artistId,
      artistDomain,
      artistUrl
    };
  }

  function extractRelease(source, origin) {
    const release = source?.release && typeof source.release === 'object'
      ? source.release
      : source?.album && typeof source.album === 'object'
        ? source.album
        : source?.album_info && typeof source.album_info === 'object'
          ? source.album_info
          : {};
    const releaseUrl = normalizeReleaseUrl(extractUrl(release, origin), origin) ?? normalizeReleaseUrl(
      firstString(source?.release_url, source?.releaseUrl, source?.album_url, source?.albumUrl),
      origin
    );
    const releaseType = mapReleaseType(
      release.type ?? release.release_type ?? source?.release_type ?? source?.album_type
    );
    const isPlaylist = release.is_playlist === true
      || source?.is_playlist === true
      || /playlist|collection/iu.test(String(release.type ?? source?.album_type ?? ''));
    const hasReleaseEvidence = Boolean(
      (source?.release && typeof source.release === 'object')
      || source?.release_title
      || source?.releaseTitle
      || releaseUrl
      || releaseType
    );
    if (isPlaylist || !hasReleaseEvidence) {
      return {
        releaseTitle: null,
        releaseType: null,
        releaseId: null,
        releaseOwnerId: null,
        releaseUrl: null
      };
    }

    const releaseTitle = firstString(
      release.title,
      release.name,
      source?.release_title,
      source?.releaseTitle,
      source?.album_title,
      source?.albumTitle
    );

    return {
      releaseTitle: isGenericPlaybackContext(releaseTitle) ? null : releaseTitle || null,
      releaseType,
      releaseId: normalizeIdentifier(release.id ?? release.album_id ?? source?.release_id ?? source?.album_id),
      releaseOwnerId: normalizeIdentifier(
        release.owner_id ?? release.ownerId ?? source?.release_owner_id ?? source?.album_owner_id
      ),
      releaseUrl
    };
  }

  function parseVkAudioArray(audio, origin = 'https://vk.ru') {
    if (!Array.isArray(audio) || audio.length < 6) return null;

    // Known VK audio tuple indices: 0=id, 1=owner_id, 3=title,
    // 4=artist, 5=duration. Index 14 is the player artwork in current VK.
    const trackId = normalizeIdentifier(audio[0]);
    const trackOwnerId = normalizeIdentifier(audio[1]);
    const title = firstString(audio[3]);
    const artist = firstString(audio[4]);
    const duration = clampPosition(audio[5]);
    if (!title || !artist) return null;

    return {
      title,
      artist,
      duration,
      artwork: normalizeArtwork(audio[14]),
      trackId,
      trackOwnerId,
      trackAccessKey: null,
      trackUrl: buildVkTrackUrl(trackOwnerId, trackId, origin),
      releaseTitle: null,
      releaseType: null,
      releaseId: null,
      releaseOwnerId: null,
      releaseUrl: null,
      artistId: null,
      artistDomain: null,
      artistUrl: null
    };
  }

  function parseVkAudioObject(source, origin = 'https://vk.ru') {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const trackId = normalizeIdentifier(source.id ?? source.audio_id ?? source.audioId);
    const trackOwnerId = normalizeIdentifier(source.owner_id ?? source.ownerId ?? source.owner);
    const title = firstString(source.title, source.name);
    const artistInfo = extractArtist(source, origin);
    const duration = clampPosition(source.duration);
    if (!title || !artistInfo.artist || (!trackId && !getFallbackCacheKey(artistInfo.artist, title, duration))) {
      return null;
    }

    const release = extractRelease(source, origin);
    return {
      title,
      artist: artistInfo.artist,
      duration,
      artwork: normalizeArtwork(firstString(
        source.artwork,
        source.cover,
        source.cover_url,
        source.thumb?.photo_600,
        source.thumb?.photo_300,
        source.album?.thumb?.photo_600
      )),
      trackId,
      trackOwnerId,
      trackAccessKey: firstString(source.access_key, source.accessKey) || null,
      trackUrl: normalizeTrackUrl(extractUrl(source, origin), origin)
        ?? buildVkTrackUrl(trackOwnerId, trackId, origin),
      ...release,
      artistId: artistInfo.artistId,
      artistDomain: artistInfo.artistDomain,
      artistUrl: artistInfo.artistUrl
    };
  }

  class VkAudioMetadataCache {
    constructor(limit = MAX_CACHE_ENTRIES) {
      this.limit = limit;
      this.byTrackId = new Map();
      this.byFallback = new Map();
    }

    remember(metadata) {
      if (!metadata?.title || !metadata?.artist) return false;
      const idKey = getTrackCacheKey(metadata.trackOwnerId, metadata.trackId);
      const fallbackKey = getFallbackCacheKey(metadata.artist, metadata.title, metadata.duration);
      const existing = (idKey && this.byTrackId.get(idKey)) || (fallbackKey && this.byFallback.get(fallbackKey));
      const merged = { ...existing, ...metadata };
      if (idKey) this.byTrackId.set(idKey, merged);
      if (fallbackKey) this.byFallback.set(fallbackKey, merged);
      this.#trim(this.byTrackId);
      this.#trim(this.byFallback);
      return JSON.stringify(existing ?? null) !== JSON.stringify(merged);
    }

    find(track) {
      const idKey = getTrackCacheKey(track.trackOwnerId, track.trackId);
      if (idKey && this.byTrackId.has(idKey)) return this.byTrackId.get(idKey);

      const normalizedArtist = normalizeTrackText(track.artist);
      const normalizedTitle = normalizeTrackText(track.title);
      const duration = Number(track.duration);
      if (!normalizedArtist || !normalizedTitle || !Number.isFinite(duration)) return null;
      for (const metadata of this.byFallback.values()) {
        if (
          normalizeTrackText(metadata.artist) === normalizedArtist
          && normalizeTrackText(metadata.title) === normalizedTitle
          && Math.abs(Number(metadata.duration) - duration) <= 2
        ) return metadata;
      }
      return null;
    }

    #trim(map) {
      while (map.size > this.limit) map.delete(map.keys().next().value);
    }
  }

  function collectAudioMetadata(payload, origin) {
    const result = [];
    const seen = new Set();
    let visited = 0;

    function visit(value, depth) {
      if (visited >= MAX_NETWORK_WALK_ITEMS || depth > MAX_NETWORK_WALK_DEPTH || !value) return;
      if (typeof value === 'object') {
        if (seen.has(value)) return;
        seen.add(value);
      }
      visited += 1;

      const parsed = Array.isArray(value)
        ? parseVkAudioArray(value, origin)
        : parseVkAudioObject(value, origin);
      if (parsed) result.push(parsed);

      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1);
      } else if (typeof value === 'object') {
        for (const item of Object.values(value)) visit(item, depth + 1);
      }
    }

    visit(payload, 0);
    return result;
  }

  function mergeTrackMetadata(track, metadata) {
    if (!metadata) return track;
    const pick = (key) => track[key] ?? metadata[key] ?? null;
    return {
      ...track,
      title: track.title || metadata.title,
      artist: track.artist || metadata.artist,
      duration: track.duration || metadata.duration || 0,
      artwork: track.artwork ?? metadata.artwork ?? null,
      trackId: pick('trackId'),
      trackOwnerId: pick('trackOwnerId'),
      trackAccessKey: pick('trackAccessKey'),
      trackUrl: pick('trackUrl'),
      releaseTitle: pick('releaseTitle'),
      releaseType: pick('releaseType'),
      releaseId: pick('releaseId'),
      releaseOwnerId: pick('releaseOwnerId'),
      releaseUrl: pick('releaseUrl'),
      artistId: pick('artistId'),
      artistDomain: pick('artistDomain'),
      artistUrl: pick('artistUrl')
    };
  }

  function sanitizeCurrentTrack(track) {
    return {
      ...track,
      title: boundedText(track.title, 128) ?? '',
      artist: boundedText(track.artist, 128) ?? '',
      artwork: typeof track.artwork === 'string' && track.artwork.length <= 4096 ? track.artwork : null,
      contextTitle: boundedText(track.contextTitle, 100),
      trackAccessKey: boundedText(track.trackAccessKey, 256),
      releaseTitle: boundedText(track.releaseTitle, 128),
      artistDomain: boundedText(track.artistDomain, 128)
    };
  }

  function parseTime(value) {
    if (typeof value !== 'string') return 0;
    const parts = value.trim().split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function getPollingInterval({ profile = 'balanced', visible, available, paused }) {
    const selected = INTERVALS[profile] ?? INTERVALS.balanced;
    if (!visible) return available && !paused ? selected.hiddenPlaying : selected.hiddenPaused;
    return available && !paused ? selected.visiblePlaying : selected.visiblePaused;
  }

  function getTrackIdentity(track) {
    return getTrackCacheKey(track.trackOwnerId, track.trackId)
      ?? `${normalizeTrackText(track.artist)}:${normalizeTrackText(track.title)}`;
  }

  function createSemanticKey(track) {
    if (!track?.active) return 'inactive';
    return [
      getTrackIdentity(track),
      track.contextTitle,
      track.trackUrl,
      track.releaseTitle,
      track.releaseType,
      track.releaseUrl,
      track.artistUrl,
      track.artwork,
      track.paused
    ].join('|');
  }

  function isSignificantSeek(previous, current, elapsedSeconds) {
    if (!previous?.active || !current?.active || getTrackIdentity(previous) !== getTrackIdentity(current)) return false;
    const expected = previous.position + (!previous.paused ? elapsedSeconds : 0);
    return Math.abs(current.position - expected) >= SEEK_THRESHOLD_SECONDS;
  }

  function extractDomMetadata(win, track) {
    const document = win.document;
    const playerRoot = document.querySelector('[data-testid="AudioPlayerBlock"]')
      ?? document.querySelector('[data-testid*="AudioPlayer"]');
    const root = playerRoot ?? document;
    const firstAnchor = (selector) => root.querySelector(selector) ?? document.querySelector(selector);
    const trackAnchor = firstAnchor('a[href*="/audio"]');
    const artistAnchor = firstAnchor('a[href*="/artist/"]');
    const releaseAnchor = firstAnchor('a[href*="/music/album/"]');
    const origin = win.location.origin;
    const trackUrl = normalizeTrackUrl(trackAnchor?.getAttribute('href'), origin);
    const artistUrl = normalizeVkUrl(artistAnchor?.getAttribute('href'), origin);
    const releaseUrl = normalizeReleaseUrl(releaseAnchor?.getAttribute('href'), origin);
    const trackMatch = trackUrl?.match(/\/audio(-?\d+)_(\d+)/u);
    const artistMatch = artistUrl?.match(/\/artist\/(\d+)/u);
    const releaseTitle = firstString(releaseAnchor?.textContent);

    return {
      trackId: track.trackId ?? normalizeIdentifier(trackMatch?.[2]),
      trackOwnerId: track.trackOwnerId ?? normalizeIdentifier(trackMatch?.[1]),
      trackUrl: track.trackUrl ?? trackUrl,
      artistId: track.artistId ?? normalizeIdentifier(artistMatch?.[1]),
      artistUrl: track.artistUrl ?? artistUrl,
      releaseTitle: track.releaseTitle ?? (isGenericPlaybackContext(releaseTitle) ? null : releaseTitle || null),
      releaseUrl: track.releaseUrl ?? releaseUrl
    };
  }

  function getProgressFromDom(win) {
    const semanticTimer = win.document.querySelector('[data-testid="AudioPlayerBlock_ProgressTimer"]');
    return parseTime(semanticTimer?.textContent);
  }

  function getDurationFromDom(win) {
    const durationTimer = win.document.querySelector('[data-testid="AudioPlayerBlock_Duration"]');
    if (durationTimer) return parseTime(durationTimer.textContent);
    const timeElements = win.document.querySelectorAll('span[class*="PlaybackProgressTime__text"]');
    return parseTime(timeElements[1]?.textContent);
  }

  function readMediaSessionSnapshot(win) {
    const metadata = win.navigator.mediaSession?.metadata;
    if (!metadata?.title) return null;
    const artwork = Array.isArray(metadata.artwork)
      ? normalizeArtwork(metadata.artwork.at(-1)?.src ?? metadata.artwork[0]?.src)
      : null;
    return {
      title: firstString(metadata.title),
      artist: firstString(metadata.artist),
      contextTitle: firstString(metadata.album) || null,
      artwork,
      duration: getDurationFromDom(win),
      position: getProgressFromDom(win),
      paused: win.navigator.mediaSession?.playbackState !== 'playing'
    };
  }

  function readPlayerSnapshot(win, cache) {
    const player = win.ap;
    const origin = win.location.origin;
    const audio = player?.getCurrentAudio?.();
    const playerMetadata = Array.isArray(audio)
      ? parseVkAudioArray(audio, origin)
      : parseVkAudioObject(audio, origin);
    const mediaSession = readMediaSessionSnapshot(win);
    const base = playerMetadata ?? mediaSession;
    if (!base?.title) return null;

    let position = Number(player?.getCurrentProgress?.());
    let duration = Number(playerMetadata?.duration ?? mediaSession?.duration);
    if (!Number.isFinite(position) || position < 0) position = getProgressFromDom(win);
    if (!Number.isFinite(duration) || duration <= 0) duration = getDurationFromDom(win);
    duration = clampPosition(duration);
    position = Math.min(clampPosition(position), duration || 7200);

    const playlist = player?._currentPlaylist;
    const contextTitle = firstString(playlist?.title, mediaSession?.contextTitle) || null;
    const contextId = normalizeIdentifier(playlist?.id ?? playlist?.playlist_id ?? player?._currentPlaylistId);
    const track = {
      active: true,
      title: base.title.slice(0, 128),
      artist: firstString(base.artist, mediaSession?.artist).slice(0, 128),
      duration,
      position,
      paused: player ? !player.isPlaying?.() : Boolean(mediaSession?.paused),
      artwork: base.artwork ?? mediaSession?.artwork ?? null,
      contextTitle: contextTitle?.slice(0, 100) ?? null,
      contextId,
      trackId: base.trackId ?? null,
      trackOwnerId: base.trackOwnerId ?? null,
      trackAccessKey: base.trackAccessKey ?? null,
      trackUrl: base.trackUrl ?? buildVkTrackUrl(base.trackOwnerId, base.trackId, origin),
      releaseTitle: base.releaseTitle ?? null,
      releaseType: base.releaseType ?? null,
      releaseId: base.releaseId ?? null,
      releaseOwnerId: base.releaseOwnerId ?? null,
      releaseUrl: base.releaseUrl ?? null,
      artistId: base.artistId ?? null,
      artistDomain: base.artistDomain ?? null,
      artistUrl: base.artistUrl ?? null
    };

    const cached = cache.find(track);
    const withCachedMetadata = mergeTrackMetadata(track, cached);
    return sanitizeCurrentTrack(
      mergeTrackMetadata(withCachedMetadata, extractDomMetadata(win, withCachedMetadata))
    );
  }

  function installNetworkInterceptors(win, cache, onMetadata) {
    const origin = win.location.origin;
    const consume = (text) => {
      if (typeof text !== 'string' || !text || text.length > MAX_RESPONSE_TEXT_LENGTH) return;
      try {
        const metadata = collectAudioMetadata(JSON.parse(text), origin);
        const updated = metadata.some((item) => cache.remember(item));
        if (updated) {
          debugLog('metadata cached', metadata.map(({ title, artist, trackUrl, artistUrl, releaseUrl }) => ({
            title, artist, trackUrl, artistUrl, releaseUrl
          })));
          onMetadata();
        }
      } catch {
        // Non-JSON VK responses are irrelevant to the metadata cache.
      }
    };

    const originalFetch = win.fetch;
    if (typeof originalFetch === 'function') {
      win.fetch = function interceptedFetch(...args) {
        const responsePromise = originalFetch.apply(this, args);
        void Promise.resolve(responsePromise).then((response) => {
          const contentType = response?.headers?.get?.('content-type') ?? '';
          if (!/json|javascript|text/iu.test(contentType)) return;
          return response.clone().text().then(consume).catch(() => undefined);
        }).catch(() => undefined);
        return responsePromise;
      };
    }

    const xhrPrototype = win.XMLHttpRequest?.prototype;
    const originalOpen = xhrPrototype?.open;
    if (xhrPrototype && typeof originalOpen === 'function') {
      xhrPrototype.open = function interceptedOpen(...args) {
        this.addEventListener('load', () => {
          if (this.responseType && this.responseType !== 'text') return;
          try {
            consume(this.responseText);
          } catch {
            // Reading a non-text XHR response can throw in some VK flows.
          }
        }, { once: true });
        return originalOpen.apply(this, args);
      };
    }

    return () => {
      if (win.fetch?.name === 'interceptedFetch') win.fetch = originalFetch;
      if (xhrPrototype?.open?.name === 'interceptedOpen') xhrPrototype.open = originalOpen;
    };
  }

  function createMonitor(win) {
    let timer = null;
    let profile = 'balanced';
    let previousSnapshot = null;
    let previousSemanticKey = 'inactive';
    let previousPollAt = 0;
    let lastProgressSentAt = 0;
    let destroyed = false;
    const cache = new VkAudioMetadataCache();
    const removeNetworkInterceptors = installNetworkInterceptors(win, cache, () => schedule(0));

    function post(type, payload) {
      win.postMessage({ type, payload }, win.location.origin);
    }

    function schedule(delay) {
      if (timer) win.clearTimeout(timer);
      if (!destroyed) timer = win.setTimeout(poll, delay);
    }

    function poll() {
      if (destroyed) return;
      const now = Date.now();
      let snapshot;
      try {
        snapshot = readPlayerSnapshot(win, cache);
      } catch {
        snapshot = null;
      }

      if (!snapshot) {
        if (previousSnapshot?.active) post('VK_DESKTOP_MEDIA_STATE', { active: false, reason: 'unavailable' });
        previousSnapshot = null;
        previousSemanticKey = 'inactive';
      } else {
        const semanticKey = createSemanticKey(snapshot);
        const elapsedSeconds = previousPollAt > 0 ? (now - previousPollAt) / 1000 : 0;
        const seeked = isSignificantSeek(previousSnapshot, snapshot, elapsedSeconds);
        let reason = null;

        if (!previousSnapshot) reason = 'initial';
        else if (getTrackIdentity(previousSnapshot) !== getTrackIdentity(snapshot)) reason = 'track';
        else if (previousSnapshot.paused !== snapshot.paused) reason = 'playback';
        else if (seeked) reason = 'seek';
        else if (semanticKey !== previousSemanticKey) reason = 'metadata';

        if (reason) {
          post('VK_DESKTOP_MEDIA_STATE', { ...snapshot, reason });
          previousSemanticKey = semanticKey;
        }

        if (win.document.visibilityState === 'visible' && now - lastProgressSentAt >= PROGRESS_INTERVAL_MS) {
          post('VK_DESKTOP_MEDIA_PROGRESS', {
            progress: snapshot.position,
            duration: snapshot.duration,
            isPlaying: !snapshot.paused
          });
          lastProgressSentAt = now;
        }
        previousSnapshot = snapshot;
      }

      previousPollAt = now;
      schedule(getPollingInterval({
        profile,
        visible: win.document.visibilityState === 'visible',
        available: Boolean(snapshot),
        paused: Boolean(snapshot?.paused)
      }));
    }

    function onProfileMessage(event) {
      if (event.source !== win || event.origin !== win.location.origin) return;
      if (event.data?.type !== 'VK_DESKTOP_PROFILE') return;
      if (Object.hasOwn(INTERVALS, event.data.profile)) {
        profile = event.data.profile;
        schedule(0);
      }
    }

    return {
      start() {
        win.addEventListener('message', onProfileMessage);
        win.document.addEventListener('visibilitychange', () => schedule(0));
        schedule(500);
      },
      destroy() {
        destroyed = true;
        if (timer) win.clearTimeout(timer);
        timer = null;
        removeNetworkInterceptors();
        win.removeEventListener('message', onProfileMessage);
      }
    };
  }

  return {
    DEBUG_VK_RPC,
    GENERIC_CONTEXT_TITLES,
    INTERVALS,
    VkAudioMetadataCache,
    buildVkArtistUrl,
    buildVkTrackUrl,
    collectAudioMetadata,
    createMonitor,
    createSemanticKey,
    extractRelease,
    getFallbackCacheKey,
    getPollingInterval,
    isGenericPlaybackContext,
    isSignificantSeek,
    mergeTrackMetadata,
    normalizeTrackText,
    normalizeTrackUrl,
    normalizeVkUrl,
    normalizeReleaseUrl,
    parseVkAudioArray,
    parseVkAudioObject
  };
});
