import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { cleanupLegacyData } from './cleanup.js';

const test = createDevvitTest();

test('cleanupLegacyData removes the obsolete analysis thread key', async () => {
  await redis.set('analysis:reportConversationId', 'ModmailConversation_old');

  await cleanupLegacyData();

  expect(await redis.get('analysis:reportConversationId')).toBeUndefined();
});

test('cleanupLegacyData is safe when nothing is stored', async () => {
  await expect(cleanupLegacyData()).resolves.toBeUndefined();
});
