import { Hono, type Context } from 'hono';
import type { Env } from '../types/env';
import type { AuditLog } from '../types/models';
import { adminAuthMiddleware } from '../middleware/auth';

export const auditRoutes = new Hono<{ Bindings: Env }>();

async function getAuditLogsHandler(c: Context<{ Bindings: Env }>) {
  const db = c.env.DB;
  const actorFilter = c.req.query('actor');
  const actionFilter = c.req.query('action');
  const envFilter = c.req.query('environment');
  const limit = Math.min(Number(c.req.query('limit')) || 30, 100);
  const offset = Number(c.req.query('offset')) || 0;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (actorFilter) {
    whereClauses.push('actor = ?');
    params.push(actorFilter);
  }
  if (actionFilter) {
    whereClauses.push('action = ?');
    params.push(actionFilter);
  }
  if (envFilter) {
    whereClauses.push('environment_id = ?');
    params.push(envFilter.toLowerCase());
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const query = `
    SELECT * FROM audit_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all<AuditLog>();
  const totalRow = await db
    .prepare(`SELECT COUNT(*) as count FROM audit_logs ${whereSql}`)
    .bind(...params.slice(0, -2))
    .first<{ count: number }>();

  return c.json({
    audit_logs: rows.results || [],
    total: totalRow?.count || 0,
    limit,
    offset
  });
}

// Handlers for both /audit and /audit-logs
auditRoutes.get('/', getAuditLogsHandler);

auditRoutes.post('/', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<any>();

  const actor = body.actor || 'system';
  const action = body.action;
  const environmentId = body.environment ? body.environment.toLowerCase() : body.environment_id ? body.environment_id.toLowerCase() : null;
  const targetType = body.target_type || 'system';
  const targetId = body.target_id || environmentId || 'global';
  const detailsJson = body.details ? JSON.stringify(body.details) : body.details_json || null;

  if (!action) {
    return c.json({ error: 'Bad Request', message: 'Missing required field: action' }, 400);
  }

  const auditId = body.id || `aud-${crypto.randomUUID().slice(0, 8)}`;
  const recordedAt = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO audit_logs (
        id, actor, action, target_type, target_id, environment_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(auditId, actor, action, targetType, targetId, environmentId, detailsJson)
    .run();

  return c.json(
    {
      success: true,
      audit_id: auditId,
      recorded_at: recordedAt
    },
    201
  );
});
