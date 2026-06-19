import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, redis } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import { runWatchdog, startVerification, stepVerification } from './run.js';
import { getRecentVerification } from './cache.js';
import { getRecentActivity } from './activity.js';

const test = createDevvitTest();

const ANCIENT_ACCOUNT = new Date('2010-01-01T00:00:00Z');
const OLD_COMMENT = new Date('2011-01-01T00:00:00Z');

type ModMailCapture = { subjects: string[]; bodies: string[] };

// Stub the Reddit calls the engine makes and capture modmail output.
function stubReddit(opts: {
  createdAt?: Date;
  notes?: string[];
  comments?: Array<{
    id: string;
    createdAt: Date;
    score: number;
    subredditName: string;
  }>;
  userThrows?: boolean;
}): ModMailCapture {
  const capture: ModMailCapture = { subjects: [], bodies: [] };

  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({
    name: 'testsub',
  } as never);

  if (opts.userThrows) {
    vi.spyOn(reddit, 'getUserByUsername').mockRejectedValue(new Error('boom'));
  } else {
    vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(
      (opts.createdAt ? { createdAt: opts.createdAt } : undefined) as never
    );
  }

  vi.spyOn(reddit, 'getModNotes').mockReturnValue({
    all: async () => (opts.notes ?? []).map((type) => ({ type })),
  } as never);

  vi.spyOn(reddit, 'getCommentsByUser').mockReturnValue({
    all: async () => opts.comments ?? [],
  } as never);

  vi.spyOn(reddit, 'approveUser').mockResolvedValue(undefined as never);

  vi.spyOn(reddit, 'modMail', 'get').mockReturnValue({
    createModDiscussionConversation: async (p: {
      subject: string;
      bodyMarkdown: string;
    }) => {
      capture.subjects.push(p.subject);
      capture.bodies.push(p.bodyMarkdown);
      return 'ModmailConversation_test';
    },
    reply: async (p: { body: string }) => {
      capture.bodies.push(p.body);
    },
  } as never);

  return capture;
}

// Drive a run to completion by invoking steps (the harness scheduler records
// jobs but does not run them). Extra calls after the run finishes are no-ops.
async function drive(runId: string, steps = 6): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await stepVerification(runId);
  }
}

test('PASS: approves, caches pass, and records activity', async () => {
  stubReddit({
    createdAt: ANCIENT_ACCOUNT,
    comments: [
      {
        id: 't1_1',
        createdAt: OLD_COMMENT,
        score: 5,
        subredditName: 'testsub',
      },
    ],
  });

  const runId = await startVerification('gooduser');
  await drive(runId);

  expect(reddit.approveUser).toHaveBeenCalledWith('gooduser', 'testsub');
  expect((await getRecentVerification('gooduser'))?.result).toBe('pass');
  const activity = await getRecentActivity(10);
  expect(
    activity.some((e) => e.username === 'gooduser' && e.status === 'pass')
  ).toBe(true);
});

test('FAIL with summary: no in-sub history, caches fail, includes the breakdown', async () => {
  const capture = stubReddit({
    createdAt: ANCIENT_ACCOUNT,
    comments: [
      {
        id: 't1_1',
        createdAt: OLD_COMMENT,
        score: 5,
        subredditName: 'somewhereelse',
      },
    ],
  });

  const runId = await startVerification('nohistory');
  await drive(runId);

  expect(reddit.approveUser).not.toHaveBeenCalled();
  expect((await getRecentVerification('nohistory'))?.result).toBe('fail');
  const report = capture.bodies.join('\n');
  expect(report).toMatch(/verification fail/);
  expect(report).toMatch(/Commented subreddits:/); // summary is included on failure
});

test('FAIL early (banned): simple report, no summary, caches fail', async () => {
  const capture = stubReddit({ createdAt: ANCIENT_ACCOUNT, notes: ['BAN'] });

  const runId = await startVerification('banneduser');
  await drive(runId);

  expect(reddit.approveUser).not.toHaveBeenCalled();
  expect((await getRecentVerification('banneduser'))?.result).toBe('fail');
  const report = capture.bodies.join('\n');
  expect(report).toMatch(/has 1 ban\(s\)/);
  expect(report).not.toMatch(/Commented subreddits:/); // no comments gathered
});

test('retry then hard-fail notifies moderators', async () => {
  const capture = stubReddit({ userThrows: true });

  const runId = await startVerification('flaky');
  // attempts 1 and 2 reschedule; the 3rd exhausts retries and hard-fails.
  await drive(runId, 3);

  expect(capture.subjects.some((s) => /Verification failed/.test(s))).toBe(
    true
  );
  const activity = await getRecentActivity(10);
  expect(
    activity.some((e) => e.username === 'flaky' && e.status === 'error')
  ).toBe(true);
});

test('watchdog abandons a stalled run and notifies', async () => {
  const capture = stubReddit({ createdAt: ANCIENT_ACCOUNT });
  const runId = await startVerification('staleuser');

  // Backdate the run so the watchdog treats it as stalled. Keys mirror run.ts.
  const runKey = `verification:run:${runId}`;
  const state = JSON.parse((await redis.get(runKey)) as string) as {
    updatedAtIso: string;
  };
  state.updatedAtIso = '2020-01-01T00:00:00.000Z';
  await redis.set(runKey, JSON.stringify(state));
  await redis.zAdd('verification:runs:active', {
    member: runId,
    score: Date.parse('2020-01-01T00:00:00.000Z'),
  });

  await runWatchdog();

  expect(capture.subjects.some((s) => /Verification failed/.test(s))).toBe(
    true
  );
  expect(await redis.get(runKey)).toBeUndefined(); // run state cleaned up
});
