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
  assert.equal(getPollingInterval({ profile: 'balanced', visible: true, available: true, paused: false }), 1000);
  assert.equal(getPollingInterval({ profile: 'balanced', visible: false, available: true, paused: false }), 4000);
  assert.equal(getPollingInterval({ profile: 'powersave', visible: false, available: false, paused: true }), 20000);
});

test('semantic key ignores continuous progress', () => {
  const base = {
    active: true,
    trackId: '2',
    trackOwnerId: '1',
    title: 'Track',
    artist: 'Artist',
    paused: false
  };
  assert.equal(
    createSemanticKey({ ...base, progress: 1 }),
    createSemanticKey({ ...base, progress: 200 })
  );
});

test('detects a real seek but not expected playback progress', () => {
  const previous = { active: true, trackId: '2', trackOwnerId: '1', position: 10, paused: false };
  assert.equal(isSignificantSeek(previous, { ...previous, position: 12 }, 2), false);
  assert.equal(isSignificantSeek(previous, { ...previous, position: 40 }, 2), true);
});
