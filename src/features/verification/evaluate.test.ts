import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkComments,
  checkNotes,
  checkStatus,
  formatDateTime,
  formatFailure,
  formatResults,
  markerFrom,
  mostCommon,
  processComments,
  type CommentData,
  type VerificationConfig,
} from './evaluate.js';

const TZ = 'America/Los_Angeles';

const CONFIG: VerificationConfig = {
  subredditName: 'devvit',
  oldestCommentDays: 182,
  minKarmaAverage: 1,
  subredditsToShow: 10,
  timezone: TZ,
};

function comment(
  subredditName: string,
  score: number,
  iso: string
): CommentData {
  return { subredditName, score, createdAt: new Date(iso) };
}

void test('formatDateTime renders in the configured timezone', () => {
  // 17:30 UTC in January is 09:30 PST.
  assert.equal(
    formatDateTime(new Date('2024-01-15T17:30:00Z'), TZ),
    '2024-01-15 09:30:00 PST'
  );
});

void test('markerFrom subtracts the configured number of days', () => {
  const now = new Date('2024-07-01T00:00:00Z');
  const marker = markerFrom(now, 182);
  assert.equal(marker.toISOString(), '2024-01-01T00:00:00.000Z');
});

void test('checkStatus rejects missing users', () => {
  const marker = new Date('2024-01-01T00:00:00Z');
  assert.equal(
    checkStatus({
      userExists: false,
      createdAt: undefined,
      marker,
      timezone: TZ,
    }),
    'is not found or suspended. No history information available.'
  );
});

void test('checkStatus rejects too-recent accounts', () => {
  const marker = new Date('2024-01-01T00:00:00Z');
  const error = checkStatus({
    userExists: true,
    createdAt: new Date('2024-06-01T12:00:00Z'),
    marker,
    timezone: TZ,
  });
  assert.match(error ?? '', /was created too recently/);
});

void test('checkStatus accepts old-enough accounts', () => {
  const marker = new Date('2024-01-01T00:00:00Z');
  assert.equal(
    checkStatus({
      userExists: true,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      marker,
      timezone: TZ,
    }),
    null
  );
});

void test('checkNotes rejects bans and mutes, accepts otherwise', () => {
  assert.equal(
    checkNotes({ BAN: 2 }),
    'has 2 ban(s). Skipped history collection.'
  );
  assert.equal(
    checkNotes({ MUTE: 1 }),
    'has 1 mute(s). Skipped history collection.'
  );
  assert.equal(checkNotes({ NOTE: 5, APPROVAL: 1 }), null);
  assert.equal(checkNotes({}), null);
});

void test('processComments aggregates counts, karma, and ordering', () => {
  const stats = processComments(
    [
      comment('devvit', 5, '2023-02-01T00:00:00Z'),
      comment('news', 2, '2023-03-01T00:00:00Z'),
      comment('devvit', 3, '2023-01-01T00:00:00Z'),
    ],
    'devvit'
  );

  assert.equal(stats.found, 3);
  assert.equal(stats.subjectComments.length, 2);
  // Sorted oldest-first.
  assert.equal(
    stats.subjectComments[0]!.createdAt.toISOString(),
    '2023-01-01T00:00:00.000Z'
  );
  assert.equal(stats.karma, 8);
  assert.equal(stats.karmaAverage, 4);
  // First-seen order preserved across subreddits.
  assert.deepEqual(stats.subredditOrder, [
    ['devvit', 2],
    ['news', 1],
  ]);
});

void test('checkComments enforces history, age, and karma thresholds', () => {
  const marker = new Date('2024-01-01T00:00:00Z');

  const empty = processComments([], 'devvit');
  assert.equal(
    checkComments(empty, {
      subredditName: 'devvit',
      marker,
      minKarmaAverage: 1,
      timezone: TZ,
    }),
    'has no r/devvit history.'
  );

  const tooRecent = processComments(
    [comment('devvit', 10, '2024-06-01T00:00:00Z')],
    'devvit'
  );
  assert.match(
    checkComments(tooRecent, {
      subredditName: 'devvit',
      marker,
      minKarmaAverage: 1,
      timezone: TZ,
    }) ?? '',
    /oldest r\/devvit comment is too recent/
  );

  const lowKarma = processComments(
    [comment('devvit', 0, '2023-01-01T00:00:00Z')],
    'devvit'
  );
  assert.equal(
    checkComments(lowKarma, {
      subredditName: 'devvit',
      marker,
      minKarmaAverage: 1,
      timezone: TZ,
    }),
    'too low of karma average'
  );

  const good = processComments(
    [comment('devvit', 5, '2023-01-01T00:00:00Z')],
    'devvit'
  );
  assert.equal(
    checkComments(good, {
      subredditName: 'devvit',
      marker,
      minKarmaAverage: 1,
      timezone: TZ,
    }),
    null
  );
});

void test('mostCommon sorts by count desc keeping ties in insertion order', () => {
  const order: Array<[string, number]> = [
    ['a', 1],
    ['b', 3],
    ['c', 1],
    ['d', 3],
  ];
  assert.deepEqual(mostCommon(order, 0), [
    ['b', 3],
    ['d', 3],
    ['a', 1],
    ['c', 1],
  ]);
  assert.deepEqual(mostCommon(order, 2), [
    ['b', 3],
    ['d', 3],
  ]);
});

void test('formatResults produces an indented markdown report', () => {
  const stats = processComments(
    [
      comment('devvit', 5, '2023-01-01T00:00:00Z'),
      comment('devvit', 3, '2023-06-01T00:00:00Z'),
      comment('news', 1, '2023-02-01T00:00:00Z'),
    ],
    'devvit'
  );
  const report = formatResults({
    username: 'someuser',
    createdAt: new Date('2018-01-01T00:00:00Z'),
    stats,
    noteTypeCounts: { NOTE: 2, APPROVAL: 1 },
    config: CONFIG,
  });

  assert.match(report, /^ {4} {16}User: someuser$/m);
  assert.match(report, /Commented subreddits: 2/);
  assert.match(report, /- devvit \(2 comments\)/);
  assert.match(report, /Comment karma: 8/);
  assert.match(report, /Average karma: 4\.00/);
  assert.match(report, / {9}APPROVAL count: 1/);
  assert.match(report, / {13}NOTE count: 2/);
});

void test('formatFailure renders the fail message', () => {
  assert.equal(
    formatFailure('baduser', 'has 1 ban(s). Skipped history collection.'),
    'u/baduser: verification fail\n\nAccount has 1 ban(s). Skipped history collection.'
  );
});
