import { reddit } from '@devvit/web/server';
import type {
  OnCommentCreateRequest,
  T1,
  T3,
  UiResponse,
} from '@devvit/web/shared';
import {
  isApprovedContributor,
  isModerator,
} from '../verification/verification.js';
import {
  applyContributorOnlyFlair,
  clearContributorOnlyFlair,
} from './flair.js';
import { isPostMarked, markPost, unmarkPost } from './store.js';
import { getContributorOnlySettings } from './settings.js';
import { isBotAccount, renderRemovalMessage } from './enforce.js';

// Devvit ids may arrive without the fullname prefix; normalize before use.
function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}
function asT1(id: string): T1 {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as T1;
}

// Post menu action: flag the post and apply the (uneditable) badge.
export async function handleMarkContributorOnly(
  targetId: string
): Promise<UiResponse> {
  const postId = asT3(targetId);
  const subreddit = await reddit.getCurrentSubreddit();
  await markPost(postId);
  await applyContributorOnlyFlair(subreddit.name, postId);
  return {
    showToast:
      'Marked contributor-only. Comments from non-contributors will be removed.',
  };
}

// Post menu action: clear the flag and remove the badge.
export async function handleUnmarkContributorOnly(
  targetId: string
): Promise<UiResponse> {
  const postId = asT3(targetId);
  const subreddit = await reddit.getCurrentSubreddit();
  await unmarkPost(postId);
  await clearContributorOnlyFlair(subreddit.name, postId);
  return { showToast: 'Removed the contributor-only restriction.' };
}

// CommentCreate trigger: on a flagged post, remove comments from anyone who is
// not exempt (moderator / approved contributor / the OP / a bot account), and
// modmail the author the configured reason. Unflagged posts short-circuit.
export async function handleCommentCreate(
  request: OnCommentCreateRequest
): Promise<void> {
  const comment = request.comment;
  const username = request.author?.name ?? comment?.author;
  if (!comment || !username) return;

  const postId = asT3(comment.postId);
  if (!(await isPostMarked(postId))) return;

  if (isBotAccount(username)) return;

  const subreddit = await reddit.getCurrentSubreddit();
  if (await isApprovedContributor(subreddit.name, username)) return;
  if (await isModerator(subreddit.name, username)) return;

  const post = await reddit.getPostById(postId);
  if (post.authorName.toLowerCase() === username.toLowerCase()) return;

  await reddit.remove(asT1(comment.id), false);
  console.log(
    `[contributor-only] removed comment ${comment.id} by u/${username} on ${postId}`
  );

  const config = await getContributorOnlySettings();
  const body = renderRemovalMessage(config.removalMessage, {
    title: post.title,
    author: username,
    subreddit: subreddit.name,
  });
  try {
    await reddit.modMail.createConversation({
      subredditName: subreddit.name,
      subject: 'Your comment was removed',
      body,
      to: username,
    });
  } catch (error) {
    console.error(`[contributor-only] failed to modmail u/${username}`, error);
  }
}
