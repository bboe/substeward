import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modmailPermalink } from './report.js';

void test('modmailPermalink builds a Mod Mail URL from the bare id', () => {
  assert.equal(
    modmailPermalink('ModmailConversation_abc123'),
    'https://www.reddit.com/mail/all/abc123'
  );
  assert.equal(
    modmailPermalink('abc123'),
    'https://www.reddit.com/mail/all/abc123'
  );
});
