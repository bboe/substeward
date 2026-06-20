import { redis } from '@devvit/web/server';

// Redis state for the contributor-only feature: which posts are flagged, plus
// the id of the auto-created mod-only flair template used as the visible badge.
//
// The flag is the source of truth for enforcement; the flair is only a badge.

const POST_KEY_PREFIX = 'contributoronly:post:';
const FLAIR_TEMPLATE_KEY = 'contributoronly:flairTemplateId';

export async function markPost(postId: string): Promise<void> {
  await redis.set(`${POST_KEY_PREFIX}${postId}`, '1');
}

export async function unmarkPost(postId: string): Promise<void> {
  await redis.del(`${POST_KEY_PREFIX}${postId}`);
}

// True when the post is flagged contributor-only. Cheap single-key lookup so the
// CommentCreate trigger can short-circuit on the common (unflagged) case.
export async function isPostMarked(postId: string): Promise<boolean> {
  return (await redis.get(`${POST_KEY_PREFIX}${postId}`)) != null;
}

export async function getCachedFlairTemplateId(): Promise<string | undefined> {
  return (await redis.get(FLAIR_TEMPLATE_KEY)) ?? undefined;
}

export async function setCachedFlairTemplateId(id: string): Promise<void> {
  await redis.set(FLAIR_TEMPLATE_KEY, id);
}

export async function clearCachedFlairTemplateId(): Promise<void> {
  await redis.del(FLAIR_TEMPLATE_KEY);
}
