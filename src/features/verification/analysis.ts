import { context, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';

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

// Render a sorted [username, count] list as a markdown report body.
//
// Usernames are wrapped in inline code rather than written as raw `u/name`
// mentions. A rendered user mention makes Reddit return a modmail-creation
// response that the Devvit client can't parse ("struct field for 'service'"),
// which fails the whole report; inline code renders as plain text and avoids it.
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

// Open a Mod Discussions conversation containing the report so all mods see it.
export async function postToModDiscussions(
  subject: string,
  bodyMarkdown: string
): Promise<void> {
  await reddit.modMail.createModDiscussionConversation({
    subject,
    bodyMarkdown,
    subredditId: context.subredditId,
  });
}
