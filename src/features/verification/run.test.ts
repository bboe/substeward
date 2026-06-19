import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStale, shouldStopFetching } from './run.js';

void test('shouldStopFetching stops when the limit is reached', () => {
  assert.equal(
    shouldStopFetching({
      total: 1000,
      limit: 1000,
      pageDone: false,
      hasNextCursor: true,
    }),
    true
  );
});

void test('shouldStopFetching stops on the last page or missing cursor', () => {
  assert.equal(
    shouldStopFetching({
      total: 50,
      limit: 1000,
      pageDone: true,
      hasNextCursor: true,
    }),
    true
  );
  assert.equal(
    shouldStopFetching({
      total: 50,
      limit: 1000,
      pageDone: false,
      hasNextCursor: false,
    }),
    true
  );
});

void test('shouldStopFetching continues mid-listing under the limit', () => {
  assert.equal(
    shouldStopFetching({
      total: 200,
      limit: 1000,
      pageDone: false,
      hasNextCursor: true,
    }),
    false
  );
});

void test('isStale compares update time against the window', () => {
  const now = Date.parse('2026-06-19T10:10:00.000Z');
  // Updated 6 minutes ago, window is 5 minutes => stale.
  assert.equal(isStale('2026-06-19T10:04:00.000Z', now, 5 * 60 * 1000), true);
  // Updated 2 minutes ago => fresh.
  assert.equal(isStale('2026-06-19T10:08:00.000Z', now, 5 * 60 * 1000), false);
});
