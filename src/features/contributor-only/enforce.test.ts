import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isBotAccount, renderRemovalMessage } from './enforce.js';

void test('isBotAccount matches known bots case-insensitively', () => {
  assert.equal(isBotAccount('AutoModerator'), true);
  assert.equal(isBotAccount('automoderator'), true);
  assert.equal(isBotAccount('reddit'), true);
  assert.equal(isBotAccount('alice'), false);
});

void test('renderRemovalMessage fills all placeholders', () => {
  const out = renderRemovalMessage(
    'r/{subreddit}: "{title}" — sorry u/{author}',
    { title: 'Hello', author: 'bob', subreddit: 'testsub' }
  );
  assert.equal(out, 'r/testsub: "Hello" — sorry u/bob');
});

void test('renderRemovalMessage repeats and leaves unknown placeholders', () => {
  const out = renderRemovalMessage('{author} {author} {nope}', {
    title: '',
    author: 'bob',
    subreddit: '',
  });
  assert.equal(out, 'bob bob {nope}');
});
