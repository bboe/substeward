import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import {
  buildVerifyUserForm,
  handleVerifyCommentAuthor,
  handleVerifyPostAuthor,
} from '../features/verification/forms.js';
import {
  listActiveRedditors,
  listRedditorsWithAdminRemovedItems,
} from '../features/verification/analysis.js';
import { postRecentActivity } from '../features/verification/activity.js';

// Router for menu actions declared in devvit.json/menu.items.
export const menu = new Hono();

menu.post('/verify-user', async (c) => {
  // Subreddit-level action: open a form to type the username to verify.
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    {
      showForm: {
        name: 'verifyUser',
        form: buildVerifyUserForm(),
      },
    },
    200
  );
});

menu.post('/verify-comment-author', async (c) => {
  // Comment-level action: prepare verification of the comment's author.
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    await handleVerifyCommentAuthor(request.targetId),
    200
  );
});

menu.post('/verify-post-author', async (c) => {
  // Post-level action: prepare verification of the post's author.
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    await handleVerifyPostAuthor(request.targetId),
    200
  );
});

menu.post('/list-active-users', async (c) => {
  // Subreddit-level analysis: tally recently active commenters.
  await c.req.json<MenuItemRequest>();
  const message = await listActiveRedditors();
  return c.json<UiResponse>({ showToast: message }, 200);
});

menu.post('/list-admin-removed', async (c) => {
  // Subreddit-level analysis: tally users with admin/anti-evil removals.
  await c.req.json<MenuItemRequest>();
  const message = await listRedditorsWithAdminRemovedItems();
  return c.json<UiResponse>({ showToast: message }, 200);
});

menu.post('/view-activity', async (c) => {
  // Subreddit-level: post a snapshot of recent verification activity to modmail.
  await c.req.json<MenuItemRequest>();
  const message = await postRecentActivity();
  return c.json<UiResponse>({ showToast: message }, 200);
});
