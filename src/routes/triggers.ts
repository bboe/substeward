import { Hono } from 'hono';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { handleCommentCreate } from '../features/contributor-only/actions.js';

// Router for event triggers declared in devvit.json/triggers.
export const triggers = new Hono();

triggers.post('/comment-create', async (c) => {
  // Enforce contributor-only restrictions on new comments.
  const request = await c.req.json<OnCommentCreateRequest>();
  await handleCommentCreate(request);
  return c.json({}, 200);
});
