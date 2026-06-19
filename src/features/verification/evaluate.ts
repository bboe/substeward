// Pure verification logic ported from sbmod/verification.py.
//
// Everything in this module is side-effect free so it can be unit tested
// without touching the Reddit API. The data-gathering layer (verification.ts)
// fetches the user, comments, and mod notes, then feeds them through these
// functions to produce a pass/fail decision and a reddit-markdown report.

// A single mod note collapsed to just the fields we care about.
export type ModNoteType = string;

// Minimal shape of a comment needed for verification math.
export type CommentData = {
  createdAt: Date;
  score: number;
  subredditName: string;
};

// Tunable thresholds and presentation options (sourced from settings).
export type VerificationConfig = {
  subredditName: string;
  oldestCommentDays: number;
  minKarmaAverage: number;
  subredditsToShow: number;
  timezone: string;
};

// Aggregate statistics derived from a redditor's comment history.
export type CommentStats = {
  // All comments fetched, regardless of subreddit (count only).
  found: number;
  // [subredditName, count] in first-seen order; ties keep insertion order.
  subredditOrder: Array<[string, number]>;
  // Comments in the target subreddit only, sorted oldest-first.
  subjectComments: CommentData[];
  // Sum of scores across subjectComments.
  karma: number;
  // Mean score across subjectComments (0 when there are none).
  karmaAverage: number;
};

// Compute the cutoff date: accounts/comments older than this are acceptable.
export function markerFrom(now: Date, oldestCommentDays: number): Date {
  return new Date(now.getTime() - oldestCommentDays * 24 * 60 * 60 * 1000);
}

// Format a Date in a stable, human-readable way for the given IANA timezone.
// Produces e.g. "2024-01-15 09:30:00 PST". Mirrors the role of python's
// datetime string representation in the original report.
export function formatDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;

  const datePart = `${lookup.year}-${lookup.month}-${lookup.day}`;
  // hour can come back as "24" at midnight in some environments; normalize.
  const hour = lookup.hour === '24' ? '00' : lookup.hour;
  const timePart = `${hour}:${lookup.minute}:${lookup.second}`;
  const zone = lookup.timeZoneName ?? '';
  return `${datePart} ${timePart} ${zone}`.trim();
}

// Check account existence/age. Returns an error string or null when ok.
// Devvit cannot distinguish "not found" from "suspended" (both yield an
// undefined user), so they share one message.
export function checkStatus(opts: {
  userExists: boolean;
  createdAt: Date | undefined;
  marker: Date;
  timezone: string;
}): string | null {
  if (!opts.userExists || !opts.createdAt) {
    return 'is not found or suspended. No history information available.';
  }
  if (opts.createdAt > opts.marker) {
    return `was created too recently (${formatDateTime(opts.createdAt, opts.timezone)}). Skipped history collection.`;
  }
  return null;
}

// Reject redditors with any ban or mute mod notes. Returns error or null.
export function checkNotes(
  noteTypeCounts: Record<ModNoteType, number>
): string | null {
  const bans = noteTypeCounts['BAN'] ?? 0;
  if (bans > 0) {
    return `has ${bans} ban(s). Skipped history collection.`;
  }
  const mutes = noteTypeCounts['MUTE'] ?? 0;
  if (mutes > 0) {
    return `has ${mutes} mute(s). Skipped history collection.`;
  }
  return null;
}

// Aggregate raw comments into the statistics used for evaluation/reporting.
export function processComments(
  comments: readonly CommentData[],
  subredditName: string
): CommentStats {
  const counts = new Map<string, number>();
  const subjectComments: CommentData[] = [];

  for (const comment of comments) {
    counts.set(
      comment.subredditName,
      (counts.get(comment.subredditName) ?? 0) + 1
    );
    if (comment.subredditName === subredditName) {
      subjectComments.push(comment);
    }
  }

  // Oldest-first, matching the original sort by created timestamp.
  subjectComments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const karma = subjectComments.reduce((sum, c) => sum + c.score, 0);
  const karmaAverage =
    subjectComments.length > 0 ? karma / subjectComments.length : 0;

  return {
    found: comments.length,
    // Map preserves insertion (first-seen) order.
    subredditOrder: [...counts.entries()],
    subjectComments,
    karma,
    karmaAverage,
  };
}

// Apply the comment-history thresholds. Returns error string or null when ok.
export function checkComments(
  stats: CommentStats,
  opts: {
    subredditName: string;
    marker: Date;
    minKarmaAverage: number;
    timezone: string;
  }
): string | null {
  if (stats.subjectComments.length === 0) {
    return `has no r/${opts.subredditName} history.`;
  }

  const oldest = stats.subjectComments[0]!.createdAt;
  if (oldest > opts.marker) {
    return `oldest r/${opts.subredditName} comment is too recent (${formatDateTime(oldest, opts.timezone)})`;
  }

  if (stats.karmaAverage < opts.minKarmaAverage) {
    return 'too low of karma average';
  }

  return null;
}

// Return the top-N [name, count] entries ordered by count desc, ties keeping
// first-seen order (Array.prototype.sort is stable). limit <= 0 means "all".
export function mostCommon(
  order: ReadonlyArray<[string, number]>,
  limit: number
): Array<[string, number]> {
  const sorted = [...order].sort((a, b) => b[1] - a[1]);
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

// Build the markdown results body for a passing verification.
export function formatResults(opts: {
  username: string;
  createdAt: Date;
  stats: CommentStats;
  noteTypeCounts: Record<ModNoteType, number>;
  config: VerificationConfig;
}): string {
  const { username, createdAt, stats, noteTypeCounts, config } = opts;
  const lines: string[] = [];

  lines.push(`                User: ${username}`);
  lines.push(
    `             Created: ${formatDateTime(createdAt, config.timezone)}`
  );
  lines.push(`Commented subreddits: ${stats.subredditOrder.length}`);

  let topSubreddits: Array<[string, number]>;
  if (stats.subredditOrder.length > config.subredditsToShow) {
    topSubreddits = mostCommon(stats.subredditOrder, config.subredditsToShow);
    lines.push(`   Top ${config.subredditsToShow} subreddits:`);
  } else {
    topSubreddits = mostCommon(stats.subredditOrder, 0);
  }
  for (const [subreddit, count] of topSubreddits) {
    lines.push(`                      - ${subreddit} (${count} comments)`);
  }

  lines.push(`Total comments found: ${stats.found}`);
  lines.push('');
  lines.push(`r/${config.subredditName} specific`);
  lines.push(`            Comments: ${stats.subjectComments.length}`);

  if (stats.subjectComments.length > 0) {
    const newest =
      stats.subjectComments[stats.subjectComments.length - 1]!.createdAt;
    const oldest = stats.subjectComments[0]!.createdAt;
    lines.push(`       Comment karma: ${stats.karma}`);
    lines.push(`       Average karma: ${stats.karmaAverage.toFixed(2)}`);
    lines.push(
      `      Newest comment: ${formatDateTime(newest, config.timezone)}`
    );
    lines.push(
      `      Oldest comment: ${formatDateTime(oldest, config.timezone)}`
    );
  }

  for (const [noteType, count] of Object.entries(noteTypeCounts).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    lines.push(`${noteType.padStart(14)} count: ${count}`);
  }

  // Each non-empty line is indented by four spaces; blanks stay blank.
  return lines.map((line) => (line ? `    ${line}` : '')).join('\n');
}

// Build the markdown body for a failing verification.
export function formatFailure(username: string, error: string): string {
  return `u/${username}: verification fail\n\nAccount ${error}`;
}

// Failure body that also includes the activity summary. Used for failures that
// occur after comment history is gathered (e.g. no in-subreddit history, oldest
// comment too recent, low karma) so moderators still see the user's breakdown.
export function formatFailureWithSummary(opts: {
  username: string;
  error: string;
  createdAt: Date;
  stats: CommentStats;
  noteTypeCounts: Record<ModNoteType, number>;
  config: VerificationConfig;
}): string {
  const summary = formatResults({
    username: opts.username,
    createdAt: opts.createdAt,
    stats: opts.stats,
    noteTypeCounts: opts.noteTypeCounts,
    config: opts.config,
  });
  return `${formatFailure(opts.username, opts.error)}\n\n${summary}`;
}
