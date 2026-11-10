import { Hono } from 'hono';
import type { Env } from '../types/env';
import type { Deployment, DeploymentEvent } from '../types/models';
import { adminAuthMiddleware } from '../middleware/auth';

export const deploymentRoutes = new Hono<{ Bindings: Env }>();

deploymentRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const envFilter = c.req.query('environment');
  const statusFilter = c.req.query('status');
  const releaseFilter = c.req.query('release_id');
  const limit = Math.min(Number(c.req.query('limit')) || 25, 100);
  const offset = Number(c.req.query('offset')) || 0;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (envFilter) {
    whereClauses.push('d.environment_id = ?');
    params.push(envFilter.toLowerCase());
  }
  if (statusFilter) {
    whereClauses.push('d.status = ?');
    params.push(statusFilter);
  }
  if (releaseFilter) {
    whereClauses.push('d.release_id = ?');
    params.push(releaseFilter);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `
    SELECT 
      d.*,
      r.version as release_version,
      r.commit_sha as release_commit_sha,
      r.container_image_tag as release_image_tag
    FROM deployments d
    LEFT JOIN releases r ON d.release_id = r.id
    ${whereSql}
    ORDER BY d.started_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all<any>();
  const totalRow = await db.prepare(`SELECT COUNT(*) as count FROM deployments d ${whereSql}`).bind(...params.slice(0, -2)).first<{ count: number }>();

  return c.json({
    deployments: rows.results || [],
    total: totalRow?.count || 0,
    limit,
    offset
  });
});

deploymentRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const deployment = await db
    .prepare(`
      SELECT d.*, r.version as release_version, r.commit_sha as release_commit_sha
      FROM deployments d
      LEFT JOIN releases r ON d.release_id = r.id
      WHERE d.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<any>();

  if (!deployment) {
    return c.json({ error: 'Not Found', message: `Deployment not found: ${id}` }, 404);
  }

  const events = await db
    .prepare('SELECT * FROM deployment_events WHERE deployment_id = ? ORDER BY created_at ASC')
    .bind(id)
    .all<DeploymentEvent>();

  return c.json({
    ...deployment,
    deployment,
    events: events.results || []
  });
});

deploymentRoutes.post('/', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<any>();

  const environmentId = (body.environment_id || body.environment || 'local').toLowerCase();
  let releaseId = body.release_id;

  if (!releaseId && body.version) {
    releaseId = `rel-${body.version}`;
    // Ensure release exists
    const relExists = await db.prepare('SELECT id FROM releases WHERE id = ?').bind(releaseId).first();
    if (!relExists) {
      await db
        .prepare(`
          INSERT INTO releases (id, version, commit_sha, git_author, commit_message, container_image_tag)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
          releaseId,
          body.version,
          body.commit_sha || `sha-${Date.now()}`,
          body.deployed_by || 'deploy-script',
          `Release ${body.version}`,
          `adaptiveops/order-service:${body.version}`
        )
        .run();
    }
  }

  if (!releaseId) {
    return c.json({ error: 'Bad Request', message: 'Missing required field: release_id or version' }, 400);
  }

  const deploymentId = body.id || `dep-${crypto.randomUUID().slice(0, 8)}`;
  const strategy = body.strategy || 'rolling';
  const triggerType = body.trigger_type || 'ci_cd';
  const deployedBy = body.deployed_by || 'operator';
  const targetProfile = body.target_profile || environmentId;
  const configSnapshot = body.config_snapshot ? JSON.stringify(body.config_snapshot) : null;

  await db
    .prepare(`
      INSERT INTO deployments (
        id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, config_snapshot_json, started_at
      ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(deploymentId, releaseId, environmentId, strategy, triggerType, deployedBy, targetProfile, configSnapshot)
    .run();

  // Record event
  await db
    .prepare('INSERT INTO deployment_events (id, deployment_id, status, message) VALUES (?, ?, ?, ?)')
    .bind(`ev-${crypto.randomUUID().slice(0, 8)}`, deploymentId, 'in_progress', `Deployment started for ${environmentId}`)
    .run();

  // Record audit
  await db
    .prepare('INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      `aud-${crypto.randomUUID().slice(0, 8)}`,
      deployedBy,
      'DEPLOYMENT_INITIATED',
      'deployment',
      deploymentId,
      environmentId,
      JSON.stringify({ releaseId, strategy, triggerType })
    )
    .run();

  const created = await db.prepare('SELECT * FROM deployments WHERE id = ?').bind(deploymentId).first<Deployment>();

  return c.json({ success: true, id: deploymentId, deployment: created, ...created }, 201);
});

deploymentRoutes.patch('/:id/status', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json<any>();

  const newStatus = body.status;
  if (!['pending', 'in_progress', 'success', 'failure', 'cancelled', 'rolled_back'].includes(newStatus)) {
    return c.json({ error: 'Bad Request', message: `Invalid deployment status: ${newStatus}` }, 400);
  }

  const existing = await db
    .prepare('SELECT * FROM deployments WHERE id = ?')
    .bind(id)
    .first<Deployment>();

  if (!existing) {
    return c.json({ error: 'Not Found', message: `Deployment not found: ${id}` }, 404);
  }

  const isTerminal = ['success', 'failure', 'cancelled', 'rolled_back'].includes(newStatus);
  const errorMessage = body.error_message || null;

  await db
    .prepare(`
      UPDATE deployments 
      SET status = ?,
          completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
          error_message = ?
      WHERE id = ?
    `)
    .bind(newStatus, isTerminal ? 1 : 0, errorMessage, id)
    .run();

  // Record timeline event
  await db
    .prepare('INSERT INTO deployment_events (id, deployment_id, status, message, details_json) VALUES (?, ?, ?, ?, ?)')
    .bind(
      `ev-${crypto.randomUUID().slice(0, 8)}`,
      id,
      newStatus,
      body.message || `Deployment status updated to ${newStatus}`,
      body.details ? JSON.stringify(body.details) : null
    )
    .run();

  // If status is success, update environment active release
  if (newStatus === 'success') {
    await db
      .prepare(`
        UPDATE environments 
        SET active_release_id = ?,
            target_version = (SELECT version FROM releases WHERE id = ?),
            current_health_status = 'healthy',
            consecutive_failures = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(existing.release_id, existing.release_id, existing.environment_id)
      .run();
  } else if (newStatus === 'failure') {
    await db
      .prepare(`
        UPDATE environments 
        SET current_health_status = 'degraded',
            consecutive_failures = consecutive_failures + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(existing.environment_id)
      .run();
  }

  // Audit log
  await db
    .prepare('INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      `aud-${crypto.randomUUID().slice(0, 8)}`,
      body.actor || 'system',
      `DEPLOYMENT_${newStatus.toUpperCase()}`,
      'deployment',
      id,
      existing.environment_id,
      JSON.stringify({ status: newStatus, error: errorMessage })
    )
    .run();

  const updated = await db.prepare('SELECT * FROM deployments WHERE id = ?').bind(id).first<Deployment>();

  return c.json({ success: true, id, deployment: updated, ...updated });
});
