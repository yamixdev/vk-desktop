import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createSemanticKey,
  getPollingInterval,
  isSignificantSeek
} = require('../src/renderer/music-monitor.cjs');

test('uses adaptive polling without disabling background music', () => {
  assert.equal(getPollingInterval({ profile: 'balanced', visible: true, available: true, isPlaying: true }), 1500);
  assert.equal(getPollingInterval({ profile: 'balanced', visible: false, available: true, isPlaying: true }), 4000);
  assert.equal(getPollingInterval({ profile: 'powersave', visible: false, available: false, isPlaying: false }), 20000);
});

test('semantic key ignores continuous progress', () => {
  const base = { active: true, trackId: '1_2', title: 'Track', artist: 'Artist', album: '', isPlaying: true };
  assert.equal(
    createSemanticKey({ ...base, progress: 1 }),
    createSemanticKey({ ...base, progress: 200 })
  );
});

test('detects a real seek but not expected playback progress', () => {
  const previous = { active: true, trackId: '1_2', progress: 10, isPlaying: true };
  assert.equal(isSignificantSeek(previous, { ...previous, progress: 12 }, 2), false);
  assert.equal(isSignificantSeek(previous, { ...previous, progress: 40 }, 2), true);
});
