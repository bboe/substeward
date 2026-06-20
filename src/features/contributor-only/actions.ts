import { reddit } from '@devvit/web/server';
import type {
  OnCommentCreateRequest,
  T1,
  T3,
  UiResponse,
} from '@devvit/web/shared';
import { isApprovedContributor } from '../verification/reddit.js';
import {
  applyContributorOnlyFlair,
  clearContributorOnlyFlair,
} from './flair.js';
import {
  getDesignatedFlairTemplateId,
  setDesignatedFlairTemplateId,
} from './store.js';
import { getContributorOnlySettings } from './settings.js';
import { isBotAccount, renderRemovalMessage } from './enforce.js';

// Devvit ids may arrive without the fullname prefix; normalize before use.
function asT3(id: string): T3 {
  return (id.startsWith('t3_') ? id : `t3_${id}`) as T3;
}
function asT1(id: string): T1 {
  return (id.startsWith('t1_') ? id : `t1_${id}`) as T1;
}

// Post menu action: toggle the contributor-only restriction. The post's flair
// is the marker — so this applies the designated mod-only template (creating it
// on first use) or removes it. Devvit menu items can't be shown conditionally,
// so a single action flips the state.
export async function handleToggleContributorOnly(
  targetId: string
): Promise<UiResponse> {
  const postId = asT3(targetId);
  try {
    const subreddit = await reddit.getCurrentSubreddit();
    const designated = await getDesignatedFlairTemplateId();
    const post = await reddit.getPostById(postId);
    const isMarked =
      designated !== undefined && post.flair?.templateId === designated;
    if (isMarked) {
      await clearContributorOnlyFlair(subreddit.name, postId);
      return { showToast: 'Removed the contributor-only restriction.' };
    }
    await applyContributorOnlyFlair(subreddit.name, postId);
    return {
      showToast:
        'Marked contributor-only. Non-contributor comments will be removed.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[contributor-only] toggle failed for ${postId}`, error);
    return { showToast: `Action failed: ${message}` };
  }
}

// Subreddit menu action: adopt an existing post-flair template as the
// contributor-only marker (for subreddits transitioning from an AutoModerator
// flair rule). Posts already wearing that flair are enforced immediately.
export async function handleImportFlairMenu(): Promise<UiResponse> {
  const subreddit = await reddit.getCurrentSubreddit();
  const templates = await reddit.getPostFlairTemplates(subreddit.name);
  if (templates.length === 0) {
    return {
      showToast:
        'No post flair templates exist yet. Use “Toggle contributor-only” to create one.',
    };
  }
  return {
    showForm: {
      name: 'importContributorOnlyFlair',
      form: {
        fields: [
          {
            name: 'flairTemplateId',
            label: 'Existing post flair template',
            type: 'select',
            options: templates.map((t) => ({
              label: t.text.trim() === '' ? '<emoji only>' : t.text,
              value: t.id,
            })),
            helpText:
              'Posts wearing this flair will be treated as contributor-only.',
            required: true,
          },
        ],
        title: 'Import contributor-only flair',
        acceptLabel: 'Import',
        cancelLabel: 'Cancel',
      },
    },
  };
}

export type ImportFlairFormValues = { flairTemplateId?: string[] };

export async function handleImportFlairSubmit(
  values: ImportFlairFormValues
): Promise<UiResponse> {
  const id = values.flairTemplateId?.[0];
  if (!id) return { showToast: 'Please choose a flair template.' };

  // Force the imported template to mod-only so the flair-as-marker model stays
  // bypass-safe regardless of the subreddit's flair-permission settings.
  const subreddit = await reddit.getCurrentSubreddit();
  const templates = await reddit.getPostFlairTemplates(subreddit.name);
  const template = templates.find((t) => t.id === id);
  if (!template) return { showToast: 'That flair template no longer exists.' };
  await template.edit({ modOnly: true });

  await setDesignatedFlairTemplateId(id);
  return {
    showToast:
      'Imported (set to mod-only). Posts with this flair are now contributor-only; remove the flair to lift it.',
  };
}

// CommentCreate trigger: enforce contributor-only based on the post's flair.
// The post's flair template id is in the trigger payload, so posts that don't
// wear the designated template short-circuit with no API calls. A comment is
// removed unless its author is exempt (approved contributor / a bot / optionally
// the OP). Moderators are NOT exempt — they must be approved contributors. The
// OP exemption is controlled by the `contributorOnlyExemptOp` setting.
export async function handleCommentCreate(
  request: OnCommentCreateRequest
): Promise<void> {
  const comment = request.comment;
  const username = request.author?.name ?? comment?.author;
  if (!comment || !username) return;

  const flairTemplateId = request.post?.linkFlair?.templateId;
  if (!flairTemplateId) return;
  const designated = await getDesignatedFlairTemplateId();
  if (designated === undefined || flairTemplateId !== designated) return;

  if (isBotAccount(username)) return;

  const subredditName =
    request.subreddit?.name ?? (await reddit.getCurrentSubreddit()).name;
  if (await isApprovedContributor(subredditName, username)) return;

  const config = await getContributorOnlySettings();
  const authorId = request.author?.id;
  const postAuthorId = request.post?.authorId;
  if (
    config.exemptOp &&
    authorId &&
    postAuthorId &&
    authorId === postAuthorId
  ) {
    return;
  }

  await reddit.remove(asT1(comment.id), false);
  console.log(
    `[contributor-only] removed comment ${comment.id} by u/${username}`
  );

  const body = renderRemovalMessage(config.removalMessage, {
    title: request.post?.title ?? '',
    author: username,
    subreddit: subredditName,
  });
  try {
    await reddit.modMail.createConversation({
      subredditName,
      subject: 'Your comment was removed',
      body,
      to: username,
    });
  } catch (error) {
    console.error(`[contributor-only] failed to modmail u/${username}`, error);
  }
}
