import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAge } from './cache.js';

void test('describeAge renders relative ages', () => {
  const now = Date.parse('2026-06-19T12:00:00.000Z');
  assert.equal(describeAge('2026-06-19T11:59:50.000Z', now), 'just now');
  assert.equal(describeAge('2026-06-19T11:59:00.000Z', now), '1 minute ago');
  assert.equal(describeAge('2026-06-19T11:30:00.000Z', now), '30 minutes ago');
  assert.equal(describeAge('2026-06-19T10:00:00.000Z', now), '2 hours ago');
  assert.equal(describeAge('2026-06-16T12:00:00.000Z', now), '3 days ago');
});

void test('describeAge clamps future timestamps to "just now"', () => {
  const now = Date.parse('2026-06-19T12:00:00.000Z');
  assert.equal(describeAge('2026-06-19T12:05:00.000Z', now), 'just now');
});
