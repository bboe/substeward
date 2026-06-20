import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminRemovedWeight,
  formatCountsReport,
  isCountableAuthor,
  sortCounts,
} from './analysis.js';

void test('adminRemovedWeight scores anti-evil over admin, ignores the rest', () => {
  assert.equal(
    adminRemovedWeight('Anti-Evil Operations', 'removecomment'),
    100
  );
  assert.equal(adminRemovedWeight('reddit', 'removelink'), 1);
  assert.equal(adminRemovedWeight('somemod', 'removecomment'), 0);
  assert.equal(adminRemovedWeight('reddit', 'approvelink'), 0);
});

void test('isCountableAuthor skips missing and deleted authors', () => {
  assert.equal(isCountableAuthor('alice'), true);
  assert.equal(isCountableAuthor(undefined), false);
  assert.equal(isCountableAuthor('[deleted]'), false);
});

void test('sortCounts orders by score desc, then username asc', () => {
  assert.deepEqual(sortCounts({ bob: 1, alice: 2, carol: 2 }), [
    ['alice', 2],
    ['carol', 2],
    ['bob', 1],
  ]);
});

void test('formatCountsReport renders rows and the empty state', () => {
  assert.equal(formatCountsReport('T', []), 'T\n\nNo matching users found.');
  assert.equal(
    formatCountsReport('T', [
      ['alice', 2],
      ['bob', 1],
    ]),
    'T\n\n- `u/alice`: 2\n- `u/bob`: 1'
  );
});
