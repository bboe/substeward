import { reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import {
  clearDesignatedFlairTemplateId,
  getDesignatedFlairTemplateId,
  setDesignatedFlairTemplateId,
} from './store.js';

// Initial label for the badge. Appearance (text and colors) is intentionally
// not exposed as settings — moderators customize the template directly in the
// subreddit's post flair settings after it is first created.
const DEFAULT_FLAIR_TEXT = 'Contributors only';

// Create the mod-only post-flair template that designates contributor-only
// posts and remember its id. `modOnly: true` makes the badge uneditable by the
// OP / regular users — only moderators can add or remove it (a platform rule),
// which is what keeps the flair-as-marker model bypass-safe.
async function createDesignatedTemplate(
  subredditName: string
): Promise<string> {
  const template = await reddit.createPostFlairTemplate({
    subredditName,
    text: DEFAULT_FLAIR_TEXT,
    modOnly: true,
  });
  await setDesignatedFlairTemplateId(template.id);
  return template.id;
}

// Apply the contributor-only badge, creating the designated template on first
// use. If the remembered template was deleted on the subreddit, recreate it.
export async function applyContributorOnlyFlair(
  subredditName: string,
  postId: T3
): Promise<void> {
  const designated = await getDesignatedFlairTemplateId();
  const templateId =
    designated ?? (await createDesignatedTemplate(subredditName));
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
    await clearDesignatedFlairTemplateId();
    const fresh = await createDesignatedTemplate(subredditName);
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
