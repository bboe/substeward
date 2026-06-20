import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import {
  handleVerifyUserConfirmSubmit,
  handleVerifyUserSubmit,
  type VerifyUserFormValues,
} from '../features/verification/forms.js';
import {
  handleImportFlairSubmit,
  type ImportFlairFormValues,
} from '../features/contributor-only/actions.js';

// Router for form submit endpoints declared in devvit.json/forms.
export const forms = new Hono();

forms.post('/verify-user-submit', async (c) => {
  // Parse submitted username and run pre-checks (may prompt to confirm).
  const values = await c.req.json<VerifyUserFormValues>();
  const response = await handleVerifyUserSubmit(values);

  // Return UI response consumed by Reddit client.
  return c.json<UiResponse>(response, 200);
});

forms.post('/verify-user-confirm-submit', async (c) => {
  // Moderator confirmed a re-verify; force the verification.
  const values = await c.req.json<VerifyUserFormValues>();
  const response = await handleVerifyUserConfirmSubmit(values);

  return c.json<UiResponse>(response, 200);
});

forms.post('/import-flair-submit', async (c) => {
  // Designate the selected post-flair template as the contributor-only marker.
  const values = await c.req.json<ImportFlairFormValues>();
  return c.json<UiResponse>(await handleImportFlairSubmit(values), 200);
});
