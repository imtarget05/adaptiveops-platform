import { Hono } from 'hono';
import type { Env } from '../types/env';
import type { Release } from '../types/models';
import { adminAuthMiddleware } from '../middleware/auth';

export const releaseRoutes = new Hono<{ Bindings: Env }>();

releaseRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
  const offset = Number(c.req.query('offset')) || 0;
  const branch = c.req.query('branch');

  let query = 'SELECT * FROM releases';
  const params: any[] = [];

  if (branch) {
    query += ' WHERE branch = ?';
    params.push(branch);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const releases = await db.prepare(query).bind(...params).all<Release>();
  const totalRow = await db.prepare('SELECT COUNT(*) as count FROM releases').first<{ count: number }>();

  return c.json({
    releases: releases.results || [],
    total: totalRow?.count || 0,
    limit,
    offset
  });
});

releaseRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const release = await db
    .prepare('SELECT * FROM releases WHERE id = ? OR version = ? LIMIT 1')
    .bind(id, id)
    .first<Release>();

  if (!release) {
    return c.json({ error: 'Not Found', message: `Release not found: ${id}` }, 404);
  }

  const deployments = await db
    .prepare('SELECT * FROM deployments WHERE release_id = ? ORDER BY started_at DESC LIMIT 10')
    .bind(release.id)
    .all();

  return c.json({
    release,
    deployments: deployments.results || []
  });
});

releaseRoutes.post('/', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<any>();

  if (!body.version || !body.commit_sha) {
    return c.json({ error: 'Bad Request', message: 'Missing required fields: version, commit_sha' }, 400);
  }

  const id = body.id || `rel-${body.version}`;
  const gitAuthor = body.git_author || 'operator';
  const metadataJson = body.metadata ? JSON.stringify(body.metadata) : body.metadata_json || null;

  await db
    .prepare(`
      INSERT INTO releases (id, version, commit_sha, branch, tag, git_author, commit_message, changelog, container_image_tag, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        commit_sha = excluded.commit_sha,
        changelog = excluded.changelog,
        container_image_tag = excluded.container_image_tag,
        metadata_json = excluded.metadata_json
    `)
    .bind(
      id,
      body.version,
      body.commit_sha,
      body.branch || 'main',
      body.tag || body.version,
      gitAuthor,
      body.commit_message || `Release ${body.version}`,
      body.changelog || null,
      body.container_image_tag || `adaptiveops/order-service:${body.version}`,
      metadataJson
    )
    .run();

  const created = await db.prepare('SELECT * FROM releases WHERE id = ?').bind(id).first<Release>();

  // Record audit log
  await db
    .prepare('INSERT INTO audit_logs (id, actor, action, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`aud-${crypto.randomUUID().slice(0, 8)}`, gitAuthor, 'RELEASE_REGISTERED', 'release', id, JSON.stringify({ version: body.version }))
    .run();

  return c.json({ success: true, release: created }, 201);
});
