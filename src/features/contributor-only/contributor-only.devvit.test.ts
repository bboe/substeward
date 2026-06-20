import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { expect, vi } from 'vitest';
import { handleCommentCreate, handleMarkContributorOnly } from './actions.js';
import { isPostMarked, markPost } from './store.js';

const test = createDevvitTest();

type Capture = {
  removed: string[];
  modmail: Array<{ to?: string | null; body: string }>;
};

function stubReddit(opts: {
  approved?: string[];
  mods?: string[];
  postAuthor?: string;
  postTitle?: string;
}): Capture {
  const capture: Capture = { removed: [], modmail: [] };

  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({
    name: 'testsub',
  } as never);
  vi.spyOn(reddit, 'getApprovedUsers').mockReturnValue({
    all: async () => (opts.approved ?? []).map((username) => ({ username })),
  } as never);
  vi.spyOn(reddit, 'getModerators').mockReturnValue({
    all: async () => (opts.mods ?? []).map((username) => ({ username })),
  } as never);
  vi.spyOn(reddit, 'getPostById').mockResolvedValue({
    authorName: opts.postAuthor ?? 'op',
    title: opts.postTitle ?? 'A post',
  } as never);
  vi.spyOn(reddit, 'createPostFlairTemplate').mockResolvedValue({
    id: 'flair_1',
  } as never);
  vi.spyOn(reddit, 'setPostFlair').mockResolvedValue(undefined as never);
  vi.spyOn(reddit, 'removePostFlair').mockResolvedValue(undefined as never);
  vi.spyOn(reddit, 'remove').mockImplementation(async (id: unknown) => {
    capture.removed.push(String(id));
  });
  vi.spyOn(reddit, 'modMail', 'get').mockReturnValue({
    createConversation: async (p: { to?: string | null; body: string }) => {
      capture.modmail.push({ to: p.to, body: p.body });
    },
  } as never);

  return capture;
}

function comment(author: string, postId = 't3_p'): OnCommentCreateRequest {
  return {
    type: 'CommentCreate',
    comment: { id: 't1_c', postId, author },
    author: { name: author },
  } as unknown as OnCommentCreateRequest;
}

test('mark flags the post and applies a mod-only flair template', async () => {
  stubReddit({});
  await handleMarkContributorOnly('t3_p');

  expect(await isPostMarked('t3_p')).toBe(true);
  expect(reddit.createPostFlairTemplate).toHaveBeenCalledWith(
    expect.objectContaining({ subredditName: 'testsub', modOnly: true })
  );
  expect(reddit.setPostFlair).toHaveBeenCalledWith(
    expect.objectContaining({ postId: 't3_p', flairTemplateId: 'flair_1' })
  );
});

test('comment on an unmarked post is ignored', async () => {
  const capture = stubReddit({});
  await handleCommentCreate(comment('bob', 't3_unmarked'));
  expect(capture.removed).toHaveLength(0);
});

test('non-contributor comment on a marked post is removed and modmailed', async () => {
  const capture = stubReddit({ postAuthor: 'op' });
  await markPost('t3_p');

  await handleCommentCreate(comment('bob'));

  expect(capture.removed).toContain('t1_c');
  expect(capture.modmail).toHaveLength(1);
  expect(capture.modmail[0]?.to).toBe('bob');
});

test('approved contributor comment on a marked post is kept', async () => {
  const capture = stubReddit({ approved: ['carol'], postAuthor: 'op' });
  await markPost('t3_p');

  await handleCommentCreate(comment('carol'));

  expect(capture.removed).toHaveLength(0);
  expect(capture.modmail).toHaveLength(0);
});

test('the OP can comment on their own contributor-only post', async () => {
  const capture = stubReddit({ postAuthor: 'op' });
  await markPost('t3_p');

  await handleCommentCreate(comment('op'));

  expect(capture.removed).toHaveLength(0);
});
