import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkBody } from './mod-discussion.js';

void test('chunkBody keeps short bodies whole', () => {
  assert.deepEqual(chunkBody('a\nb\nc', 100), ['a\nb\nc']);
});

void test('chunkBody splits on line boundaries under the limit', () => {
  // Lines are 5 chars ("lineN"); max 12 fits two lines (5 + 1 + 5 = 11).
  const body = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
  const chunks = chunkBody(body, 12);
  for (const chunk of chunks) assert.ok(chunk.length <= 12);
  // Reassembling the lines preserves every line, in order.
  assert.deepEqual(chunks.join('\n').split('\n'), body.split('\n'));
});

void test('chunkBody hard-splits an overlong single line', () => {
  const chunks = chunkBody('x'.repeat(25), 10);
  assert.deepEqual(chunks, ['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx']);
});
