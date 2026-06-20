import { reddit, redis, scheduler } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import {
  adminRemovedWeight,
  fetchModLogPage,
  fetchPostCommentAuthors,
  fetchRecentPostIds,
  formatCountsReport,
  isCountableAuthor,
  postToModDiscussions,
  sortCounts,
  type AnalysisKind,
} from './analysis.js';
import { getAnalysisSettings } from './settings.js';
import { notifyModerators } from './report.js';

// Chunked, background engine for the analysis reports. The scans (every recent
// post's comments, or the whole mod log) can exceed Devvit's 30s request limit,
// so work is spread across daisy-chained scheduler steps with a soft time budget
// — the same pattern as the verification run engine.

// Scheduler task name; must match the task declared in devvit.json.
const ANALYSIS_REPORT_JOB = 'analysisReport';
const RUN_KEY_PREFIX = 'analysis:run:';
// Stop a step and reschedule once it passes this soft budget (30s hard limit).
const STEP_TIME_BUDGET_MS = 20_000;
// Space out daisy-chained steps so a fast/empty run can't exceed Devvit's
// runJob creation limit (60 calls/minute per installation).
const STEP_DELAY_MS = 3_000;
const MAX_CHUNK_RETRIES = 2;
const RUN_TTL_SECONDS = 60 * 60;
const MOD_LOG_PAGE_SIZE = 100;
// Cap comments fetched per post so one huge thread can't blow a step's budget.
const PER_POST_COMMENT_LIMIT = 500;

type Phase = 'init' | 'scan' | 'finalize';

type AnalysisRunState = {
  runId: string;
  kind: AnalysisKind;
  phase: Phase;
  attempt: number;
  startedAtIso: string;
  updatedAtIso: string;
  // Accumulated username -> score tally.
  counts: Record<string, number>;
  // Posts scanned (active-users) or log entries scanned (admin-removed).
  scanned: number;
  // active-users: post fullnames to scan + cursor into them.
  postIds: string[];
  postIndex: number;
  // admin-removed: moderation-log cursor.
  after: string | null;
};

function runKey(runId: string): string {
  return `${RUN_KEY_PREFIX}${runId}`;
}

async function loadRun(runId: string): Promise<AnalysisRunState | null> {
  const raw = await redis.get(runKey(runId));
  return raw ? (JSON.parse(raw) as AnalysisRunState) : null;
}

async function saveRun(state: AnalysisRunState): Promise<void> {
  state.updatedAtIso = new Date().toISOString();
  await redis.set(runKey(state.runId), JSON.stringify(state));
  await redis.expire(runKey(state.runId), RUN_TTL_SECONDS);
}

async function finishRun(runId: string): Promise<void> {
  await redis.del(runKey(runId));
}

async function scheduleStep(runId: string): Promise<void> {
  await scheduler.runJob({
    name: ANALYSIS_REPORT_JOB,
    runAt: new Date(Date.now() + STEP_DELAY_MS),
    data: { runId },
  });
}

// Create a run and schedule its first step. Returns the new run id.
export async function startAnalysisReport(kind: AnalysisKind): Promise<string> {
  const now = new Date();
  const runId = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const state: AnalysisRunState = {
    runId,
    kind,
    phase: 'init',
    attempt: 0,
    startedAtIso: now.toISOString(),
    updatedAtIso: now.toISOString(),
    counts: {},
    scanned: 0,
    postIds: [],
    postIndex: 0,
    after: null,
  };
  await saveRun(state);
  console.log(`[analysis] queued ${kind} report ${runId}`);
  await scheduleStep(runId);
  return runId;
}

// Queue a report and return an immediate toast for the moderator.
export async function queueAnalysisReport(kind: AnalysisKind): Promise<string> {
  await startAnalysisReport(kind);
  const what =
    kind === 'active-users'
      ? 'recently active users'
      : 'users with admin-removed items';
  return `Tallying ${what} — the report will be posted to Mod Discussions shortly.`;
}

// Execute one step of a run. Invoked by the scheduler route per job.
export async function stepAnalysisReport(runId: string): Promise<void> {
  const state = await loadRun(runId);
  if (!state) {
    console.warn(`[analysis] step for unknown/finished run ${runId}`);
    return;
  }
  try {
    if (state.phase === 'init') await stepInit(state);
    else if (state.phase === 'scan') await stepScan(state);
    else await stepFinalize(state);
  } catch (error) {
    await handleStepError(state, error);
  }
}

async function stepInit(state: AnalysisRunState): Promise<void> {
  if (state.kind === 'active-users') {
    const { submissionLimit } = await getAnalysisSettings();
    const subreddit = await reddit.getCurrentSubreddit();
    state.postIds = await fetchRecentPostIds(subreddit.name, submissionLimit);
    console.log(
      `[analysis] ${state.runId}: scanning ${state.postIds.length} submissions`
    );
  }
  state.phase = 'scan';
  state.attempt = 0;
  await saveRun(state);
  await scheduleStep(state.runId);
}

async function stepScan(state: AnalysisRunState): Promise<void> {
  const start = Date.now();
  const subreddit = await reddit.getCurrentSubreddit();
  let done = false;

  if (state.kind === 'active-users') {
    while (state.postIndex < state.postIds.length) {
      const postId = state.postIds[state.postIndex] as T3;
      const authors = await fetchPostCommentAuthors(
        postId,
        PER_POST_COMMENT_LIMIT
      );
      for (const author of authors) {
        if (isCountableAuthor(author)) {
          state.counts[author] = (state.counts[author] ?? 0) + 1;
        }
      }
      state.postIndex += 1;
      state.scanned = state.postIndex;
      if (Date.now() - start > STEP_TIME_BUDGET_MS) break;
    }
    // Done once every post has been scanned (also covers an empty post list,
    // so the run can never reschedule forever making no progress).
    done = state.postIndex >= state.postIds.length;
  } else {
    for (;;) {
      const page = await fetchModLogPage(
        subreddit.name,
        state.after ?? undefined,
        MOD_LOG_PAGE_SIZE
      );
      for (const entry of page.entries) {
        if (!isCountableAuthor(entry.author)) continue;
        const weight = adminRemovedWeight(entry.moderatorName, entry.type);
        if (weight > 0) {
          state.counts[entry.author] =
            (state.counts[entry.author] ?? 0) + weight;
        }
      }
      state.scanned += page.entries.length;
      state.after = page.nextAfter ?? state.after;
      if (page.done || !page.nextAfter) {
        done = true;
        break;
      }
      if (Date.now() - start > STEP_TIME_BUDGET_MS) break;
    }
  }

  state.attempt = 0;
  if (done) state.phase = 'finalize';
  await saveRun(state);
  await scheduleStep(state.runId);
}

async function stepFinalize(state: AnalysisRunState): Promise<void> {
  const rows = sortCounts(state.counts);
  const { subject, title } =
    state.kind === 'active-users'
      ? {
          subject: 'Active users report',
          title: `Recently active users (last ${state.scanned} submissions)`,
        }
      : {
          subject: 'Admin-removed items report',
          title: `Users with admin-removed items (scanned ${state.scanned} log entries)`,
        };
  await postToModDiscussions(subject, formatCountsReport(title, rows));
  console.log(
    `[analysis] ${state.runId}: posted ${state.kind} report (${rows.length} users, scanned ${state.scanned})`
  );
  await finishRun(state.runId);
}

// Retry a failed step up to MAX_CHUNK_RETRIES; otherwise alert moderators.
async function handleStepError(
  state: AnalysisRunState,
  error: unknown
): Promise<void> {
  state.attempt += 1;
  if (state.attempt <= MAX_CHUNK_RETRIES) {
    console.error(
      `[analysis] ${state.runId}: '${state.phase}' attempt ${state.attempt} failed; retrying`,
      error
    );
    await saveRun(state);
    await scheduleStep(state.runId);
    return;
  }
  console.error(
    `[analysis] ${state.runId}: '${state.phase}' failed permanently`,
    error
  );
  await notifyModerators(
    '⚠️ Analysis report failed',
    `The ${state.kind} report could not be completed: ${String(error)}\n\n` +
      'You can re-run it from the subreddit menu.'
  );
  await finishRun(state.runId);
}
