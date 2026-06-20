import { context, reddit, redis } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { describeError } from './chunked-run.js';

export type AnalysisKind = 'active-users' | 'admin-removed';

// Moderator display names Reddit uses for admin/anti-evil removals.
const ANTI_EVIL_MOD = 'Anti-Evil Operations';
const ADMIN_MOD = 'reddit';
const REMOVAL_TYPES = new Set(['removecomment', 'removelink']);

// One moderation-log entry reduced to the fields the tally needs.
export type AdminLogEntry = {
  moderatorName: string;
  type: string;
  author: string | undefined;
};

// --- Pure helpers (unit tested) ---

// Weight an admin-removed item: anti-evil removals 100, generic admin 1, else 0.
// Matches sbmod's scoring.
export function adminRemovedWeight(
  moderatorName: string,
  type: string
): number {
  if (!REMOVAL_TYPES.has(type)) return 0;
  if (moderatorName === ANTI_EVIL_MOD) return 100;
  if (moderatorName === ADMIN_MOD) return 1;
  return 0;
}

// A real, countable author (not missing or a deleted account).
export function isCountableAuthor(
  author: string | undefined
): author is string {
  return Boolean(author) && author !== '[deleted]';
}

// Sort a username->score map by score desc, then username asc.
export function sortCounts(
  counts: Record<string, number>
): Array<[string, number]> {
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

// Render a sorted [username, count] list as a markdown report body. Usernames
// are wrapped in inline code so a long report renders as plain text instead of a
// wall of user mentions. (The report is delivered via reply, not by creating a
// conversation with this body — see postToModDiscussions for why that matters.)
export function formatCountsReport(
  title: string,
  rows: ReadonlyArray<[string, number]>
): string {
  if (rows.length === 0) return `${title}\n\nNo matching users found.`;
  const lines = rows.map(
    ([username, count]) => `- \`u/${username}\`: ${count}`
  );
  return `${title}\n\n${lines.join('\n')}`;
}

// --- Reddit fetch helpers (used by the chunked engine) ---

// Fullnames of the most recent submissions (bounded by `limit`).
export async function fetchRecentPostIds(
  subredditName: string,
  limit: number
): Promise<T3[]> {
  const posts = await reddit.getNewPosts({ subredditName, limit }).all();
  return posts.map((post) => post.id);
}

// Comment authors on a single post, capped so one huge thread can't blow the
// step's time budget.
export async function fetchPostCommentAuthors(
  postId: T3,
  limit: number
): Promise<Array<string | undefined>> {
  const comments = await reddit.getComments({ postId, limit }).all();
  return comments.map((comment) => comment.authorName);
}

export type ModLogPage = {
  entries: AdminLogEntry[];
  nextAfter: string | undefined;
  done: boolean;
};

// One page of the moderation log, with a cursor to continue from.
export async function fetchModLogPage(
  subredditName: string,
  after: string | undefined,
  pageSize: number
): Promise<ModLogPage> {
  const page = await reddit
    .getModerationLog({
      subredditName,
      limit: pageSize,
      ...(after ? { after } : {}),
    })
    .all();
  const entries: AdminLogEntry[] = page.map((action) => ({
    moderatorName: action.moderatorName,
    type: action.type,
    author: action.target?.author,
  }));
  const last = page[page.length - 1];
  return { entries, nextAfter: last?.id, done: page.length < pageSize };
}

// Redis key holding the shared analysis Mod Discussions conversation id.
const ANALYSIS_CONVERSATION_REDIS_KEY = 'analysis:reportConversationId';
const ANALYSIS_THREAD_SUBJECT = 'SubSteward analysis reports';
const ANALYSIS_THREAD_INTRO =
  'SubSteward posts analysis reports in this thread.';

// Create the shared analysis conversation if it doesn't exist yet, returning its
// id. Created with a short intro body on purpose — see postToModDiscussions.
async function ensureAnalysisConversation(): Promise<string> {
  const existing = await redis.get(ANALYSIS_CONVERSATION_REDIS_KEY);
  if (existing) return existing;
  const conversationId = await reddit.modMail.createModDiscussionConversation({
    subject: ANALYSIS_THREAD_SUBJECT,
    bodyMarkdown: ANALYSIS_THREAD_INTRO,
    subredditId: context.subredditId,
  });
  await redis.set(ANALYSIS_CONVERSATION_REDIS_KEY, conversationId);
  return conversationId;
}

// Post a report to the shared analysis Mod Discussions thread.
//
// Creating a conversation whose first message is the full report triggers a
// Devvit response-parse bug (CreateModmailConversation -> "struct field for
// 'service' doesn't exist"), so the conversation is never created. Creating with
// a short body and replying with the report are both unaffected — so we ensure
// the thread exists (a short create) and then reply with the report.
export async function postToModDiscussions(
  bodyMarkdown: string
): Promise<void> {
  let conversationId = await ensureAnalysisConversation();
  try {
    await reddit.modMail.reply({
      conversationId,
      body: bodyMarkdown,
      isInternal: true,
    });
  } catch (error) {
    // The stored conversation may have been deleted/archived; recreate once.
    console.error(
      '[analysis] stored conversation unusable; recreating',
      describeError(error)
    );
    await redis.del(ANALYSIS_CONVERSATION_REDIS_KEY);
    conversationId = await ensureAnalysisConversation();
    await reddit.modMail.reply({
      conversationId,
      body: bodyMarkdown,
      isInternal: true,
    });
  }
}
