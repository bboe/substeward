import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { getRecentVerification, recordVerification } from './cache.js';

const test = createDevvitTest();

test('records and reads a recent verification (case-insensitive key)', async () => {
  await recordVerification('Alice', 'pass');

  const record = await getRecentVerification('alice');
  expect(record?.result).toBe('pass');
  expect(typeof record?.at).toBe('string');
});

test('returns null when nothing was recorded', async () => {
  expect(await getRecentVerification('nobody')).toBeNull();
});

test('a later verification overwrites the earlier result', async () => {
  await recordVerification('bob', 'pass');
  await recordVerification('bob', 'fail');

  const record = await getRecentVerification('bob');
  expect(record?.result).toBe('fail');
});
