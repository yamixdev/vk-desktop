import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BadgeCountSchema,
  MediaProgressSchema,
  MediaStateSchema
} from '../src/shared/ipcSchemas.js';

test('accepts bounded semantic media state', () => {
  const parsed = MediaStateSchema.parse({
    active: true,
    reason: 'track',
    title: 'Track',
    artist: 'Artist',
    duration: 240,
    position: 12,
    paused: false,
    artwork: 'https://images.example/cover.jpg',
    contextTitle: 'VK Микс',
    contextId: 1,
    trackId: 2,
    trackOwnerId: -1,
    trackAccessKey: null,
    trackUrl: 'https://vk.com/audio-1_2',
    releaseTitle: null,
    releaseType: null,
    releaseId: null,
    releaseOwnerId: null,
    releaseUrl: null,
    artistId: null,
    artistDomain: null,
    artistUrl: null
  });
  assert.equal(parsed.title, 'Track');
});

test('rejects oversized, cross-origin and impossible media payloads', () => {
  assert.equal(MediaStateSchema.safeParse({ active: true }).success, false);
  assert.equal(MediaStateSchema.safeParse({
    active: true,
    reason: 'track',
    title: 'x'.repeat(129),
    artist: '',
    duration: 20,
    position: 30,
    paused: false,
    artwork: null,
    contextTitle: null,
    contextId: null,
    trackId: null,
    trackOwnerId: null,
    trackAccessKey: null,
    trackUrl: 'https://evil.test/audio',
    releaseTitle: null,
    releaseType: null,
    releaseId: null,
    releaseOwnerId: null,
    releaseUrl: null,
    artistId: null,
    artistDomain: null,
    artistUrl: null
  }).success, false);
  assert.equal(MediaProgressSchema.safeParse({ progress: 30, duration: 20, isPlaying: true }).success, false);
  assert.equal(BadgeCountSchema.safeParse(-1).success, false);
});
