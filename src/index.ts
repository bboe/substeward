import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { forms } from './routes/forms.js';
import { menu } from './routes/menu.js';
import { schedulerRoutes } from './routes/scheduler.js';
import { settingsRoutes } from './routes/settings.js';
import { triggers } from './routes/triggers.js';

// Root app for all HTTP endpoints served by the Devvit Web server bundle.
const app = new Hono();
// Internal sub-router groups Devvit internal endpoints (menu/form/scheduler/settings).
const internal = new Hono();

// Mount internal endpoint routers.
internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/scheduler', schedulerRoutes);
internal.route('/settings', settingsRoutes);
internal.route('/triggers', triggers);

app.route('/internal', internal);

// Start Node server with Devvit-provided server factory and assigned port.
serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
