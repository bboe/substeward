import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import {
  handleVerifyUserSubmit,
  type VerifyUserFormValues,
} from '../features/verification/forms.js';

// Router for form submit endpoints declared in devvit.json/forms.
export const forms = new Hono();

forms.post('/verify-user-submit', async (c) => {
  // Parse submitted username and run verification.
  const values = await c.req.json<VerifyUserFormValues>();
  const response = await handleVerifyUserSubmit(values);

  // Return UI response consumed by Reddit client.
  return c.json<UiResponse>(response, 200);
});
