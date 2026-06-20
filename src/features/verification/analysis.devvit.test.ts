import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, scheduler } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import {
  queueAnalysisReport,
  startAnalysisReport,
  stepAnalysisReport,
} from './analysis-run.js';

const test = createDevvitTest();

type Capture = { subjects: string[]; bodies: string[] };

function captureModmail(): Capture {
  const cap: Capture = { subjects: [], bodies: [] };
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({
    name: 'testsub',
  } as never);
  vi.spyOn(reddit, 'modMail', 'get').mockReturnValue({
    createModDiscussionConversation: async (p: {
      subject: string;
      bodyMarkdown: string;
    }) => {
      cap.subjects.push(p.subject);
      cap.bodies.push(p.bodyMarkdown);
      return 'ModmailConversation_x';
    },
  } as never);
  return cap;
}

// Drive a run to completion (the harness records jobs but doesn't run them).
async function drive(runId: string, steps = 6): Promise<void> {
  for (let i = 0; i < steps; i += 1) await stepAnalysisReport(runId);
}

test('queueAnalysisReport returns a toast and schedules a job', async () => {
  captureModmail();
  const toast = await queueAnalysisReport('active-users');

  expect(toast).toMatch(/Mod Discussions/i);
  const jobs = await scheduler.listJobs();
  expect(jobs.some((job) => job.name === 'analysisReport')).toBe(true);
});

test('active-users run tallies commenters across posts and posts the report', async () => {
  const cap = captureModmail();
  vi.spyOn(reddit, 'getNewPosts').mockReturnValue({
    all: async () => [{ id: 't3_a' }, { id: 't3_b' }],
  } as never);
  vi.spyOn(reddit, 'getComments').mockImplementation(((opts: {
    postId: string;
  }) => ({
    all: async () =>
      opts.postId === 't3_a'
        ? [{ authorName: 'alice' }, { authorName: 'bob' }]
        : [{ authorName: 'alice' }],
  })) as never);

  const runId = await startAnalysisReport('active-users');
  await drive(runId);

  expect(cap.subjects).toContain('Active users report');
  const body = cap.bodies.join('\n');
  expect(body).toMatch(/u\/alice: 2/);
  expect(body).toMatch(/u\/bob: 1/);
});

test('admin-removed run weights anti-evil removals and posts the report', async () => {
  const cap = captureModmail();
  vi.spyOn(reddit, 'getModerationLog').mockReturnValue({
    all: async () => [
      {
        id: 'm1',
        moderatorName: 'Anti-Evil Operations',
        type: 'removecomment',
        target: { author: 'spammer' },
      },
      {
        id: 'm2',
        moderatorName: 'reddit',
        type: 'removelink',
        target: { author: 'spammer' },
      },
    ],
  } as never);

  const runId = await startAnalysisReport('admin-removed');
  await drive(runId);

  expect(cap.subjects).toContain('Admin-removed items report');
  expect(cap.bodies.join('\n')).toMatch(/u\/spammer: 101/);
});
