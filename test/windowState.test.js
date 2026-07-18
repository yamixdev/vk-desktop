import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWindowState } from '../src/main/window/state.js';

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

test('keeps visible bounds and clamps them to the work area', () => {
  assert.deepEqual(
    normalizeWindowState({ x: 20, y: 30, width: 5000, height: 300 }, [display], display.workArea),
    { x: 20, y: 30, width: 1920, height: 600, isMaximized: false }
  );
});

test('drops coordinates that are no longer on a connected display', () => {
  assert.deepEqual(
    normalizeWindowState({ x: 9000, y: 9000, width: 1000, height: 700, isMaximized: true }, [display], display.workArea),
    { width: 1000, height: 700, isMaximized: true }
  );
});
