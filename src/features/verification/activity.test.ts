import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activityLabel,
  formatActivityReport,
  type ActivityEvent,
} from './activity.js';

void test('activityLabel maps each status to a label', () => {
  assert.equal(activityLabel('queued'), 'QUEUED');
  assert.equal(activityLabel('pass'), 'PASS (approved)');
  assert.equal(activityLabel('fail'), 'FAIL');
  assert.equal(activityLabel('approve-failed'), 'VERIFIED, APPROVE FAILED');
  assert.equal(activityLabel('error'), 'ERROR');
});

void test('formatActivityReport renders events with optional detail', () => {
  const events: ActivityEvent[] = [
    {
      id: '1',
      at: '2026-06-19T10:30:00.000Z',
      username: 'alice',
      status: 'pass',
    },
    {
      id: '2',
      at: '2026-06-19T10:29:00.000Z',
      username: 'bob',
      status: 'fail',
      detail: 'has no r/x history.',
    },
  ];
  const report = formatActivityReport(events);
  assert.match(report, /latest 2/);
  assert.match(
    report,
    /- 2026-06-19T10:30:00\.000Z — u\/alice — PASS \(approved\)$/m
  );
  assert.match(
    report,
    /- 2026-06-19T10:29:00\.000Z — u\/bob — FAIL: has no r\/x history\.$/m
  );
});

void test('formatActivityReport handles an empty feed', () => {
  assert.equal(
    formatActivityReport([]),
    'Recent verification activity\n\nNo activity recorded yet.'
  );
});
