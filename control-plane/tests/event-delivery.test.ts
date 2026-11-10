// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { setupTestDatabase } from './helpers';

const testEnv = {
  ...env,
  ADMIN_API_KEY: 'test-admin-key',
};

function adminGet(url: string) {
  return app.fetch(new Request(url, { headers: { 'X-API-Key': 'test-admin-key' } }), testEnv);
}

function makeFetchMock(handler: (url: string, init: any) => Response) {
  return vi.fn(handler) as unknown as typeof fetch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('SC-01 Happy Path: event ingested, delivered, audit recorded', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delivers a genuine business event end-to-end', async () => {
    // 1. Ingest event
    const ingestRes = await app.fetch(
      new Request('http://localhost/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'sc01-order-created-001',
          event_type: 'order.created',
          source: 'order-service',
          subject: 'ord-1001',
          payload: { order_id: 'ord-1001', customer_id: 'cust-1', total_amount: '99.98' },
          target_url: 'https://receiver.example.com/events',
          max_retries: 3,
        }),
      }),
      testEnv
    );
    expect(ingestRes.status).toBe(201);
    const ingestBody: any = await ingestRes.json();
    expect(ingestBody.success).toBe(true);
    expect(ingestBody.duplicate).toBe(false);
    const eventId = ingestBody.event.id;
    expect(ingestBody.event.status).toBe('pending');

    // 2. Stub downstream receiver returns 200
    vi.stubGlobal(
      'fetch',
      makeFetchMock(() => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );

    // 3. Dispatch pending deliveries
    const dispatchRes = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    expect(dispatchRes.status).toBe(200);
    const dispatchBody: any = await dispatchRes.json();
    expect(dispatchBody.success).toBe(true);
    expect(dispatchBody.processed).toBe(1);
    expect(dispatchBody.delivered).toBe(1);
    expect(dispatchBody.details[0].status).toBe('delivered');
    expect(dispatchBody.details[0].httpStatus).toBe(200);

    // 4. Event marked delivered
    const getRes = await adminGet(`http://localhost/api/v1/events/${eventId}`);
    expect(getRes.status).toBe(200);
    const getBody: any = await getRes.json();
    expect(getBody.event.status).toBe('delivered');
    expect(getBody.event.delivered_at).not.toBeNull();

    // 5. Delivery attempt recorded
    const delRes = await adminGet(`http://localhost/api/v1/events/${eventId}/deliveries`);
    expect(delRes.status).toBe(200);
    const delBody: any = await delRes.json();
    expect(delBody.deliveries.length).toBe(1);
    expect(delBody.deliveries[0].http_status).toBe(200);
  });
});

describe('SC-02 Duplicate event with same idempotency key', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records exactly one logical event within the deduplication window', async () => {
    const payload = JSON.stringify({
      idempotency_key: 'sc02-dup-key-001',
      event_type: 'order.created',
      source: 'order-service',
      payload: { order_id: 'ord-2001' },
      target_url: 'https://receiver.example.com/events',
    });

    const r1 = await app.fetch(
      new Request('http://localhost/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }),
      testEnv
    );
    expect(r1.status).toBe(201);
    const b1: any = await r1.json();
    expect(b1.duplicate).toBe(false);

    const r2 = await app.fetch(
      new Request('http://localhost/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }),
      testEnv
    );
    expect(r2.status).toBe(202);
    const b2: any = await r2.json();
    expect(b2.duplicate).toBe(true);

    // Exactly one event row
    const count = await env.DB
      .prepare("SELECT COUNT(*) as count FROM events WHERE idempotency_key = ?")
      .bind('sc02-dup-key-001')
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});

describe('SC-03 Downstream unavailable then recovery', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries on 500 and delivers after recovery', async () => {
    const ingestRes = await app.fetch(
      new Request('http://localhost/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'sc03-retry-001',
          event_type: 'order.created',
          source: 'order-service',
          payload: { order_id: 'ord-3001' },
          target_url: 'https://receiver.example.com/events',
          max_retries: 3,
        }),
      }),
      testEnv
    );
    expect(ingestRes.status).toBe(201);
    const eventId = (await ingestRes.json()).event.id;

    let calls = 0;
    vi.stubGlobal(
      'fetch',
      makeFetchMock(() => {
        calls += 1;
        if (calls === 1) {
          return new Response('{"error":"down"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      })
    );

    // First dispatch: 500 -> retry scheduled, event still pending
    const d1 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    const b1: any = await d1.json();
    expect(b1.retried).toBe(1);
    expect(b1.delivered).toBe(0);

    const ev1: any = (await adminGet(`http://localhost/api/v1/events/${eventId}`).then((r) => r.json())).event;
    expect(ev1.status).toBe('pending');
    expect(ev1.retry_count).toBe(1);

    // Wait for backoff to elapse before retrying
    await sleep(3000);

    // Ensure event is pickable regardless of isolate time freeze
    await env.DB
      .prepare('UPDATE events SET next_retry_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(eventId)
      .run();

    // Second dispatch: recovery -> delivered
    const d2 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    const b2: any = await d2.json();
    expect(b2.delivered).toBe(1);

    const ev2: any = (await adminGet(`http://localhost/api/v1/events/${eventId}`).then((r) => r.json())).event;
    expect(ev2.status).toBe('delivered');
    expect(ev2.delivered_at).not.toBeNull();
  });
});

describe('SC-04 Poison message -> DLQ after exhausting retry budget', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves event to DLQ when retries are exhausted', async () => {
    const ingestRes = await app.fetch(
      new Request('http://localhost/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: 'sc04-poison-001',
          event_type: 'order.created',
          source: 'order-service',
          payload: { order_id: 'ord-4001' },
          target_url: 'https://receiver.example.com/events',
          max_retries: 2,
        }),
      }),
      testEnv
    );
    expect(ingestRes.status).toBe(201);
    const eventId = (await ingestRes.json()).event.id;

    vi.stubGlobal(
      'fetch',
      makeFetchMock(() => new Response('{"error":"poison"}', { status: 500, headers: { 'Content-Type': 'application/json' } }))
    );

    // Dispatch until DLQ (max_retries=2 => attempt 1 retry, attempt 2 -> dlq)
    const d1 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    expect((await d1.json()).retried).toBe(1);

    // Wait for backoff to elapse before the final attempt exhausts the budget
    await sleep(3000);

    const d2 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    const b2: any = await d2.json();
    expect(b2.dlq).toBe(1);

    const ev: any = (await (await adminGet(`http://localhost/api/v1/events/${eventId}`)).json()).event;
    expect(ev.status).toBe('dlq');

    const dlqRes = await app.fetch(new Request('http://localhost/api/v1/events/dlq', {
      headers: { 'X-API-Key': 'test-admin-key' },
    }), testEnv);
    expect(dlqRes.status).toBe(200);
    const dlqBody: any = await dlqRes.json();
    expect(dlqBody.dlq.length).toBe(1);
    expect(dlqBody.dlq[0].event_id).toBe(eventId);
  });
});

describe('SC-05 Outbox crash window: durable event not lost', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps event pending and recoverable when dispatch crashes before ack', async () => {
    const eventId = `evt-${crypto.randomUUID()}`;
    await env.DB
      .prepare(`
        INSERT INTO events (id, idempotency_key, event_type, source, subject, payload_json, payload_hash, target_url, status, retry_count, max_retries, next_retry_at, deduplication_window_seconds, created_at, updated_at)
        VALUES (?, 'sc05-crash-001', 'order.created', 'order-service', 'ord-5001', '{"order_id":"ord-5001"}', 'hash', 'https://receiver.example.com/events', 'pending', 0, 3, CURRENT_TIMESTAMP, 86400, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .bind(eventId)
      .run();

    // Dispatch crashes (network error) -> retryable, event stays pending (not lost)
    vi.stubGlobal(
      'fetch',
      makeFetchMock(() => {
        throw new TypeError('network down');
      })
    );
    const d1 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    const b1: any = await d1.json();
    expect(b1.retried).toBe(1);

    const ev1: any = (await (await adminGet(`http://localhost/api/v1/events/${eventId}`)).json()).event;
    expect(ev1.status).toBe('pending');
    expect(ev1.retry_count).toBe(1);

    // Wait for backoff to elapse before recovery attempt
    await sleep(3000);

    // Ensure event is pickable regardless of isolate time freeze
    await env.DB
      .prepare('UPDATE events SET next_retry_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(eventId)
      .run();

    // Recover: receiver now healthy
    vi.stubGlobal(
      'fetch',
      makeFetchMock(() => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );
    const d2 = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({ limit: 10 }),
      }),
      testEnv
    );
    const b2: any = await d2.json();
    expect(b2.delivered).toBe(1);

    const ev2: any = (await (await adminGet(`http://localhost/api/v1/events/${eventId}`)).json()).event;
    expect(ev2.status).toBe('delivered');
  });
});
