import { Hono } from 'hono';
import type { Env } from '../types/env';
import { findRollbackCandidate, executeRollback } from '../services/rollbackService';
import { adminAuthMiddleware } from '../middleware/auth';

export const rollbackRoutes = new Hono<{ Bindings: Env }>();

rollbackRoutes.get('/candidates/:environment', async (c) => {
  const envName = c.req.param('environment').toLowerCase();
  const db = c.env.DB;

  const envRow = await db
    .prepare(`
      SELECT e.*, r.version as current_version, r.commit_sha as current_commit_sha
      FROM environments e
      LEFT JOIN releases r ON e.active_release_id = r.id
      WHERE e.id = ?
    `)
    .bind(envName)
    .first<any>();

  if (!envRow) {
    return c.json({ error: 'Not Found', message: `Environment not found: ${envName}` }, 404);
  }

  const candidate = await findRollbackCandidate(c.env, envName);

  return c.json({
    environment: envName,
    current_release_id: envRow.active_release_id,
    current_release: {
      id: envRow.active_release_id,
      version: envRow.current_version || envRow.target_version,
      commit_sha: envRow.current_commit_sha,
      status: envRow.current_health_status
    },
    candidate_release: candidate
  });
});

rollbackRoutes.post('/', adminAuthMiddleware, async (c) => {
  const body = await c.req.json<any>();

  if (!body.environment) {
    return c.json({ error: 'Bad Request', message: 'Missing required field: environment' }, 400);
  }

  try {
    const result = await executeRollback(c.env, {
      environment: body.environment,
      target_release_id: body.target_release_id,
      target_version: body.target_version,
      reason: body.reason || 'Rollback triggered via API',
      triggered_by: body.triggered_by || 'operator',
      force: !!body.force
    });

    return c.json(result, 200);
  } catch (err: any) {
    console.error('Rollback execution failed:', err);
    const status = err.status || 400;
    return c.json(
      {
        error: 'No valid rollback candidate found for environment',
        message: err.message || 'No valid rollback candidate found for environment'
      },
      status
    );
  }
});
