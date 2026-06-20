import { reddit } from '@devvit/web/server';
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

const USER_URL = 'https://www.reddit.com/user/';
// Leave headroom under Reddit's 10000-char modmail body limit.
const MAX_MESSAGE_CHARS = 9000;

// Render a sorted [username, count] list as one or more Mod Discussions messages
// (each under the body limit). The report is a markdown table with linked
// usernames; when it spans multiple messages the title is labeled "(part i/n)"
// and the table header is repeated so every message renders as a table.
export function formatCountsMessages(
  title: string,
  rows: ReadonlyArray<[string, number]>,
  valueLabel = 'Count'
): string[] {
  if (rows.length === 0) return [`${title}\n\nNo matching users found.`];

  const header = `| User | ${valueLabel} |\n| --- | --- |`;
  const rowLines = rows.map(
    ([username, count]) =>
      `| [u/${username}](${USER_URL}${username}) | ${count} |`
  );

  // Pack rows into batches that fit alongside the title + header on each message.
  const overhead = title.length + header.length + 40;
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const line of rowLines) {
    if (
      current.length > 0 &&
      length + line.length + 1 + overhead > MAX_MESSAGE_CHARS
    ) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length > 0) batches.push(current);

  const total = batches.length;
  return batches.map((batch, index) => {
    const heading = total > 1 ? `${title} (part ${index + 1}/${total})` : title;
    return `${heading}\n\n${header}\n${batch.join('\n')}`;
  });
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
