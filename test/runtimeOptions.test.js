import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRuntimeOptions } from '../src/main/runtimeOptions.js';

test('parses non-persistent benchmark overrides', () => {
  assert.deepEqual(
    parseRuntimeOptions(['electron', '.', '--benchmark', '--vk-next=off', '--benchmark-output=C:/tmp/run.jsonl']),
    { benchmark: true, benchmarkOutput: 'C:/tmp/run.jsonl', vkNextOverride: false }
  );
  assert.equal(parseRuntimeOptions(['electron', '.']).vkNextOverride, null);
});
