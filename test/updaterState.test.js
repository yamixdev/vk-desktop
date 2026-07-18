import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUpdaterState,
  transitionUpdaterState,
  UPDATE_PHASES
} from '../src/main/updater/state.js';

test('covers the successful updater lifecycle', () => {
  let state = createUpdaterState();
  state = transitionUpdaterState(state, { type: 'CHECK_STARTED', manual: true });
  assert.equal(state.phase, UPDATE_PHASES.CHECKING);
  assert.equal(state.manual, true);
  state = transitionUpdaterState(state, { type: 'UPDATE_AVAILABLE' });
  state = transitionUpdaterState(state, { type: 'DOWNLOAD_STARTED' });
  state = transitionUpdaterState(state, { type: 'DOWNLOAD_PROGRESS', progress: 42 });
  assert.equal(state.progress, 42);
  state = transitionUpdaterState(state, { type: 'DOWNLOADED' });
  assert.equal(state.phase, UPDATE_PHASES.DOWNLOADED);
  assert.equal(state.progress, 100);
});

test('resets state after cancellation and preserves concurrent download', () => {
  let state = transitionUpdaterState(createUpdaterState(), { type: 'DOWNLOAD_STARTED' });
  const ignored = transitionUpdaterState(state, { type: 'CHECK_STARTED', manual: true });
  assert.equal(ignored.phase, UPDATE_PHASES.DOWNLOADING);
  state = transitionUpdaterState(state, { type: 'CANCELLED' });
  assert.deepEqual(state, createUpdaterState());
});

test('remembers a successful silent check and preserves it across reset', () => {
  let state = transitionUpdaterState(createUpdaterState(), {
    type: 'CHECK_STARTED',
    manual: false
  });
  state = transitionUpdaterState(state, {
    type: 'NO_UPDATE',
    checkedAt: '2026-07-18T12:00:00.000Z',
    currentVersion: '1.2.0',
    remoteVersion: '1.1.3',
    reason: 'local-newer'
  });

  assert.equal(state.phase, UPDATE_PHASES.CURRENT);
  assert.deepEqual(state.lastCheck, {
    status: 'current',
    checkedAt: '2026-07-18T12:00:00.000Z',
    currentVersion: '1.2.0',
    remoteVersion: '1.1.3',
    reason: 'local-newer',
    error: null
  });

  state = transitionUpdaterState(state, { type: 'RESET' });
  assert.equal(state.phase, UPDATE_PHASES.IDLE);
  assert.equal(state.lastCheck.status, 'current');
});

test('promotes an in-flight background check when the user requests it manually', () => {
  let state = transitionUpdaterState(createUpdaterState(), {
    type: 'CHECK_STARTED',
    manual: false
  });
  state = transitionUpdaterState(state, { type: 'CHECK_PROMOTED' });

  assert.equal(state.phase, UPDATE_PHASES.CHECKING);
  assert.equal(state.manual, true);
});
