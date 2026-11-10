import { Hono } from 'hono';
import type { Env } from '../types/env';
import { executeRollback } from '../services/rollbackService';
import { adminAuthMiddleware } from '../middleware/auth';

export const environmentRoutes = new Hono<{ Bindings: Env }>();

environmentRoutes.get('/', async (c) => {
  const db = c.env.DB;

  const query = `
    SELECT 
      e.*,
      r.version as active_release_version,
      r.commit_sha as active_release_commit_sha,
      r.container_image_tag as active_release_image_tag,
      r.created_at as active_release_created_at
    FROM environments e
    LEFT JOIN releases r ON e.active_release_id = r.id
    ORDER BY 
      CASE e.id
        WHEN 'local' THEN 1
        WHEN 'kubernetes' THEN 2
        WHEN 'cloudflare' THEN 3
        WHEN 'aws' THEN 4
        WHEN 'azure' THEN 5
        ELSE 6
      END
  `;

  const rows = await db.prepare(query).all<any>();

  return c.json({
    environments: rows.results || []
  });
});

environmentRoutes.get('/:name/status', async (c) => {
  const db = c.env.DB;
  const name = c.req.param('name').toLowerCase();

  const envRow = await db
    .prepare(`
      SELECT 
        e.*,
        r.version as active_release_version,
        r.commit_sha as active_release_commit_sha,
        r.container_image_tag as active_release_image_tag
      FROM environments e
      LEFT JOIN releases r ON e.active_release_id = r.id
      WHERE e.id = ? OR LOWER(e.name) = ?
      LIMIT 1
    `)
    .bind(name, name)
    .first<any>();

  if (!envRow) {
    return c.json({ error: 'Not Found', message: `Environment not found: ${name}` }, 404);
  }

  const recentHealth = await db
    .prepare('SELECT * FROM health_metrics WHERE environment_id = ? ORDER BY recorded_at DESC LIMIT 10')
    .bind(envRow.id)
    .all();

  const recentDeployments = await db
    .prepare(`
      SELECT d.*, r.version as release_version 
      FROM deployments d 
      LEFT JOIN releases r ON d.release_id = r.id 
      WHERE d.environment_id = ? 
      ORDER BY d.started_at DESC 
      LIMIT 5
    `)
    .bind(envRow.id)
    .all();

  return c.json({
    environment: envRow,
    recent_health: recentHealth.results || [],
    recent_deployments: recentDeployments.results || []
  });
});

// Controlled Rollback Endpoint on environment route
environmentRoutes.post('/:name/rollback', adminAuthMiddleware, async (c) => {
  const name = c.req.param('name').toLowerCase();
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  try {
    const result = await executeRollback(c.env, {
      environment: name,
      target_release_id: body.target_release_id,
      target_version: body.target_version,
      reason: body.reason || 'Controlled rollback requested via environment endpoint',
      triggered_by: body.triggered_by || 'operator',
      force: !!body.force
    });

    return c.json(result, 200);
  } catch (err: any) {
    console.error('Rollback error:', err);
    return c.json(
      {
        error: 'No valid rollback candidate found for environment',
        message: err.message || 'Unable to execute controlled rollback'
      },
      400
    );
  }
});
