import { Hono } from 'hono';
import type { Env } from '../types/env';
import { ingestHealthMetric, type IngestHealthPayload } from '../services/healthService';
import { adminAuthMiddleware } from '../middleware/auth';

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.post('/', adminAuthMiddleware, async (c) => {
  const body = await c.req.json<IngestHealthPayload>();

  if (!body.environment) {
    return c.json({ error: 'Bad Request', message: 'Missing required field: environment' }, 400);
  }

  try {
    const result = await ingestHealthMetric(c.env, body);
    return c.json(result, 200);
  } catch (err: any) {
    console.error('Health check ingestion failed:', err);
    return c.json({ error: 'Internal Server Error', message: err.message }, 500);
  }
});

healthRoutes.get('/:environment', async (c) => {
  const db = c.env.DB;
  const envName = c.req.param('environment').toLowerCase();
  const limit = Math.min(Number(c.req.query('limit')) || 30, 100);

  const metrics = await db
    .prepare('SELECT * FROM health_metrics WHERE environment_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?')
    .bind(envName, limit)
    .all();

  const envRow = await db
    .prepare('SELECT id, name, current_health_status, consecutive_failures, last_health_check_at FROM environments WHERE id = ?')
    .bind(envName)
    .first();

  return c.json({
    environment: envRow || { id: envName, current_health_status: 'unknown' },
    metrics: metrics.results || [],
    limit
  });
});
