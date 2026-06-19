import { context, reddit } from '@devvit/web/server';
import { getAnalysisSettings } from './settings.js';

// One moderation-log entry reduced to the fields the tally needs.
export type AdminLogEntry = {
  moderatorName: string;
  type: string;
  author: string | undefined;
};

// Moderator display names Reddit uses for admin/anti-evil removals.
const ANTI_EVIL_MOD = 'Anti-Evil Operations';
const ADMIN_MOD = 'reddit';
const REMOVAL_TYPES = new Set(['removecomment', 'removelink']);

// Tally users by admin-removed items, weighting anti-evil removals heavily
// (100) over generic admin removals (1), matching sbmod's scoring. Sorted by
// score desc, then username asc. Pure for testability.
export function tallyAdminRemoved(
  entries: readonly AdminLogEntry[]
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.author || !REMOVAL_TYPES.has(entry.type)) continue;
    let weight = 0;
    if (entry.moderatorName === ANTI_EVIL_MOD) weight = 100;
    else if (entry.moderatorName === ADMIN_MOD) weight = 1;
    if (weight === 0) continue;
    counts.set(entry.author, (counts.get(entry.author) ?? 0) + weight);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

// Tally comment authors, sorted by count desc then username asc. Pure.
export function tallyCommentAuthors(
  authors: readonly (string | undefined)[]
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const author of authors) {
    if (!author || author === '[deleted]') continue;
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

// Render a sorted [username, count] list as a markdown report body.
export function formatCountsReport(
  title: string,
  rows: ReadonlyArray<[string, number]>
): string {
  if (rows.length === 0) return `${title}\n\nNo matching users found.`;
  const lines = rows.map(([username, count]) => `- u/${username}: ${count}`);
  return `${title}\n\n${lines.join('\n')}`;
}

// Open a Mod Discussions conversation containing the report so all mods see it.
async function postToModDiscussions(
  subject: string,
  bodyMarkdown: string
): Promise<void> {
  await reddit.modMail.createModDiscussionConversation({
    subject,
    bodyMarkdown,
    subredditId: context.subredditId,
  });
}

// List redditors who have commented in the most recent submissions.
// Bounded by analysisSubmissionLimit to stay within Devvit request limits.
export async function listActiveRedditors(): Promise<string> {
  const { submissionLimit } = await getAnalysisSettings();
  const subreddit = await reddit.getCurrentSubreddit();

  const posts = await reddit
    .getNewPosts({ subredditName: subreddit.name, limit: submissionLimit })
    .all();

  const authors: Array<string | undefined> = [];
  for (const post of posts) {
    const comments = await post.comments.all();
    for (const comment of comments) authors.push(comment.authorName);
  }

  const rows = tallyCommentAuthors(authors);
  const title = `Recently active users (last ${posts.length} submissions)`;
  await postToModDiscussions(
    'Active users report',
    formatCountsReport(title, rows)
  );
  return `Found ${rows.length} active user(s) across ${posts.length} submission(s); report posted to Mod Discussions.`;
}

// List redditors who have had submissions or comments removed by Reddit/admins.
// Bounded by analysisModLogLimit.
export async function listRedditorsWithAdminRemovedItems(): Promise<string> {
  const { modLogLimit } = await getAnalysisSettings();
  const subreddit = await reddit.getCurrentSubreddit();

  const log = await reddit
    .getModerationLog({ subredditName: subreddit.name, limit: modLogLimit })
    .all();

  const entries: AdminLogEntry[] = log.map((action) => ({
    moderatorName: action.moderatorName,
    type: action.type,
    author: action.target?.author,
  }));

  const rows = tallyAdminRemoved(entries);
  const title = `Users with admin-removed items (scanned ${log.length} log entries)`;
  await postToModDiscussions(
    'Admin-removed items report',
    formatCountsReport(title, rows)
  );
  return `Found ${rows.length} user(s) with admin-removed items; report posted to Mod Discussions.`;
}
