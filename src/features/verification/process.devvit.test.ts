import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, scheduler } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import { prepareVerification } from './process.js';
import { recordVerification } from './cache.js';

const test = createDevvitTest();

// Minimal Reddit stubs: prepareVerification only reads the subreddit name and
// the approved-users listing.
function stubSubreddit(): void {
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({
    name: 'testsub',
  } as never);
}
function stubApproved(usernames: string[]): void {
  vi.spyOn(reddit, 'getApprovedUsers').mockReturnValue({
    all: async () => usernames.map((username) => ({ username })),
  } as never);
}

test('skips an already-approved contributor', async () => {
  stubSubreddit();
  stubApproved(['alice']);

  const action = await prepareVerification('alice', false);
  expect(action.kind).toBe('skipped');
  expect(action.message).toMatch(/already an approved contributor/);
});

test('prompts to confirm when the user was verified recently', async () => {
  stubSubreddit();
  stubApproved([]);
  await recordVerification('alice', 'pass');

  const action = await prepareVerification('alice', false);
  expect(action.kind).toBe('confirm');
  if (action.kind === 'confirm') {
    expect(action.username).toBe('alice');
    expect(action.message).toMatch(/Re-verify anyway/);
  }
});

test('starts a run for a clean user and queues a job', async () => {
  stubSubreddit();
  stubApproved([]);

  const action = await prepareVerification('newuser', false);
  expect(action.kind).toBe('started');

  const jobs = await scheduler.listJobs();
  expect(jobs.some((job) => job.name === 'verifyUser')).toBe(true);
});

test('force bypasses pre-checks even for an approved user', async () => {
  stubApproved(['alice']);

  const action = await prepareVerification('alice', true);
  expect(action.kind).toBe('started');
});

test('rejects an invalid username before any lookup', async () => {
  const action = await prepareVerification('two words', false);
  expect(action.kind).toBe('skipped');
  expect(action.message).toMatch(/single username/);
});
