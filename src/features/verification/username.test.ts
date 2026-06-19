import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidUsername, normalizeUsername } from './username.js';

void test('normalizeUsername strips u/ and /u/ prefixes and trims', () => {
  assert.equal(normalizeUsername('  spez  '), 'spez');
  assert.equal(normalizeUsername('u/spez'), 'spez');
  assert.equal(normalizeUsername('/u/spez'), 'spez');
  assert.equal(normalizeUsername('U/Spez'), 'Spez');
});

void test('isValidUsername rejects empty or multi-token input', () => {
  assert.equal(isValidUsername('spez'), true);
  assert.equal(isValidUsername(''), false);
  assert.equal(isValidUsername('two names'), false);
});
