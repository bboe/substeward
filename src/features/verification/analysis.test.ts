import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminRemovedWeight,
  formatCountsMessages,
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

void test('formatCountsMessages renders the empty state', () => {
  assert.deepEqual(formatCountsMessages('T', []), [
    'T\n\nNo matching users found.',
  ]);
});

void test('formatCountsMessages renders a table with linked usernames', () => {
  const messages = formatCountsMessages(
    'T',
    [
      ['alice', 2],
      ['bob', 1],
    ],
    'Comments'
  );
  assert.equal(messages.length, 1);
  assert.equal(
    messages[0],
    'T\n\n| User | Comments |\n| --- | --- |\n' +
      '| [u/alice](https://www.reddit.com/user/alice) | 2 |\n' +
      '| [u/bob](https://www.reddit.com/user/bob) | 1 |'
  );
});

void test('formatCountsMessages splits long reports and repeats the header', () => {
  const rows: Array<[string, number]> = Array.from({ length: 400 }, (_, i) => [
    `user${i}`,
    1,
  ]);
  const messages = formatCountsMessages('T', rows, 'Comments');
  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.ok(message.length < 10000);
    assert.ok(message.includes('| User | Comments |')); // header on every part
    assert.ok(message.includes('part ')); // labeled
  }
});
