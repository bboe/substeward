import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCountsReport,
  tallyAdminRemoved,
  tallyCommentAuthors,
  type AdminLogEntry,
} from './analysis.js';

void test('tallyAdminRemoved weights anti-evil over admin and sorts', () => {
  const entries: AdminLogEntry[] = [
    {
      moderatorName: 'Anti-Evil Operations',
      type: 'removecomment',
      author: 'alice',
    },
    { moderatorName: 'reddit', type: 'removelink', author: 'bob' },
    { moderatorName: 'reddit', type: 'removecomment', author: 'alice' },
    // Ignored: normal mod, not admin/anti-evil.
    { moderatorName: 'somemod', type: 'removecomment', author: 'carol' },
    // Ignored: non-removal action.
    { moderatorName: 'reddit', type: 'addmoderator', author: 'dave' },
    // Ignored: no author.
    {
      moderatorName: 'Anti-Evil Operations',
      type: 'removelink',
      author: undefined,
    },
  ];
  assert.deepEqual(tallyAdminRemoved(entries), [
    ['alice', 101],
    ['bob', 1],
  ]);
});

void test('tallyCommentAuthors counts and skips deleted/empty authors', () => {
  assert.deepEqual(
    tallyCommentAuthors(['alice', 'bob', 'alice', '[deleted]', undefined]),
    [
      ['alice', 2],
      ['bob', 1],
    ]
  );
});

void test('formatCountsReport renders rows and an empty fallback', () => {
  assert.equal(
    formatCountsReport('Title', [
      ['alice', 2],
      ['bob', 1],
    ]),
    'Title\n\n- u/alice: 2\n- u/bob: 1'
  );
  assert.equal(
    formatCountsReport('Title', []),
    'Title\n\nNo matching users found.'
  );
});
