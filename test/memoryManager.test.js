import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPrivateThresholdKb,
  shouldCollectGarbage
} from '../src/main/performance/memoryManager.js';

const FIVE_MINUTES = 5 * 60 * 1000;

function eligibleState(overrides = {}) {
  const now = 1_000_000;
  return {
    now,
    hiddenSince: now - FIVE_MINUTES,
    lastCollectionAt: null,
    visible: false,
    minimized: false,
    audible: false,
    mediaPlaying: false,
    loading: false,
    debuggerAttached: false,
    privateKb: getPrivateThresholdKb('balanced'),
    profile: 'balanced',
    ...overrides
  };
}

test('collects only a large, hidden and inactive renderer', () => {
  assert.equal(shouldCollectGarbage(eligibleState()), true);
  assert.equal(shouldCollectGarbage(eligibleState({ visible: true })), false);
  assert.equal(shouldCollectGarbage(eligibleState({ audible: true })), false);
  assert.equal(shouldCollectGarbage(eligibleState({ mediaPlaying: true })), false);
  assert.equal(shouldCollectGarbage(eligibleState({ loading: true })), false);
  assert.equal(shouldCollectGarbage(eligibleState({ privateKb: 128 * 1024 })), false);
});

test('uses profile thresholds and a long cooldown', () => {
  assert.equal(getPrivateThresholdKb('powersave'), 192 * 1024);
  assert.equal(getPrivateThresholdKb('performance'), 384 * 1024);
  const state = eligibleState({ lastCollectionAt: 1_000_000 - 10 * 60 * 1000 });
  assert.equal(shouldCollectGarbage(state), false);
});
