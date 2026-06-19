import { reddit, redis, scheduler } from '@devvit/web/server';
import {
  checkComments,
  checkNotes,
  checkStatus,
  formatFailure,
  formatResults,
  markerFrom,
  processComments,
  type CommentData,
  type VerificationConfig,
} from './evaluate.js';
import { recordActivity } from './activity.js';
import { deliverReport, notifyModerators } from './report.js';
import {
  getVerificationSettings,
  type VerificationSettings,
} from './settings.js';
import {
  collectNoteCounts,
  fetchCommentPage,
  fetchUser,
} from './verification.js';

// Scheduler task name; must match the task declared in devvit.json.
const VERIFY_USER_JOB = 'verifyUser';

const RUN_KEY_PREFIX = 'verification:run:';
// Sorted set of active run ids, scored by last-update time (ms) for the watchdog.
const ACTIVE_RUNS_KEY = 'verification:runs:active';

// Reddit caps a comment listing page at 100.
const PAGE_SIZE = 100;
// Cap on comments analyzed. In practice Reddit's listing ends well under this
// (the most observed was ~1978); the cap is a safety/cost backstop that also
// guarantees the fetch loop terminates. Set a bit above ~2000 to allow a little
// extra history before stopping.
const COMMENT_FETCH_LIMIT = 2100;
// Devvit Web enforces a 30s max request time. Stop fetching and reschedule once
// a step passes this soft budget, leaving headroom for one more page + saving.
const STEP_TIME_BUDGET_MS = 20_000;
// Safety cap on pages per step regardless of timing.
const MAX_PAGES_PER_STEP = 20;
// Retries per chunk before giving up (2 retries => up to 3 attempts).
const MAX_CHUNK_RETRIES = 2;
// A run with no progress for this long is considered stalled (e.g. an
// uncatchable job cancellation) and is abandoned by the watchdog.
const STALE_MS = 5 * 60 * 1000;
// Safety expiry on run state so abandoned keys can't linger forever.
const RUN_TTL_SECONDS = 60 * 60;

type Phase = 'init' | 'fetch' | 'finalize';

// A comment reduced to what the evaluation needs, JSON-serializable for Redis.
type StoredComment = { at: string; score: number; sub: string };

type RunState = {
  runId: string;
  username: string;
  phase: Phase;
  // Retry counter for the current phase.
  attempt: number;
  startedAtIso: string;
  updatedAtIso: string;
  // Account creation time, captured during init.
  createdAtIso: string | null;
  noteTypeCounts: Record<string, number>;
  // Pagination cursor (last comment fullname) for the next fetch.
  after: string | null;
  pagesFetched: number;
  comments: StoredComment[];
};

// --- Pure helpers (unit tested) ---

// Decide whether comment fetching is complete.
export function shouldStopFetching(opts: {
  total: number;
  limit: number;
  pageDone: boolean;
  hasNextCursor: boolean;
}): boolean {
  return opts.pageDone || !opts.hasNextCursor || opts.total >= opts.limit;
}

// True when a run hasn't been updated within the staleness window.
export function isStale(
  updatedAtIso: string,
  nowMs: number,
  staleMs: number
): boolean {
  return nowMs - Date.parse(updatedAtIso) >= staleMs;
}

// --- Redis-backed run state ---

function runKey(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId}`;
}

async function loadRun(runId: string): Promise<RunState | null> {
  const raw = await redis.get(runKey(runId));
  return raw ? (JSON.parse(raw) as RunState) : null;
}

// Persist state, refresh the active-runs heartbeat, and bound the key's TTL.
async function saveRun(state: RunState): Promise<void> {
  state.updatedAtIso = new Date().toISOString();
  await redis.set(runKey(state.runId), JSON.stringify(state));
  await redis.expire(runKey(state.runId), RUN_TTL_SECONDS);
  await redis.zAdd(ACTIVE_RUNS_KEY, {
    score: Date.parse(state.updatedAtIso),
    member: state.runId,
  });
}

async function finishRun(runId: string): Promise<void> {
  await redis.del(runKey(runId));
  await redis.zRem(ACTIVE_RUNS_KEY, [runId]);
}

async function scheduleStep(runId: string): Promise<void> {
  await scheduler.runJob({
    name: VERIFY_USER_JOB,
    runAt: new Date(),
    data: { runId },
  });
}

function buildConfig(
  settings: VerificationSettings,
  subredditName: string
): VerificationConfig {
  return {
    subredditName,
    oldestCommentDays: settings.oldestCommentDays,
    minKarmaAverage: settings.minKarmaAverage,
    subredditsToShow: settings.subredditsToShow,
    timezone: settings.timezone,
  };
}

// --- Lifecycle ---

// Create a run and schedule its first step. Returns the new run id.
export async function startVerification(username: string): Promise<string> {
  const now = new Date();
  const runId = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const state: RunState = {
    runId,
    username,
    phase: 'init',
    attempt: 0,
    startedAtIso: now.toISOString(),
    updatedAtIso: now.toISOString(),
    createdAtIso: null,
    noteTypeCounts: {},
    after: null,
    pagesFetched: 0,
    comments: [],
  };
  await saveRun(state);
  await recordActivity({ username, status: 'queued' });
  console.log(`[verification] queued run ${runId} for u/${username}`);
  await scheduleStep(runId);
  return runId;
}

// Execute one step of a run. Invoked by the scheduler route per job.
export async function stepVerification(runId: string): Promise<void> {
  const state = await loadRun(runId);
  if (!state) {
    console.warn(`[verification] step for unknown/finished run ${runId}`);
    return;
  }

  try {
    if (state.phase === 'init') {
      await stepInit(state);
    } else if (state.phase === 'fetch') {
      await stepFetch(state);
    } else {
      await stepFinalize(state);
    }
  } catch (error) {
    await handleStepError(state, error);
  }
}

async function stepInit(state: RunState): Promise<void> {
  const settings = await getVerificationSettings();
  const subreddit = await reddit.getCurrentSubreddit();
  const { exists, createdAt } = await fetchUser(state.username);
  console.log(
    `[verification] u/${state.username}: account ${exists && createdAt ? `found (created ${createdAt.toISOString()})` : 'not found or suspended'}`
  );

  const marker = markerFrom(
    new Date(state.startedAtIso),
    settings.oldestCommentDays
  );
  const statusError = checkStatus({
    userExists: exists,
    createdAt,
    marker,
    timezone: settings.timezone,
  });
  if (statusError || !createdAt) {
    await finalizeFail(
      state,
      statusError ??
        'is not found or suspended. No history information available.'
    );
    return;
  }

  state.createdAtIso = createdAt.toISOString();
  state.noteTypeCounts = await collectNoteCounts(
    subreddit.name,
    state.username
  );
  console.log(
    `[verification] u/${state.username}: mod notes ${JSON.stringify(state.noteTypeCounts)}`
  );

  const notesError = checkNotes(state.noteTypeCounts);
  if (notesError) {
    await finalizeFail(state, notesError);
    return;
  }

  state.phase = 'fetch';
  state.attempt = 0;
  await saveRun(state);
  await scheduleStep(state.runId);
}

async function stepFetch(state: RunState): Promise<void> {
  const stepStart = Date.now();
  let stop = false;

  // Fetch as many pages as fit within the soft time budget (and a hard page
  // cap), then reschedule the rest. This "daisy-chain" pattern is Reddit's
  // recommended way to stay under the 30s request limit for long work.
  for (let i = 0; i < MAX_PAGES_PER_STEP; i += 1) {
    const page = await fetchCommentPage(
      state.username,
      state.after ?? undefined,
      PAGE_SIZE
    );
    for (const comment of page.comments) {
      state.comments.push({
        at: comment.createdAt.toISOString(),
        score: comment.score,
        sub: comment.subredditName,
      });
    }
    state.pagesFetched += 1;
    state.after = page.nextAfter ?? state.after;

    stop = shouldStopFetching({
      total: state.comments.length,
      limit: COMMENT_FETCH_LIMIT,
      pageDone: page.done,
      hasNextCursor: Boolean(page.nextAfter),
    });

    const elapsed = Date.now() - stepStart;
    console.log(
      `[verification] u/${state.username}: page ${state.pagesFetched} (+${page.comments.length}, total ${state.comments.length}, +${elapsed}ms this step)${stop ? ' — fetch complete' : ''}`
    );
    if (stop) break;
    if (elapsed > STEP_TIME_BUDGET_MS) {
      console.log(
        `[verification] u/${state.username}: step time budget reached (${elapsed}ms); rescheduling`
      );
      break;
    }
  }

  state.attempt = 0;
  if (state.comments.length > COMMENT_FETCH_LIMIT) {
    // Keep only the newest `limit` comments (listing is newest-first).
    state.comments = state.comments.slice(0, COMMENT_FETCH_LIMIT);
  }
  if (stop) {
    state.phase = 'finalize';
  }

  await saveRun(state);
  await scheduleStep(state.runId);
}

async function stepFinalize(state: RunState): Promise<void> {
  const settings = await getVerificationSettings();
  const subreddit = await reddit.getCurrentSubreddit();
  const config = buildConfig(settings, subreddit.name);

  const comments: CommentData[] = state.comments.map((c) => ({
    createdAt: new Date(c.at),
    score: c.score,
    subredditName: c.sub,
  }));
  const stats = processComments(comments, config.subredditName);
  console.log(
    `[verification] u/${state.username}: evaluating ${stats.found} comment(s), ${stats.subjectComments.length} in r/${config.subredditName}, avg karma ${stats.karmaAverage.toFixed(2)}`
  );

  const marker = markerFrom(
    new Date(state.startedAtIso),
    settings.oldestCommentDays
  );
  const commentsError = checkComments(stats, {
    subredditName: config.subredditName,
    marker,
    minKarmaAverage: settings.minKarmaAverage,
    timezone: settings.timezone,
  });
  if (commentsError) {
    await finalizeFail(state, commentsError);
    return;
  }

  const report = formatResults({
    username: state.username,
    createdAt: new Date(state.createdAtIso ?? state.startedAtIso),
    stats,
    noteTypeCounts: state.noteTypeCounts,
    config,
  });

  let approved = false;
  let approveError: unknown;
  try {
    await reddit.approveUser(state.username, subreddit.name);
    approved = true;
    console.log(
      `[verification] approved u/${state.username} as a contributor of r/${subreddit.name}`
    );
  } catch (error) {
    approveError = error;
    console.error(
      `[verification] failed to approve u/${state.username}`,
      error
    );
  }

  await deliverReport(report);
  if (approved) {
    await recordActivity({ username: state.username, status: 'pass' });
  } else {
    await recordActivity({
      username: state.username,
      status: 'approve-failed',
      detail: String(approveError),
    });
  }
  console.log(
    `[verification] u/${state.username}: PASS (approved=${approved})`
  );
  await finishRun(state.runId);
}

// Deliver a failure report, record it, and end the run.
async function finalizeFail(state: RunState, error: string): Promise<void> {
  await deliverReport(formatFailure(state.username, error));
  await recordActivity({
    username: state.username,
    status: 'fail',
    detail: error,
  });
  console.log(`[verification] u/${state.username}: FAIL (${error})`);
  await finishRun(state.runId);
}

// Retry a failed step up to MAX_CHUNK_RETRIES; otherwise hard-fail and notify.
async function handleStepError(state: RunState, error: unknown): Promise<void> {
  state.attempt += 1;
  if (state.attempt <= MAX_CHUNK_RETRIES) {
    console.error(
      `[verification] u/${state.username}: '${state.phase}' attempt ${state.attempt} failed; retrying`,
      error
    );
    await saveRun(state);
    await scheduleStep(state.runId);
    return;
  }
  console.error(
    `[verification] u/${state.username}: '${state.phase}' failed permanently after ${state.attempt} attempts`,
    error
  );
  await hardFail(
    state,
    `the '${state.phase}' step failed repeatedly: ${String(error)}`
  );
}

// Abandon a run and alert moderators so they aren't left waiting.
async function hardFail(state: RunState, reason: string): Promise<void> {
  await recordActivity({
    username: state.username,
    status: 'error',
    detail: reason,
  });
  await notifyModerators(
    `⚠️ Verification failed: u/${state.username}`,
    `Verification of u/${state.username} could not be completed and has been abandoned.\n\n` +
      `**Reason:** ${reason}\n\n` +
      `No approval or report was produced. You can retry the verification manually.`
  );
  await finishRun(state.runId);
}

// Scan for runs that have made no progress within STALE_MS and abandon them.
// This catches uncatchable job cancellations (e.g. execution-time kills) that
// the per-step retry logic can't observe.
export async function runWatchdog(): Promise<void> {
  const now = Date.now();
  const threshold = now - STALE_MS;
  const stale = await redis.zRange(ACTIVE_RUNS_KEY, 0, threshold, {
    by: 'score',
  });
  if (stale.length === 0) return;

  console.warn(
    `[verification] watchdog: ${stale.length} possibly-stalled run(s)`
  );
  for (const { member: runId } of stale) {
    const state = await loadRun(runId);
    if (!state) {
      // State already gone; just drop the stale heartbeat entry.
      await redis.zRem(ACTIVE_RUNS_KEY, [runId]);
      continue;
    }
    if (!isStale(state.updatedAtIso, now, STALE_MS)) continue;

    console.error(
      `[verification] watchdog: run ${runId} for u/${state.username} stalled in '${state.phase}'; abandoning`
    );
    await hardFail(
      state,
      `the run stalled in the '${state.phase}' phase (no progress for over ${Math.round(STALE_MS / 60000)} minutes — likely a timeout or cancellation)`
    );
  }
}
