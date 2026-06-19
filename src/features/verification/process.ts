import { reddit } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';
import { describeAge, getRecentVerification } from './cache.js';
import { startVerification } from './run.js';
import { isApprovedContributor } from './verification.js';
import { isValidUsername, normalizeUsername } from './username.js';

// Outcome of preparing a verification, mapped to UI by the forms layer.
export type VerifyAction =
  // Background run was queued.
  | { kind: 'started'; message: string }
  // Nothing queued (invalid input, or already an approved contributor).
  | { kind: 'skipped'; message: string }
  // Recently verified — ask the moderator to confirm a re-verify.
  | { kind: 'confirm'; username: string; message: string };

// Apply pre-checks and either queue a verification or ask for confirmation.
// When `force` is true (the moderator confirmed a re-verify), pre-checks are
// skipped and the run is queued directly.
export async function prepareVerification(
  rawUsername: string,
  force: boolean
): Promise<VerifyAction> {
  const username = normalizeUsername(rawUsername);
  if (!isValidUsername(username)) {
    return { kind: 'skipped', message: 'Enter a single username (no spaces).' };
  }

  if (!force) {
    const subreddit = await reddit.getCurrentSubreddit();

    // Already-approved contributors are not re-verified.
    if (await isApprovedContributor(subreddit.name, username)) {
      return {
        kind: 'skipped',
        message: `u/${username} is already an approved contributor; skipping verification.`,
      };
    }

    // Recently verified — prompt before re-verifying.
    const recent = await getRecentVerification(username);
    if (recent) {
      return {
        kind: 'confirm',
        username,
        message: `u/${username} was already verified ${describeAge(recent.at, Date.now())} (result: ${recent.result.toUpperCase()}). Re-verify anyway?`,
      };
    }
  }

  await startVerification(username);
  return {
    kind: 'started',
    message: `Verification started for u/${username}. Check modmail for the result in a minute or so.`,
  };
}

// Devvit menu payloads may omit the fullname prefix; normalize before lookup.
function asT1(id: string): T1 {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as T1;
}

function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}

// Prepare verification for the author of a selected comment.
export async function prepareVerificationForComment(
  commentId: string
): Promise<VerifyAction> {
  const comment = await reddit.getCommentById(asT1(commentId));
  return prepareVerification(comment.authorName, false);
}

// Prepare verification for the author of a selected post.
export async function prepareVerificationForPost(
  postId: string
): Promise<VerifyAction> {
  const post = await reddit.getPostById(asT3(postId));
  return prepareVerification(post.authorName, false);
}
