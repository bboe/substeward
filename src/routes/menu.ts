import { Hono } from 'hono';
import type { MenuItemRequest, UiResponse } from '@devvit/web/shared';
import {
  buildVerifyUserForm,
  handleVerifyCommentAuthor,
  handleVerifyPostAuthor,
} from '../features/verification/forms.js';
import { queueAnalysisReport } from '../features/verification/analysis-run.js';
import { cancelBackgroundReports } from '../features/verification/cancel.js';
import { postRecentActivity } from '../features/verification/activity.js';
import {
  handleImportFlairMenu,
  handleToggleContributorOnly,
} from '../features/contributor-only/actions.js';

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
  // Subreddit-level analysis: queue the recently-active-commenters tally.
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    { showToast: await queueAnalysisReport('active-users') },
    200
  );
});

menu.post('/list-admin-removed', async (c) => {
  // Subreddit-level analysis: queue the admin/anti-evil removals tally.
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    { showToast: await queueAnalysisReport('admin-removed') },
    200
  );
});

menu.post('/cancel-reports', async (c) => {
  // Subreddit-level: cancel all pending verification/analysis step jobs — a
  // kill switch for runs that are stuck or rescheduling.
  await c.req.json<MenuItemRequest>();
  const cancelled = await cancelBackgroundReports();
  const message =
    cancelled === 0
      ? 'No running reports to cancel.'
      : `Cancelled ${cancelled} running report job${cancelled === 1 ? '' : 's'}.`;
  return c.json<UiResponse>({ showToast: message }, 200);
});

menu.post('/view-activity', async (c) => {
  // Subreddit-level: post a snapshot of recent verification activity to modmail.
  await c.req.json<MenuItemRequest>();
  const message = await postRecentActivity();
  return c.json<UiResponse>({ showToast: message }, 200);
});

menu.post('/toggle-contributor-only', async (c) => {
  // Post-level action: toggle the contributor-only restriction on this post.
  const request = await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(
    await handleToggleContributorOnly(request.targetId),
    200
  );
});

menu.post('/import-contributor-only-flair', async (c) => {
  // Subreddit-level action: adopt an existing post-flair template as the marker.
  await c.req.json<MenuItemRequest>();
  return c.json<UiResponse>(await handleImportFlairMenu(), 200);
});
