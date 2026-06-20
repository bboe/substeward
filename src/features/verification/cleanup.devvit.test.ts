import { createDevvitTest } from '@devvit/test/server/vitest';
import { redis } from '@devvit/web/server';
import { expect } from 'vitest';
import { cleanupLegacyData } from './cleanup.js';
import { REPORT_CONVERSATION_KEY, STATIC_KEYS } from './keys.js';

const test = createDevvitTest();

test('cleanupLegacyData removes the obsolete analysis thread key', async () => {
  await redis.set('analysis:reportConversationId', 'ModmailConversation_old');

  await cleanupLegacyData();

  expect(await redis.get('analysis:reportConversationId')).toBeUndefined();
});

test('cleanupLegacyData records the current static-key index', async () => {
  await cleanupLegacyData();

  const indexed = JSON.parse((await redis.get('index:staticKeys')) ?? '[]');
  expect(indexed).toEqual([...STATIC_KEYS]);
});

test('cleanupLegacyData deletes previously-indexed keys no longer in use', async () => {
  // Simulate a prior version that used an extra static key.
  await redis.set('verification:obsoleteThing', 'x');
  await redis.set(REPORT_CONVERSATION_KEY, 'keep-me');
  await redis.set(
    'index:staticKeys',
    JSON.stringify([...STATIC_KEYS, 'verification:obsoleteThing'])
  );

  await cleanupLegacyData();

  // The obsolete key is gone; a current static key is preserved.
  expect(await redis.get('verification:obsoleteThing')).toBeUndefined();
  expect(await redis.get(REPORT_CONVERSATION_KEY)).toBe('keep-me');
});

test('cleanupLegacyData is safe when nothing is stored', async () => {
  await expect(cleanupLegacyData()).resolves.toBeUndefined();
});
