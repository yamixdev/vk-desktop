(function initializeMusicMonitor(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (!root?.document) return;
  const allowedHosts = new Set(['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru']);
  if (root.location?.protocol !== 'https:' || !allowedHosts.has(root.location?.hostname?.toLowerCase())) {
    return;
  }
  root.__VK_DESKTOP_MUSIC_MONITOR__?.destroy?.();
  root.__VK_DESKTOP_MUSIC_MONITOR__ = api.createMonitor(root);
  root.__VK_DESKTOP_MUSIC_MONITOR__.start();
})(typeof window === 'undefined' ? null : window, function createMusicMonitorApi() {
  'use strict';

  const INTERVALS = Object.freeze({
    balanced: Object.freeze({ visiblePlaying: 1500, visiblePaused: 5000, hiddenPlaying: 4000, hiddenPaused: 15000 }),
    performance: Object.freeze({ visiblePlaying: 1000, visiblePaused: 3000, hiddenPlaying: 4000, hiddenPaused: 15000 }),
    powersave: Object.freeze({ visiblePlaying: 2500, visiblePaused: 8000, hiddenPlaying: 6000, hiddenPaused: 20000 })
  });
  const PROGRESS_INTERVAL_MS = 5000;
  const SEEK_THRESHOLD_SECONDS = 3;

  function getPollingInterval({ profile = 'balanced', visible, available, isPlaying }) {
    const selected = INTERVALS[profile] ?? INTERVALS.balanced;
    if (!visible) return available && isPlaying ? selected.hiddenPlaying : selected.hiddenPaused;
    return available && isPlaying ? selected.visiblePlaying : selected.visiblePaused;
  }

  function createSemanticKey(payload) {
    if (!payload?.active) return 'inactive';
    return [
      payload.trackId,
      payload.title,
      payload.artist,
      payload.album,
      payload.isPlaying
    ].join('|');
  }

  function isSignificantSeek(previous, current, elapsedSeconds) {
    if (!previous?.active || !current?.active || previous.trackId !== current.trackId) return false;
    const expected = previous.progress + (previous.isPlaying ? elapsedSeconds : 0);
    return Math.abs(current.progress - expected) >= SEEK_THRESHOLD_SECONDS;
  }

  function parseTime(value) {
    if (typeof value !== 'string') return 0;
    const parts = value.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  function normalizeCover(rawCover) {
    if (typeof rawCover !== 'string') return '';
    const candidate = rawCover.split(',')[0].trim().replace(/^http:/u, 'https:');
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }

  function createMonitor(win) {
    let timer = null;
    let profile = 'balanced';
    let previousSnapshot = null;
    let previousSemanticKey = '';
    let previousPollAt = 0;
    let lastProgressSentAt = 0;
    let destroyed = false;

    function post(type, payload) {
      win.postMessage({ type, payload }, win.location.origin);
    }

    function readSnapshot() {
      const player = win.ap;
      if (!player || typeof player.getCurrentAudio !== 'function') return null;

      const audio = player.getCurrentAudio();
      if (!Array.isArray(audio) || !audio[3]) return null;

      let progress = Number(player.getCurrentProgress?.());
      let duration = Number(audio[5]);

      if (!Number.isFinite(progress) || progress < 0 || !Number.isFinite(duration) || duration <= 0) {
        const timeElements = win.document.querySelectorAll('span[class*="PlaybackProgressTime__text"]');
        if (!Number.isFinite(progress) || progress < 0) {
          progress = parseTime(timeElements[0]?.textContent);
        }
        if (!Number.isFinite(duration) || duration <= 0) {
          duration = parseTime(timeElements[1]?.textContent);
        }
      }

      progress = Math.max(0, Number.isFinite(progress) ? progress : 0);
      duration = Math.max(0, Number.isFinite(duration) ? duration : 0);
      if (duration > 0) progress = Math.min(progress, duration);

      const ownerId = String(audio[1] ?? '');
      const audioId = String(audio[0] ?? '');
      const hasTrackIds = /^-?\d+$/u.test(ownerId) && /^\d+$/u.test(audioId);
      const trackId = hasTrackIds ? `${ownerId}_${audioId}` : `${audio[3]}:${audio[4] ?? ''}`;
      const album = typeof player._currentPlaylist?.title === 'string'
        ? player._currentPlaylist.title
        : '';

      return {
        active: true,
        trackId,
        title: String(audio[3] ?? '').trim().slice(0, 128),
        artist: String(audio[4] ?? '').trim().slice(0, 128),
        album: album.trim().slice(0, 100),
        cover: normalizeCover(audio[14]),
        duration: Math.min(duration, 7200),
        progress: Math.min(progress, 7200),
        isPlaying: Boolean(player.isPlaying?.()),
        url: hasTrackIds ? `https://vk.com/audio${ownerId}_${audioId}` : 'https://vk.com/music'
      };
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
        snapshot = readSnapshot();
      } catch {
        snapshot = null;
      }

      if (!snapshot) {
        if (previousSnapshot?.active) {
          post('VK_DESKTOP_MEDIA_STATE', { active: false, reason: 'unavailable' });
        }
        previousSnapshot = null;
        previousSemanticKey = 'inactive';
      } else {
        const semanticKey = createSemanticKey(snapshot);
        const elapsedSeconds = previousPollAt > 0 ? (now - previousPollAt) / 1000 : 0;
        const seeked = isSignificantSeek(previousSnapshot, snapshot, elapsedSeconds);
        let reason = null;

        if (!previousSnapshot) reason = 'initial';
        else if (previousSnapshot.trackId !== snapshot.trackId) reason = 'track';
        else if (previousSnapshot.isPlaying !== snapshot.isPlaying) reason = 'playback';
        else if (seeked) reason = 'seek';
        else if (semanticKey !== previousSemanticKey) reason = 'track';

        if (reason) {
          const payload = { ...snapshot };
          delete payload.trackId;
          post('VK_DESKTOP_MEDIA_STATE', { ...payload, reason });
          previousSemanticKey = semanticKey;
        }

        if (win.document.visibilityState === 'visible' && now - lastProgressSentAt >= PROGRESS_INTERVAL_MS) {
          post('VK_DESKTOP_MEDIA_PROGRESS', {
            progress: snapshot.progress,
            duration: snapshot.duration,
            isPlaying: snapshot.isPlaying
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
        isPlaying: Boolean(snapshot?.isPlaying)
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

    function onVisibilityChange() {
      schedule(0);
    }

    return {
      start() {
        win.addEventListener('message', onProfileMessage);
        win.document.addEventListener('visibilitychange', onVisibilityChange);
        schedule(500);
      },
      destroy() {
        destroyed = true;
        if (timer) win.clearTimeout(timer);
        timer = null;
        win.removeEventListener('message', onProfileMessage);
        win.document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }

  return {
    INTERVALS,
    createMonitor,
    createSemanticKey,
    getPollingInterval,
    isSignificantSeek
  };
});
