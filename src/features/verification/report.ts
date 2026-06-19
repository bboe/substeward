import { context, reddit, redis } from '@devvit/web/server';

// Redis key holding the auto-created modmail conversation id used for reports
// when no conversation id is configured in settings. The settings client is
// read-only at runtime, so we persist the conversation here instead.
const REPORT_CONVERSATION_REDIS_KEY = 'verification:reportConversationId';

// Build a permalink to a modmail conversation (Mod Discussions threads included).
export function modmailPermalink(conversationId: string): string {
  return `https://mod.reddit.com/mail/perma/${conversationId}`;
}

// Return the auto-created report conversation id stored in Redis, or undefined
// when no report thread has been created yet.
export async function getExistingReportConversationId(): Promise<
  string | undefined
> {
  return (await redis.get(REPORT_CONVERSATION_REDIS_KEY)) ?? undefined;
}

// Post a verification report into modmail as an internal moderator note.
//
// Delivery target:
//   1. The Mod Discussions thread we previously auto-created (id in Redis).
//   2. Otherwise, create a new one and remember it, so the first report
//      populates the destination for all future reports.
export async function deliverReport(report: string): Promise<void> {
  const stored = await redis.get(REPORT_CONVERSATION_REDIS_KEY);
  if (stored) {
    try {
      console.log(
        `[verification] delivering report to stored conversation ${stored}`
      );
      await reddit.modMail.reply({
        conversationId: stored,
        body: report,
        isInternal: true,
      });
      return;
    } catch (error) {
      // The stored conversation may have been deleted/archived; fall through
      // and create a fresh one rather than dropping the report.
      console.error(
        '[verification] stored report conversation is unusable; creating a new one.',
        error
      );
    }
  }

  const conversationId = await reddit.modMail.createModDiscussionConversation({
    subject: 'User verification reports',
    bodyMarkdown: report,
    subredditId: context.subredditId,
  });
  await redis.set(REPORT_CONVERSATION_REDIS_KEY, conversationId);
  console.log(
    `[verification] created report conversation ${conversationId} (${modmailPermalink(conversationId)})`
  );
}

// Open a fresh Mod Discussions conversation to alert moderators (used for hard
// failures so they aren't left waiting on a result that will never arrive).
export async function notifyModerators(
  subject: string,
  bodyMarkdown: string
): Promise<void> {
  await reddit.modMail.createModDiscussionConversation({
    subject,
    bodyMarkdown,
    subredditId: context.subredditId,
  });
}
