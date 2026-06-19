import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidTimezone,
  validateMinKarmaAverage,
  validateOldestCommentDays,
  validateSubredditsToShow,
} from './settings.js';

// Build a settings validation request with the required isEditing flag.
function req<T>(value: T | undefined): {
  value: T | undefined;
  isEditing: boolean;
} {
  return { value, isEditing: false };
}

void test('isValidTimezone accepts IANA ids and rejects junk', () => {
  assert.equal(isValidTimezone('America/Los_Angeles'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
});

void test('oldest comment days allows 0 (disabled) but rejects negatives/decimals', () => {
  assert.equal(validateOldestCommentDays(req(182)).success, true);
  // 0 means "no age requirement" and is allowed.
  assert.equal(validateOldestCommentDays(req(0)).success, true);
  assert.equal(validateOldestCommentDays(req(-5)).success, false);
  assert.equal(validateOldestCommentDays(req(1.5)).success, false);
  // Empty falls back to default at runtime, so it validates.
  assert.equal(validateOldestCommentDays(req<number>(undefined)).success, true);
});

void test('subreddits-to-show is capped at 50', () => {
  assert.equal(validateSubredditsToShow(req(50)).success, true);
  assert.equal(validateSubredditsToShow(req(51)).success, false);
});

void test('min karma average allows any finite number', () => {
  assert.equal(validateMinKarmaAverage(req(1)).success, true);
  assert.equal(validateMinKarmaAverage(req(0)).success, true);
  assert.equal(validateMinKarmaAverage(req(-2.5)).success, true);
});
