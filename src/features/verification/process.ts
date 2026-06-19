import { reddit } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/web/shared';
import { startVerification } from './run.js';
import { isValidUsername, normalizeUsername } from './username.js';

// Queue a background verification for the given username and return the toast.
export async function enqueueVerification(
  rawUsername: string
): Promise<string> {
  const username = normalizeUsername(rawUsername);
  if (!isValidUsername(username)) {
    return 'Enter a single username (no spaces).';
  }
  await startVerification(username);
  return `Verification started for u/${username}. Check modmail for the result in a minute or so.`;
}

// Devvit menu payloads may omit the fullname prefix; normalize before lookup.
function asT1(id: string): T1 {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as T1;
}

function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}

// Queue a background verification for the author of a selected comment.
export async function enqueueVerificationForComment(
  commentId: string
): Promise<string> {
  const comment = await reddit.getCommentById(asT1(commentId));
  return enqueueVerification(comment.authorName);
}

// Queue a background verification for the author of a selected post.
export async function enqueueVerificationForPost(
  postId: string
): Promise<string> {
  const post = await reddit.getPostById(asT3(postId));
  return enqueueVerification(post.authorName);
}
