import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  buildDiscordActivity,
  createActivityFingerprint,
  shouldSendActivity
} from '../src/main/integrations/discord.js';

const require = createRequire(import.meta.url);
const {
  VkAudioMetadataCache,
  isGenericPlaybackContext,
  normalizeVkUrl,
  parseVkAudioObject
} = require('../src/renderer/music-monitor.cjs');

function createTrack(overrides = {}) {
  return {
    active: true,
    title: 'Just the Way You Are',
    artist: 'Milky',
    duration: 210,
    position: 40,
    paused: false,
    artwork: 'https://sun1-1.vkuserphoto.ru/cover.jpg',
    contextTitle: 'VK Микс',
    contextId: 1,
    trackId: 123,
    trackOwnerId: -200,
    trackAccessKey: null,
    trackUrl: 'https://vk.ru/audio-200_123',
    releaseTitle: null,
    releaseType: null,
    releaseId: null,
    releaseOwnerId: null,
    releaseUrl: null,
    artistId: null,
    artistDomain: null,
    artistUrl: null,
    reason: 'initial',
    ...overrides
  };
}

test('generic playback contexts never become a release title', () => {
  assert.equal(isGenericPlaybackContext('VK Микс'), true);
  assert.equal(isGenericPlaybackContext('Мои треки'), true);

  const generic = parseVkAudioObject({
    id: 1,
    owner_id: -1,
    title: 'Track',
    artist: 'Artist',
    duration: 120,
    album: { title: 'VK Микс' }
  });
  assert.equal(generic.releaseTitle, null);

  const myTracks = parseVkAudioObject({
    id: 2,
    owner_id: -1,
    title: 'Track',
    artist: 'Artist',
    duration: 120,
    album: { title: 'Мои треки' }
  });
  assert.equal(myTracks.releaseTitle, null);

  const playlist = parseVkAudioObject({
    id: 3,
    owner_id: -1,
    title: 'Track',
    artist: 'Artist',
    duration: 120,
    album: { title: 'Обычный плейлист', type: 'playlist' }
  });
  assert.equal(playlist.releaseTitle, null);
});

test('keeps a real release from audio metadata', () => {
  const metadata = parseVkAudioObject({
    id: 1,
    owner_id: -1,
    title: 'Track',
    artist: 'Artist',
    duration: 120,
    album: {
      id: 42,
      title: 'Real Release',
      type: 'single',
      url: '/music/album/-1_42'
    }
  });
  assert.equal(metadata.releaseTitle, 'Real Release');
  assert.equal(metadata.releaseType, 'single');
  assert.equal(metadata.releaseUrl, 'https://vk.ru/music/album/-1_42');
});

test('matches metadata by IDs before the normalized fallback', () => {
  const cache = new VkAudioMetadataCache();
  cache.remember({
    title: 'Different title',
    artist: 'Different artist',
    duration: 10,
    trackId: 5,
    trackOwnerId: -7,
    releaseTitle: 'Release'
  });
  assert.equal(cache.find(createTrack({ trackId: 5, trackOwnerId: -7 })).releaseTitle, 'Release');
});

test('matches fallback artist/title with up to two seconds duration difference', () => {
  const cache = new VkAudioMetadataCache();
  cache.remember({
    title: 'Track — Name',
    artist: 'Artist &amp; Co',
    duration: 120,
    trackId: null,
    trackOwnerId: null,
    releaseTitle: 'Release'
  });
  const match = cache.find(createTrack({
    title: 'Track - Name',
    artist: 'Artist & Co',
    duration: 122,
    trackId: null,
    trackOwnerId: null
  }));
  assert.equal(match.releaseTitle, 'Release');
});

test('normalizes only public VK URLs', () => {
  assert.equal(normalizeVkUrl('javascript:alert(1)'), null);
  assert.equal(normalizeVkUrl('/audio-1_2', 'https://vk.ru/music'), 'https://vk.ru/audio-1_2');
  assert.equal(normalizeVkUrl('https://evil.test/audio1_2'), null);
});

test('builds a valid activity without links or invalid timestamps', () => {
  const activity = buildDiscordActivity(createTrack({
    trackUrl: null,
    artistUrl: null,
    releaseUrl: null,
    paused: true,
    duration: 0,
    position: 0
  }));
  assert.equal(activity.details, 'Just the Way You Are');
  assert.equal(activity.state, 'Milky');
  assert.equal('detailsUrl' in activity, false);
  assert.equal('stateUrl' in activity, false);
  assert.equal('startTimestamp' in activity, false);
  assert.equal('endTimestamp' in activity, false);
});

test('adds supported URLs and keeps at most one release button', () => {
  const activity = buildDiscordActivity(createTrack({
    artistUrl: 'https://vk.ru/artist/1',
    releaseTitle: 'Release',
    releaseUrl: 'https://vk.ru/music/album/-1_2'
  }));
  assert.equal(activity.detailsUrl, 'https://vk.ru/audio-200_123');
  assert.equal(activity.stateUrl, 'https://vk.ru/artist/1');
  assert.equal(activity.largeImageUrl, 'https://vk.ru/music/album/-1_2');
  assert.deepEqual(activity.buttons, [{ label: 'Открыть релиз', url: 'https://vk.ru/music/album/-1_2' }]);
  assert.ok(activity.buttons.length <= 2);
});

test('late metadata changes the fingerprint while a duplicate does not', () => {
  const initial = createTrack();
  const enriched = createTrack({
    reason: 'metadata',
    releaseTitle: 'Release',
    releaseUrl: 'https://vk.ru/music/album/-1_2',
    artistUrl: 'https://vk.ru/artist/1'
  });
  const initialFingerprint = createActivityFingerprint(initial);
  assert.equal(initialFingerprint, createActivityFingerprint(initial));
  assert.equal(shouldSendActivity(initialFingerprint, initial), false);
  assert.notEqual(createActivityFingerprint(initial), createActivityFingerprint(enriched));
  assert.equal(shouldSendActivity(initialFingerprint, enriched), true);
});
