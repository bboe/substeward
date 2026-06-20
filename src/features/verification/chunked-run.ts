import { redis, scheduler } from '@devvit/web/server';

// Shared plumbing for chunked, daisy-chained scheduler runs. Devvit Web enforces
// a 30s max request time per invocation, so long work is split across scheduler
// steps that each persist progress to Redis and enqueue the next step. Both the
// verification run engine (`run.ts`) and the analysis report engine
// (`analysis-run.ts`) are built on these helpers.

// Soft per-step time budget, leaving headroom under the 30s hard request limit.
export const STEP_TIME_BUDGET_MS = 20_000;
// Spacing between steps so a fast run can't exceed Devvit's runJob creation
// limit (60 calls/minute per installation).
const STEP_DELAY_MS = 3_000;
// Retries per step before giving up (2 retries => up to 3 attempts).
export const MAX_CHUNK_RETRIES = 2;
// Safety expiry on run state so abandoned keys can't linger forever.
const RUN_TTL_SECONDS = 60 * 60;

// The minimal shape every run state must have to use the shared store.
export type BaseRunState = { runId: string; updatedAtIso: string };

// A short, mostly time-ordered unique id for a run.
export function newRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fully serialize an error for logging. gRPC failures from the Devvit client
// carry useful fields (`code`, `details`, `metadata`) that a plain String(error)
// drops; capture them so failures like the "struct field" response-parse error
// are debuggable. Note: the raw response body is parsed inside the Devvit client
// and is not exposed on the thrown error, so `details` is the most we can get.
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & {
    code?: unknown;
    details?: unknown;
    metadata?: { getMap?: () => unknown };
  };
  const info: Record<string, unknown> = { name: e.name, message: e.message };
  if (e.code !== undefined) info.code = e.code;
  if (e.details !== undefined) info.details = e.details;
  const metadata = e.metadata?.getMap?.();
  if (metadata && Object.keys(metadata).length > 0) info.metadata = metadata;
  if (e.stack) info.stack = e.stack;
  try {
    return JSON.stringify(info);
  } catch {
    return String(error);
  }
}

// Enqueue the next step of a run, spaced to respect the runJob creation limit.
export async function scheduleStep(
  jobName: string,
  runId: string
): Promise<void> {
  await scheduler.runJob({
    name: jobName,
    runAt: new Date(Date.now() + STEP_DELAY_MS),
    data: { runId },
  });
}

// A Redis-backed store for a chunked run's state. When `activeSetKey` is given,
// each save refreshes a heartbeat in that sorted set (scored by update time) so a
// watchdog can find stalled runs; finish removes it.
export type RunStore<S extends BaseRunState> = {
  key: (runId: string) => string;
  load: (runId: string) => Promise<S | null>;
  save: (state: S) => Promise<void>;
  finish: (runId: string) => Promise<void>;
};

export function createRunStore<S extends BaseRunState>(opts: {
  keyPrefix: string;
  activeSetKey?: string;
}): RunStore<S> {
  const key = (runId: string): string => `${opts.keyPrefix}${runId}`;
  return {
    key,
    async load(runId) {
      const raw = await redis.get(key(runId));
      return raw ? (JSON.parse(raw) as S) : null;
    },
    async save(state) {
      state.updatedAtIso = new Date().toISOString();
      await redis.set(key(state.runId), JSON.stringify(state));
      await redis.expire(key(state.runId), RUN_TTL_SECONDS);
      if (opts.activeSetKey) {
        await redis.zAdd(opts.activeSetKey, {
          score: Date.parse(state.updatedAtIso),
          member: state.runId,
        });
      }
    },
    async finish(runId) {
      await redis.del(key(runId));
      if (opts.activeSetKey) await redis.zRem(opts.activeSetKey, [runId]);
    },
  };
}
