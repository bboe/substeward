import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import {
  clearCachedFlairTemplateId,
  getCachedFlairTemplateId,
  setCachedFlairTemplateId,
} from './store.js';
import { getContributorOnlySettings } from './settings.js';

// Create (once) the mod-only post-flair template used as the contributor-only
// badge and cache its id. `modOnly: true` is what makes the badge uneditable by
// the OP / regular users — only moderators can change it (a platform rule).
async function createFlairTemplate(subredditName: string): Promise<string> {
  const config = await getContributorOnlySettings();
  const template = await reddit.createPostFlairTemplate({
    subredditName,
    text: config.flairText,
    textColor: config.flairTextColor,
    backgroundColor: config.flairBackgroundColor,
    modOnly: true,
  });
  await setCachedFlairTemplateId(template.id);
  return template.id;
}

// Apply the contributor-only badge, creating the template on first use. If the
// cached template was deleted on the subreddit, recreate it once and retry.
export async function applyContributorOnlyFlair(
  subredditName: string,
  postId: T3
): Promise<void> {
  const cached = await getCachedFlairTemplateId();
  const templateId = cached ?? (await createFlairTemplate(subredditName));
  try {
    await reddit.setPostFlair({
      subredditName,
      postId,
      flairTemplateId: templateId,
    });
  } catch (error) {
    console.error(
      '[contributor-only] flair template unusable; recreating.',
      error
    );
    await clearCachedFlairTemplateId();
    const fresh = await createFlairTemplate(subredditName);
    await reddit.setPostFlair({
      subredditName,
      postId,
      flairTemplateId: fresh,
    });
  }
}

export async function clearContributorOnlyFlair(
  subredditName: string,
  postId: T3
): Promise<void> {
  await reddit.removePostFlair(subredditName, postId);
}
