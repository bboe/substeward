import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modmailPermalink } from './report.js';

void test('modmailPermalink builds a Mod Mail perma URL', () => {
  assert.equal(
    modmailPermalink('ModmailConversation_abc123'),
    'https://mod.reddit.com/mail/perma/ModmailConversation_abc123'
  );
});
