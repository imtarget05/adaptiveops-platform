import { Hono } from 'hono';
import type { Env } from '../types/env';
import { ingestEvent, getEvent, listPendingDeliveries, markDelivered, markFailed, listDlq, replayDlq } from '../services/eventService';
import { dispatchPending, isAllowedTargetUrl, deliverEvent } from '../services/deliveryService';
import { adminAuthMiddleware } from '../middleware/auth';

export const eventsRoutes = new Hono<{ Bindings: Env }>();

// Ingest a business event (public endpoint for producers).
eventsRoutes.post('/', async (c) => {
  const db = c.env.DB;
  try {
    const body = await c.req.json<{
      idempotency_key?: string;
      event_type?: string;
      source?: string;
      subject?: string | null;
      payload?: Record<string, any>;
      target_url?: string | null;
      max_retries?: number | null;
      deduplication_window_seconds?: number | null;
    }>();

    if (!body.idempotency_key || !body.event_type || !body.source) {
      return c.json(
        { error: 'Bad Request', message: 'Missing required fields: idempotency_key, event_type, source' },
        400
      );
    }

    const result = await ingestEvent(c.env, {
      idempotency_key: body.idempotency_key,
      event_type: body.event_type,
      source: body.source,
      subject: body.subject ?? null,
      payload: body.payload ?? {},
      target_url: body.target_url ?? null,
      max_retries: body.max_retries ?? null,
      deduplication_window_seconds: body.deduplication_window_seconds ?? null,
    });

    return c.json(
      {
        success: true,
        duplicate: result.duplicate,
        event: result.event,
      },
      result.duplicate ? 202 : 201
    );
  } catch (err: any) {
    if (err?.message === 'Malformed JSON payload') {
      return c.json({ error: 'Bad Request', message: 'Malformed JSON payload' }, 400);
    }
    return c.json({ error: 'Internal Server Error', message: err?.message ?? 'Ingestion failed' }, 500);
  }
});

// List events with optional status filter and pagination.
eventsRoutes.get('/', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const statusFilter = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const offset = Number(c.req.query('offset')) || 0;

  let query = 'SELECT * FROM events';
  const params: any[] = [];
  if (statusFilter) {
    query += ' WHERE status = ?';
    params.push(statusFilter);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.prepare(query).bind(...params).all();
  const totalRow = await db
    .prepare(`SELECT COUNT(*) as count FROM events${statusFilter ? ' WHERE status = ?' : ''}`)
    .bind(...(statusFilter ? [statusFilter] : []))
    .first<{ count: number }>();

  return c.json({
    events: rows.results || [],
    total: totalRow?.count ?? 0,
    limit,
    offset,
  });
});

// DLQ list (registered before /:id so 'dlq' is not captured as an event id).
eventsRoutes.get('/dlq', adminAuthMiddleware, async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const rows = await listDlq(c.env, limit);
  return c.json({ dlq: rows, limit });
});

// Replay a DLQ message.
eventsRoutes.post('/dlq/:id/replay', adminAuthMiddleware, async (c) => {
  const result = await replayDlq(c.env, c.req.param('id'));
  if (!result) {
    return c.json({ error: 'Not Found', message: `DLQ message not found: ${c.req.param('id')}` }, 404);
  }
  return c.json({ success: true, event_id: result.event_id, message: 'DLQ message replayed; event returned to pending' });
});

// Get a single event.
eventsRoutes.get('/:id', adminAuthMiddleware, async (c) => {
  const event = await getEvent(c.env, c.req.param('id'));
  if (!event) {
    return c.json({ error: 'Not Found', message: `Event not found: ${c.req.param('id')}` }, 404);
  }
  return c.json({ event });
});

// List delivery attempts for an event.
eventsRoutes.get('/:id/deliveries', adminAuthMiddleware, async (c) => {
  const db = c.env.DB;
  const eventId = c.req.param('id');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);

  const rows = await db
    .prepare('SELECT * FROM event_deliveries WHERE event_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(eventId, limit)
    .all();

  return c.json({
    event_id: eventId,
    deliveries: rows.results || [],
    limit,
  });
});

// Dispatch pending deliveries (admin/operator).
eventsRoutes.post('/deliveries/dispatch', adminAuthMiddleware, async (c) => {
  const body = (await c.req.json<{ limit?: number; timeout_ms?: number; base_backoff_ms?: number }>()) ?? {};
  const result = await dispatchPending(c.env, {
    limit: body.limit,
    timeoutMs: body.timeout_ms,
    baseBackoffMs: body.base_backoff_ms,
  });
  return c.json({ success: true, ...result });
});

// Single-event delivery attempt (admin/operator).
eventsRoutes.post('/:id/deliver', adminAuthMiddleware, async (c) => {
  const event = await getEvent(c.env, c.req.param('id'));
  if (!event) {
    return c.json({ error: 'Not Found', message: `Event not found: ${c.req.param('id')}` }, 404);
  }
  const result = await deliverEvent(c.env, event);
  return c.json({ success: true, ...result });
});

// SSRF target validation helper (documented contract).
eventsRoutes.get('/target/validate', async (c) => {
  const url = c.req.query('url');
  return c.json({ url, ...isAllowedTargetUrl(url ?? null, c.env.ENVIRONMENT) });
});
