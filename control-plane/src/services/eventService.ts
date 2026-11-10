import type { Env } from '../types/env';
import type {
  Event,
  EventStatus,
  DlqMessage,
  IngestEventRequest,
  IngestEventResult,
} from '../types/models';

function nowIso(): string {
  return new Date().toISOString();
}
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_DEDUP_WINDOW_SECONDS = 86400;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function ingestEvent(
  env: Env,
  req: IngestEventRequest
): Promise<IngestEventResult> {
  const db = env.DB;
  const now = nowIso();
  const id = `evt-${crypto.randomUUID()}`;
  const idempotencyKey = req.idempotency_key.trim();
  const eventType = req.event_type.trim();
  const source = req.source.trim();
  const subject = req.subject ?? null;
  const payloadJson = JSON.stringify(req.payload);
  const payloadHash = await sha256Hex(payloadJson);
  const maxRetries = req.max_retries ?? DEFAULT_MAX_RETRIES;
  const dedupWindow = req.deduplication_window_seconds ?? DEFAULT_DEDUP_WINDOW_SECONDS;

  // Idempotency: reject duplicate logical event within the deduplication window.
  const existing = await db
    .prepare('SELECT id, created_at, deduplication_window_seconds FROM events WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<{ id: string; created_at: string; deduplication_window_seconds: number }>();

  if (existing) {
    const created = new Date(existing.created_at).getTime();
    const windowMs = (existing.deduplication_window_seconds ?? dedupWindow) * 1000;
    if (Date.now() - created < windowMs) {
      const ev = await db
        .prepare('SELECT * FROM events WHERE id = ?')
        .bind(existing.id)
        .first<Event>();
      return { event: ev as Event, duplicate: true };
    }
  }

  await db
    .prepare(`
      INSERT INTO events (
        id, idempotency_key, event_type, source, subject, payload_json, payload_hash,
        target_url, status, retry_count, max_retries, next_retry_at, delivered_at,
        deduplication_window_seconds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, null, null, ?, ?, ?)
    `)
    .bind(
      id,
      idempotencyKey,
      eventType,
      source,
      subject,
      payloadJson,
      payloadHash,
      req.target_url ?? null,
      maxRetries,
      dedupWindow,
      now,
      now
    )
    .run();

  const ev = await db
    .prepare('SELECT * FROM events WHERE id = ?')
    .bind(id)
    .first<Event>();

  return { event: ev as Event, duplicate: false };
}

export async function getEvent(env: Env, id: string): Promise<Event | null> {
  return env.DB
    .prepare('SELECT * FROM events WHERE id = ?')
    .bind(id)
    .first<Event>();
}

export async function listPendingDeliveries(
  env: Env,
  limit = 50
): Promise<Event[]> {
  const now = nowIso();
  return env.DB
    .prepare(`
      SELECT * FROM events
      WHERE status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY next_retry_at ASC, created_at ASC
      LIMIT ?
    `)
    .bind(now, limit)
    .all<Event>()
    .then((r) => r.results as Event[]);
}

export async function recordDeliveryAttempt(
  env: Env,
  eventId: string,
  attempt: number,
  targetUrl: string,
  httpStatus: number | null,
  responseBodyPreview: string | null,
  errorMessage: string | null,
  durationMs: number | null
): Promise<void> {
  const id = `dly-${crypto.randomUUID()}`;
  await env.DB
    .prepare(`
      INSERT INTO event_deliveries (
        id, event_id, attempt, target_url, http_status, response_body_preview,
        error_message, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(id, eventId, attempt, targetUrl, httpStatus ?? null, responseBodyPreview, errorMessage, durationMs)
    .run();
}

export async function markDelivered(env: Env, eventId: string): Promise<void> {
  const now = nowIso();
  await env.DB
    .prepare(`
      UPDATE events
      SET status = 'delivered', delivered_at = ?, updated_at = ?
      WHERE id = ?
    `)
    .bind(now, now, eventId)
    .run();
}

export async function markFailed(
  env: Env,
  eventId: string,
  attempt: number,
  maxRetries: number,
  reason: string,
  lastHttpStatus: number | null,
  lastError: string | null
): Promise<'dlq' | 'failed'> {
  const db = env.DB;
  const row = await db
    .prepare('SELECT retry_count, max_retries FROM events WHERE id = ?')
    .bind(eventId)
    .first<{ retry_count: number; max_retries: number }>();

  const currentMax = row?.max_retries ?? maxRetries;
  const newRetryCount = (row?.retry_count ?? 0) + 1;

  if (newRetryCount >= currentMax) {
    await moveToDlq(env, eventId, reason, lastHttpStatus, lastError, newRetryCount);
    return 'dlq';
  }

  const backoffMs = computeBackoffMs(newRetryCount);
  const nextRetry = new Date(Date.now() + backoffMs).toISOString();
  await db
    .prepare(`
      UPDATE events
      SET status = 'pending', retry_count = ?, next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(newRetryCount, nextRetry, eventId)
    .run();
  return 'failed';
}

async function moveToDlq(
  env: Env,
  eventId: string,
  reason: string,
  lastHttpStatus: number | null,
  lastError: string | null,
  totalAttempts: number
): Promise<void> {
  const db = env.DB;
  const id = `dlq-${crypto.randomUUID()}`;
  await db
    .prepare(`
      INSERT INTO dlq_messages (
        id, event_id, reason, last_http_status, last_error_message,
        total_attempts, replayed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
    `)
    .bind(id, eventId, reason, lastHttpStatus, lastError, totalAttempts)
    .run();
  await db
    .prepare(`UPDATE events SET status = 'dlq', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(eventId)
    .run();
}

export async function replayDlq(env: Env, dlqId: string): Promise<{ event_id: string } | null> {
  const db = env.DB;
  const row = await db
    .prepare('SELECT event_id FROM dlq_messages WHERE id = ?')
    .bind(dlqId)
    .first<{ event_id: string }>();
  if (!row) return null;

  await db
    .prepare(`UPDATE dlq_messages SET replayed = 1, replayed_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(dlqId)
    .run();

  await db
    .prepare(`
      UPDATE events
      SET status = 'pending', retry_count = 0, next_retry_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(row.event_id)
    .run();

  return { event_id: row.event_id };
}

export async function listDlq(env: Env, limit = 50): Promise<Array<DlqMessage & { event_id: string }>> {
  return env.DB
    .prepare('SELECT * FROM dlq_messages ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<DlqMessage>()
    .then((r) => r.results as DlqMessage[]);
}

function computeBackoffMs(retryCount: number): number {
  const base = 1000;
  const cap = 30000;
  const exponential = Math.min(base * Math.pow(2, retryCount - 1), cap);
  const jitter = Math.floor(Math.random() * base);
  return exponential + jitter;
}

// Export for testing / override
export { computeBackoffMs as computeBackoff };
