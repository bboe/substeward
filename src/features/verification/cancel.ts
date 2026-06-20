import { scheduler } from '@devvit/web/server';

// Names of the one-off, daisy-chained background jobs. The recurring
// `verificationWatchdog` cron is intentionally excluded — we never cancel it.
const CANCELABLE_JOBS = new Set(['analysisReport', 'verifyUser']);

// Cancel every pending analysis/verification step job. Because each run is a
// linear chain (a step schedules exactly one successor), cancelling the pending
// jobs halts all in-flight runs; their Redis state then expires via its TTL.
// Returns the number of jobs cancelled.
export async function cancelBackgroundReports(): Promise<number> {
  const jobs = await scheduler.listJobs();
  let cancelled = 0;
  for (const job of jobs) {
    if (CANCELABLE_JOBS.has(job.name)) {
      await scheduler.cancelJob(job.id);
      cancelled += 1;
    }
  }
  console.log(`[cancel] cancelled ${cancelled} background report job(s)`);
  return cancelled;
}
