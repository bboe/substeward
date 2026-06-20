import { context, reddit, redis } from '@devvit/web/server';
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

// Split a report into messages that each fit Reddit's modmail body limit
// (10000 chars), breaking on line boundaries. A long report (large subreddit)
// would otherwise be rejected. An overlong single line is hard-split as a last
// resort; in practice lines are short ("- `u/name`: N").
export function chunkReport(body: string, max = 9000): string[] {
  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current) chunks.push(current);
    current = '';
  };
  for (const line of body.split('\n')) {
    if (line.length > max) {
      flush();
      for (let i = 0; i < line.length; i += max) {
        chunks.push(line.slice(i, i + max));
      }
      continue;
    }
    if (current && current.length + 1 + line.length > max) flush();
    current = current ? `${current}\n${line}` : line;
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
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

// Send the report messages to the shared analysis thread, creating it on first
// use. The thread is created with the first message as its body (no placeholder);
// the rest are replies. Reddit caps a modmail body at 10000 chars — exceeding it
// is what produced the original failures (the create path surfaced the limit as
// an unparseable "struct field 'service'" error, the reply path reports it
// plainly), so the report is pre-split into parts that each fit.
async function deliver(messages: string[]): Promise<void> {
  const stored = await redis.get(ANALYSIS_CONVERSATION_REDIS_KEY);
  let conversationId: string;
  let startIndex = 0;
  if (stored) {
    conversationId = stored;
  } else {
    conversationId = await reddit.modMail.createModDiscussionConversation({
      subject: ANALYSIS_THREAD_SUBJECT,
      bodyMarkdown: messages[0] as string,
      subredditId: context.subredditId,
    });
    await redis.set(ANALYSIS_CONVERSATION_REDIS_KEY, conversationId);
    startIndex = 1;
  }
  for (let i = startIndex; i < messages.length; i += 1) {
    await reddit.modMail.reply({
      conversationId,
      body: messages[i] as string,
      isInternal: true,
    });
  }
}

// Post a report to the shared analysis Mod Discussions thread, split into parts
// that each stay under Reddit's 10000-char modmail body limit.
//
// On failure this throws without clearing the stored conversation id, so the
// engine's retries reply into the same thread instead of creating a new one each
// time (which previously produced duplicate threads).
export async function postToModDiscussions(
  bodyMarkdown: string
): Promise<void> {
  const parts = chunkReport(bodyMarkdown);
  const messages = parts.map((part, index) =>
    parts.length > 1 ? `(part ${index + 1}/${parts.length})\n\n${part}` : part
  );
  await deliver(messages);
}
