import { Hono } from 'hono';
import type { Env } from './types/env';
import { corsMiddleware } from './middleware/cors';
import { webhookRoutes } from './routes/webhooks';
import { releaseRoutes } from './routes/releases';
import { deploymentRoutes } from './routes/deployments';
import { environmentRoutes } from './routes/environments';
import { healthRoutes } from './routes/health';
import { rollbackRoutes } from './routes/rollback';
import { auditRoutes } from './routes/audit';
import { eventsRoutes } from './routes/events';
import { smokeTestRoutes } from './routes/smoke-tests';
import { releaseLockRoutes } from './routes/release-locks';

export const app = new Hono<{ Bindings: Env }>();

// Global CORS Middleware
app.use('*', corsMiddleware);

// Base health probes
app.get('/', (c) => {
  return c.json({
    status: 'UP',
    service: 'adaptiveops-control-plane',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/healthz', (c) => {
  return c.json({ status: 'UP' });
});

// Mount /api/v1 routes
const api = new Hono<{ Bindings: Env }>();
api.route('/webhooks', webhookRoutes);
api.route('/releases', releaseRoutes);
api.route('/deployments', deploymentRoutes);
api.route('/environments', environmentRoutes);
api.route('/health', healthRoutes);
api.route('/rollback', rollbackRoutes);
  api.route('/audit', auditRoutes);
  api.route('/audit-logs', auditRoutes);
  api.route('/events', eventsRoutes);
  api.route('/smoke-tests', smokeTestRoutes);
  api.route('/release-locks', releaseLockRoutes);

app.route('/api/v1', api);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', message: `Route not found: ${c.req.method} ${c.req.path}` }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled control plane error:', err);
  const status = (err as any).status ?? 500;
  return c.json(
    {
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected error occurred in control plane'
    },
    status
  );
});

export default app;
