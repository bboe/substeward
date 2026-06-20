import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { runWatchdog, stepVerification } from '../features/verification/run.js';
import { stepAnalysisReport } from '../features/verification/analysis-run.js';

// Router for scheduled/queued task endpoints declared in devvit.json/scheduler.tasks.
export const schedulerRoutes = new Hono();

schedulerRoutes.post('/verify-user', async (c) => {
  // One step of a chunked verification run, enqueued from a menu/form action
  // and re-enqueued by the engine until the run completes.
  const input = await c.req.json<TaskRequest<{ runId?: string }>>();
  if (input.data?.runId) {
    await stepVerification(input.data.runId);
  } else {
    console.error('[verification] verify-user job missing runId', input.data);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/analysis-report', async (c) => {
  // One step of a chunked analysis report; re-enqueued by the engine until done.
  const input = await c.req.json<TaskRequest<{ runId?: string }>>();
  if (input.data?.runId) {
    await stepAnalysisReport(input.data.runId);
  } else {
    console.error('[analysis] analysis-report job missing runId', input.data);
  }
  return c.json<TaskResponse>({}, 200);
});

schedulerRoutes.post('/verification-watchdog', async (c) => {
  // Periodic sweep that abandons stalled runs and alerts moderators.
  await c.req.json<TaskRequest>();
  await runWatchdog();
  return c.json<TaskResponse>({}, 200);
});
