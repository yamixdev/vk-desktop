import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWindowShortcut,
  classifyWindowShortcut,
  WINDOW_SHORTCUTS
} from '../src/main/window/shortcuts.js';

function key(code, overrides = {}) {
  return {
    type: 'keyDown',
    code,
    key: '',
    control: true,
    meta: false,
    alt: false,
    shift: false,
    isComposing: false,
    ...overrides
  };
}

test('recognizes zoom-in on the main keyboard and numpad', () => {
  assert.equal(classifyWindowShortcut(key('Equal', { key: '+', shift: true })), WINDOW_SHORTCUTS.ZOOM_IN);
  assert.equal(classifyWindowShortcut(key('NumpadAdd', { key: '+' })), WINDOW_SHORTCUTS.ZOOM_IN);
  assert.equal(classifyWindowShortcut(key('Minus', { key: '-' })), WINDOW_SHORTCUTS.ZOOM_OUT);
  assert.equal(classifyWindowShortcut(key('Digit0')), WINDOW_SHORTCUTS.ZOOM_RESET);
});

test('recognizes normal and cache-bypassing reload shortcuts', () => {
  assert.equal(classifyWindowShortcut(key('KeyR')), WINDOW_SHORTCUTS.RELOAD);
  assert.equal(classifyWindowShortcut(key('KeyR', { shift: true })), WINDOW_SHORTCUTS.HARD_RELOAD);
  assert.equal(classifyWindowShortcut(key('F5')), WINDOW_SHORTCUTS.HARD_RELOAD);
  assert.equal(classifyWindowShortcut(key('KeyR', { alt: true })), null);
  assert.equal(classifyWindowShortcut(key('KeyR', { type: 'keyUp' })), null);
});

test('applies zoom and reload actions through webContents', () => {
  let zoomLevel = 1;
  const calls = [];
  const webContents = {
    getZoomLevel: () => zoomLevel,
    setZoomLevel: (value) => { zoomLevel = value; },
    reload: () => calls.push('reload'),
    reloadIgnoringCache: () => calls.push('hard-reload')
  };

  assert.equal(applyWindowShortcut(webContents, WINDOW_SHORTCUTS.ZOOM_IN), true);
  assert.equal(zoomLevel, 1.5);
  applyWindowShortcut(webContents, WINDOW_SHORTCUTS.ZOOM_OUT);
  assert.equal(zoomLevel, 1);
  applyWindowShortcut(webContents, WINDOW_SHORTCUTS.ZOOM_RESET);
  assert.equal(zoomLevel, 0);
  applyWindowShortcut(webContents, WINDOW_SHORTCUTS.RELOAD);
  applyWindowShortcut(webContents, WINDOW_SHORTCUTS.HARD_RELOAD);
  assert.deepEqual(calls, ['reload', 'hard-reload']);
  assert.equal(applyWindowShortcut(webContents, 'unknown'), false);
});
