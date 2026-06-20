import { redis } from '@devvit/web/server';

// The only persisted state for contributor-only: which post-flair template
// designates a post as contributor-only. The post's flair is the marker, so
// there is no per-post state — but the chosen template id must live somewhere,
// and Devvit settings are read-only at runtime, so it goes in Redis.
const FLAIR_TEMPLATE_KEY = 'contributoronly:flairTemplateId';

export async function getDesignatedFlairTemplateId(): Promise<
  string | undefined
> {
  return (await redis.get(FLAIR_TEMPLATE_KEY)) ?? undefined;
}

export async function setDesignatedFlairTemplateId(id: string): Promise<void> {
  await redis.set(FLAIR_TEMPLATE_KEY, id);
}

export async function clearDesignatedFlairTemplateId(): Promise<void> {
  await redis.del(FLAIR_TEMPLATE_KEY);
}
