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
    album: '',
    cover: 'https://images.example/cover.jpg',
    duration: 240,
    progress: 12,
    isPlaying: true,
    url: 'https://vk.com/audio1_2'
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
    album: '',
    cover: '',
    duration: 20,
    progress: 30,
    isPlaying: true,
    url: 'https://evil.test/audio'
  }).success, false);
  assert.equal(MediaProgressSchema.safeParse({ progress: 30, duration: 20, isPlaying: true }).success, false);
  assert.equal(BadgeCountSchema.safeParse(-1).success, false);
});
