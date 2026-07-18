import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_BAR_HEIGHT,
  createTitleBarOverlay,
  normalizeTitleBarTheme
} from '../src/main/window/titleBar.js';

test('uses matching native-control colors for light and dark title bars', () => {
  assert.deepEqual(createTitleBarOverlay('light'), {
    color: '#f0f2f5',
    symbolColor: '#141414',
    height: TITLE_BAR_HEIGHT
  });
  assert.deepEqual(createTitleBarOverlay('dark'), {
    color: '#19191a',
    symbolColor: '#f2f3f5',
    height: TITLE_BAR_HEIGHT
  });
});

test('falls back to a readable light title bar for invalid input', () => {
  assert.equal(normalizeTitleBarTheme('unknown'), 'light');
  assert.deepEqual(createTitleBarOverlay(null), createTitleBarOverlay('light'));
});
