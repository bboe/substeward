import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit, settings } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { expect, vi } from 'vitest';
import {
  handleCommentCreate,
  handleImportFlairMenu,
  handleImportFlairSubmit,
  handleToggleContributorOnly,
} from './actions.js';
import {
  getDesignatedFlairTemplateId,
  setDesignatedFlairTemplateId,
} from './store.js';

const test = createDevvitTest();

const DESIGNATED = 'tmpl_co';

type Capture = {
  removed: string[];
  modmail: Array<{ to?: string | null; body: string }>;
};

function stubReddit(
  opts: {
    approved?: string[];
    postFlairTemplateId?: string;
  } = {}
): Capture {
  const capture: Capture = { removed: [], modmail: [] };

  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({
    name: 'testsub',
  } as never);
  vi.spyOn(reddit, 'getApprovedUsers').mockReturnValue({
    all: async () => (opts.approved ?? []).map((username) => ({ username })),
  } as never);
  vi.spyOn(reddit, 'getPostById').mockResolvedValue({
    title: 'A post',
    flair: opts.postFlairTemplateId
      ? { templateId: opts.postFlairTemplateId }
      : undefined,
  } as never);
  vi.spyOn(reddit, 'createPostFlairTemplate').mockResolvedValue({
    id: DESIGNATED,
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

// Build a CommentCreate payload. linkFlair.templateId drives enforcement; the
// author/post ids drive the OP check.
function comment(opts: {
  author: string;
  authorId?: string;
  postAuthorId?: string;
  flairTemplateId?: string;
}): OnCommentCreateRequest {
  return {
    type: 'CommentCreate',
    comment: { id: 't1_c', postId: 't3_p', author: opts.author },
    author: { name: opts.author, id: opts.authorId ?? 't2_author' },
    post: {
      id: 't3_p',
      title: 'A post',
      authorId: opts.postAuthorId ?? 't2_op',
      linkFlair: opts.flairTemplateId
        ? { templateId: opts.flairTemplateId }
        : undefined,
    },
    subreddit: { name: 'testsub' },
  } as unknown as OnCommentCreateRequest;
}

test('toggle on a post without the flair applies it and designates the template', async () => {
  stubReddit({ postFlairTemplateId: undefined });
  await handleToggleContributorOnly('t3_p');

  expect(reddit.createPostFlairTemplate).toHaveBeenCalledWith(
    expect.objectContaining({ subredditName: 'testsub', modOnly: true })
  );
  expect(reddit.setPostFlair).toHaveBeenCalledWith(
    expect.objectContaining({ postId: 't3_p', flairTemplateId: DESIGNATED })
  );
  expect(await getDesignatedFlairTemplateId()).toBe(DESIGNATED);
});

test('toggle on a post already wearing the designated flair removes it', async () => {
  stubReddit({ postFlairTemplateId: DESIGNATED });
  await setDesignatedFlairTemplateId(DESIGNATED);
  await handleToggleContributorOnly('t3_p');

  expect(reddit.removePostFlair).toHaveBeenCalled();
});

test('comment on a post without the designated flair is ignored', async () => {
  const capture = stubReddit();
  await setDesignatedFlairTemplateId(DESIGNATED);
  await handleCommentCreate(
    comment({ author: 'bob', flairTemplateId: 'other' })
  );
  expect(capture.removed).toHaveLength(0);
});

test('non-contributor comment on a contributor-only post is removed and modmailed', async () => {
  const capture = stubReddit();
  await setDesignatedFlairTemplateId(DESIGNATED);

  await handleCommentCreate(
    comment({ author: 'bob', flairTemplateId: DESIGNATED })
  );

  expect(capture.removed).toContain('t1_c');
  expect(capture.modmail).toHaveLength(1);
  expect(capture.modmail[0]?.to).toBe('bob');
});

test('approved contributor comment is kept', async () => {
  const capture = stubReddit({ approved: ['carol'] });
  await setDesignatedFlairTemplateId(DESIGNATED);

  await handleCommentCreate(
    comment({ author: 'carol', flairTemplateId: DESIGNATED })
  );

  expect(capture.removed).toHaveLength(0);
  expect(capture.modmail).toHaveLength(0);
});

test('a moderator is not exempt — must be an approved contributor', async () => {
  const capture = stubReddit({ approved: [] });
  await setDesignatedFlairTemplateId(DESIGNATED);

  await handleCommentCreate(
    comment({ author: 'moduser', flairTemplateId: DESIGNATED })
  );

  expect(capture.removed).toContain('t1_c');
});

test('the OP is exempt by default', async () => {
  const capture = stubReddit();
  await setDesignatedFlairTemplateId(DESIGNATED);

  await handleCommentCreate(
    comment({
      author: 'op',
      authorId: 't2_op',
      postAuthorId: 't2_op',
      flairTemplateId: DESIGNATED,
    })
  );

  expect(capture.removed).toHaveLength(0);
});

test('with the OP exemption disabled, the OP is removed', async () => {
  const capture = stubReddit();
  await setDesignatedFlairTemplateId(DESIGNATED);
  vi.spyOn(settings, 'get').mockImplementation((async (key: string) =>
    key === 'contributorOnlyExemptOp' ? false : undefined) as never);

  await handleCommentCreate(
    comment({
      author: 'op',
      authorId: 't2_op',
      postAuthorId: 't2_op',
      flairTemplateId: DESIGNATED,
    })
  );

  expect(capture.removed).toContain('t1_c');
});

test('import menu lists templates and labels emoji-only ones', async () => {
  stubReddit();
  vi.spyOn(reddit, 'getPostFlairTemplates').mockResolvedValue([
    { id: 'a', text: '' },
    { id: 'b', text: 'Contributor' },
  ] as never);

  const response = await handleImportFlairMenu();
  const field = response.showForm?.form.fields[0] as {
    options: Array<{ label: string; value: string }>;
  };

  expect(field.options).toEqual([
    { label: '<emoji only>', value: 'a' },
    { label: 'Contributor', value: 'b' },
  ]);
});

test('import forces the chosen template to mod-only and designates it', async () => {
  stubReddit();
  const edits: Array<{ modOnly?: boolean }> = [];
  vi.spyOn(reddit, 'getPostFlairTemplates').mockResolvedValue([
    {
      id: 'tmpl_existing',
      text: 'Contributor',
      edit: async (o: { modOnly?: boolean }) => {
        edits.push(o);
      },
    },
  ] as never);

  const response = await handleImportFlairSubmit({
    flairTemplateId: ['tmpl_existing'],
  });

  expect(edits).toContainEqual({ modOnly: true });
  expect(await getDesignatedFlairTemplateId()).toBe('tmpl_existing');
  expect(response.showToast).toMatch(/mod-only/i);
});
