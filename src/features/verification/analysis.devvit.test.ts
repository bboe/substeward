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
  // The thread is created with the first message as its body and the rest are
  // replies, so capture both create bodies and reply bodies into `bodies`.
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
    reply: async (p: { body: string }) => {
      cap.bodies.push(p.body);
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
  expect(body).toMatch(/Recently active users/);
  expect(body).toMatch(/`u\/alice`: 2/);
  expect(body).toMatch(/`u\/bob`: 1/);
});

test('a large active-users report is split across multiple replies', async () => {
  const cap = captureModmail();
  const authors = Array.from({ length: 800 }, (_, i) => ({
    authorName: `user${i}`,
  }));
  vi.spyOn(reddit, 'getNewPosts').mockReturnValue({
    all: async () => [{ id: 't3_a' }],
  } as never);
  vi.spyOn(reddit, 'getComments').mockReturnValue({
    all: async () => authors,
  } as never);

  const runId = await startAnalysisReport('active-users');
  await drive(runId);

  expect(cap.bodies.length).toBeGreaterThan(1);
  for (const body of cap.bodies) expect(body.length).toBeLessThan(10000);
  const joined = cap.bodies.join('\n');
  expect(joined).toMatch(/`u\/user0`: 1/);
  expect(joined).toMatch(/`u\/user799`: 1/);
  expect(cap.bodies[0]).toMatch(/part 1\//);
});

test('active-users run finalizes when there are no recent posts', async () => {
  // Guards against the no-progress loop: an empty post list must still reach
  // finalize rather than rescheduling forever (which trips the runJob limit).
  const cap = captureModmail();
  vi.spyOn(reddit, 'getNewPosts').mockReturnValue({
    all: async () => [],
  } as never);

  const runId = await startAnalysisReport('active-users');
  await drive(runId);

  expect(cap.subjects).toContain('Active users report');
  expect(cap.bodies.join('\n')).toMatch(/No matching users found/);
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
  const body = cap.bodies.join('\n');
  expect(body).toMatch(/Users with admin-removed items/);
  expect(body).toMatch(/`u\/spammer`: 101/);
});
