import { Hono } from 'hono';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { handleCommentCreate } from '../features/contributor-only/actions.js';
import { cleanupLegacyData } from '../features/verification/cleanup.js';

// Router for event triggers declared in devvit.json/triggers.
export const triggers = new Hono();

triggers.post('/comment-create', async (c) => {
  // Enforce contributor-only restrictions on new comments.
  const request = await c.req.json<OnCommentCreateRequest>();
  await handleCommentCreate(request);
  return c.json({}, 200);
});

triggers.post('/app-upgrade', async (c) => {
  // Run one-time data migrations/cleanup when a new version is installed.
  await c.req.json();
  await cleanupLegacyData();
  return c.json({}, 200);
});
