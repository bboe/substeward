import { context, reddit, redis } from '@devvit/web/server';
import { getExistingReportConversationId, modmailPermalink } from './report.js';

// Sorted set holding recent verification events, scored by timestamp (ms).
const ACTIVITY_KEY = 'verification:activity';
// Cap so the feed never grows unbounded.
const MAX_ACTIVITY_EVENTS = 100;
// How many events the on-demand report includes.
const REPORT_EVENT_COUNT = 25;

export type ActivityStatus =
  | 'queued'
  | 'pass'
  | 'fail'
  | 'approve-failed'
  | 'error';

export type ActivityEvent = {
  // Unique id so two events in the same millisecond don't collide in the set.
  id: string;
  // ISO-8601 timestamp (UTC).
  at: string;
  username: string;
  status: ActivityStatus;
  // Optional extra context (failure reason, error text, etc).
  detail?: string;
};

// Human-readable label for a status. Pure.
export function activityLabel(status: ActivityStatus): string {
  switch (status) {
    case 'queued':
      return 'QUEUED';
    case 'pass':
      return 'PASS (approved)';
    case 'fail':
      return 'FAIL';
    case 'approve-failed':
      return 'VERIFIED, APPROVE FAILED';
    case 'error':
      return 'ERROR';
  }
}

// Render recent events (newest first) as a markdown report body. Pure.
// An optional note (e.g. the report-thread link) is shown under the title.
export function formatActivityReport(
  events: readonly ActivityEvent[],
  note?: string
): string {
  const header = note ? `${note}\n\n` : '';
  if (events.length === 0) {
    return `Recent verification activity\n\n${header}No activity recorded yet.`;
  }
  const lines = events.map((event) => {
    const base = `- ${event.at} — u/${event.username} — ${activityLabel(event.status)}`;
    return event.detail ? `${base}: ${event.detail}` : base;
  });
  return `Recent verification activity (latest ${events.length})\n\n${header}${lines.join('\n')}`;
}

// Append an event to the feed (best-effort: never throws into the caller, so a
// feed/Redis hiccup can't break verification itself).
export async function recordActivity(event: {
  username: string;
  status: ActivityStatus;
  detail?: string;
}): Promise<void> {
  try {
    const now = Date.now();
    const full: ActivityEvent = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date(now).toISOString(),
      username: event.username,
      status: event.status,
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
    };
    await redis.zAdd(ACTIVITY_KEY, {
      score: now,
      member: JSON.stringify(full),
    });
    // Trim to the newest MAX_ACTIVITY_EVENTS (ranks are ascending by score).
    await redis.zRemRangeByRank(ACTIVITY_KEY, 0, -(MAX_ACTIVITY_EVENTS + 1));
  } catch (error) {
    console.error('[verification] failed to record activity event', error);
  }
}

// Read the most recent events, newest first.
export async function getRecentActivity(
  count: number
): Promise<ActivityEvent[]> {
  const rows = await redis.zRange(ACTIVITY_KEY, 0, count - 1, {
    by: 'rank',
    reverse: true,
  });
  return rows.map((row) => JSON.parse(row.member) as ActivityEvent);
}

// Post a snapshot of recent activity to Mod Discussions and return a toast.
export async function postRecentActivity(): Promise<string> {
  const events = await getRecentActivity(REPORT_EVENT_COUNT);
  const conversationId = await getExistingReportConversationId();
  const note = conversationId
    ? `Reports are posted to: ${modmailPermalink(conversationId)} (id: ${conversationId})`
    : 'No report thread has been created yet — one is created on the first verification.';
  await reddit.modMail.createModDiscussionConversation({
    subject: 'Verification activity',
    bodyMarkdown: formatActivityReport(events, note),
    subredditId: context.subredditId,
  });
  return `Posted the latest ${events.length} verification event(s) to Mod Discussions.`;
}
