import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { setupTestDatabase } from './helpers';

describe('Health Metrics Ingestion & Sliding-Window Status', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  const testEnv = {
    ...env,
    ADMIN_API_KEY: 'test-admin-key'
  };

  it('records healthy probe and maintains healthy environment status', async () => {
    const payload = {
      environment: 'kubernetes',
      service_name: 'order-service',
      http_status: 200,
      latency_ms: 35,
      status: 'healthy',
      probe_type: 'readiness',
      details: { db: 'UP', rabbitmq: 'UP' }
    };

    const req = new Request('http://localhost/api/v1/health', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key'
      },
      body: JSON.stringify(payload)
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.acknowledged).toBe(true);
    expect(body.environment_status).toBe('healthy');
    expect(body.consecutive_failures).toBe(0);

    // Verify stored in D1
    const metric = await env.DB.prepare('SELECT * FROM health_metrics WHERE environment_id = ?')
      .bind('kubernetes')
      .first<any>();
    expect(metric).not.toBeNull();
    expect(metric.http_status).toBe(200);
  });

  it('transitions environment to unhealthy on 3 consecutive failures or failing smoke test', async () => {
    // Probe 1: failure
    await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'kubernetes',
          http_status: 503,
          latency_ms: 500,
          status: 'unhealthy',
          probe_type: 'readiness'
        })
      }),
      testEnv
    );

    // Probe 2: failure
    await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'kubernetes',
          http_status: 503,
          latency_ms: 600,
          status: 'unhealthy',
          probe_type: 'readiness'
        })
      }),
      testEnv
    );

    // Probe 3: failure (triggers unhealthy threshold)
    const res3 = await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'kubernetes',
          http_status: 500,
          latency_ms: 800,
          status: 'unhealthy',
          probe_type: 'readiness'
        })
      }),
      testEnv
    );

    const body3: any = await res3.json();
    expect(body3.environment_status).toBe('unhealthy');
    expect(body3.consecutive_failures).toBe(3);

    // Verify environment record updated
    const envRow = await env.DB.prepare('SELECT current_health_status, consecutive_failures FROM environments WHERE id = ?')
      .bind('kubernetes')
      .first<any>();
    expect(envRow.current_health_status).toBe('unhealthy');
    expect(envRow.consecutive_failures).toBe(3);

    // Verify audit log alert was generated
    const auditRow = await env.DB.prepare("SELECT * FROM audit_logs WHERE action = 'HEALTH_ALERT_UNHEALTHY' AND environment_id = ?")
      .bind('kubernetes')
      .first<any>();
    expect(auditRow).not.toBeNull();
  });

  it('smoke test failure triggers immediate unhealthy status', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'local',
          http_status: 500,
          latency_ms: 120,
          status: 'unhealthy',
          probe_type: 'smoke',
          details: { assertion: 'Order creation returned 500 internal server error' }
        })
      }),
      testEnv
    );

    const body: any = await res.json();
    expect(body.environment_status).toBe('unhealthy');

    const envRow = await env.DB.prepare('SELECT current_health_status FROM environments WHERE id = ?')
      .bind('local')
      .first<any>();
    expect(envRow.current_health_status).toBe('unhealthy');
  });

  it('transitions environment to degraded when latency exceeds 1000ms threshold', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'kubernetes',
          http_status: 200,
          latency_ms: 1200, // > 1000ms degradation threshold
          status: 'healthy',
          probe_type: 'readiness'
        })
      }),
      testEnv
    );

    const body: any = await res.json();
    expect(body.environment_status).toBe('degraded');

    const envRow = await env.DB.prepare('SELECT current_health_status FROM environments WHERE id = ?')
      .bind('kubernetes')
      .first<any>();
    expect(envRow.current_health_status).toBe('degraded');
  });

  it('handles burst probes deterministically with rowid DESC secondary ordering', async () => {
    // Insert 4 healthy probes followed by 1 unhealthy probe in the same millisecond/second
    for (let i = 0; i < 4; i++) {
      await app.fetch(
        new Request('http://localhost/api/v1/health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
          body: JSON.stringify({
            environment: 'cloudflare',
            http_status: 200,
            latency_ms: 30,
            status: 'healthy',
            probe_type: 'readiness'
          })
        }),
        testEnv
      );
    }

    const lastRes = await app.fetch(
      new Request('http://localhost/api/v1/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
        body: JSON.stringify({
          environment: 'cloudflare',
          http_status: 500,
          latency_ms: 50,
          status: 'unhealthy',
          probe_type: 'readiness'
        })
      }),
      testEnv
    );

    const body: any = await lastRes.json();
    // 1 failure in 5 probes should evaluate to degraded
    expect(body.environment_status).toBe('degraded');
    expect(body.consecutive_failures).toBe(1);
  });
});
