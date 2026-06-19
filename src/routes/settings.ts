import { Hono } from 'hono';
import type {
  SettingsValidationRequest,
  SettingsValidationResponse,
} from '@devvit/web/shared';
import {
  validateMinKarmaAverage,
  validateOldestCommentDays,
  validateSubredditsToShow,
} from '../features/verification/settings.js';

// Router for optional server-side settings validation endpoints.
// Validation endpoints are referenced from devvit.json setting definitions.
export const settingsRoutes = new Hono();

settingsRoutes.post('/validate-oldest-comment-days', async (c) => {
  const request = await c.req.json<SettingsValidationRequest<number>>();
  return c.json<SettingsValidationResponse>(
    validateOldestCommentDays(request),
    200
  );
});

settingsRoutes.post('/validate-min-karma-average', async (c) => {
  const request = await c.req.json<SettingsValidationRequest<number>>();
  return c.json<SettingsValidationResponse>(
    validateMinKarmaAverage(request),
    200
  );
});

settingsRoutes.post('/validate-subreddits-to-show', async (c) => {
  const request = await c.req.json<SettingsValidationRequest<number>>();
  return c.json<SettingsValidationResponse>(
    validateSubredditsToShow(request),
    200
  );
});
