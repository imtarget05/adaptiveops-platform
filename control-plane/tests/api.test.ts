import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { setupTestDatabase } from './helpers';

describe('Control Plane REST API & Quality Gates', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  const testEnv = {
    ...env,
    ADMIN_API_KEY: 'test-admin-key'
  };

  it('responds with UP on health check probes', async () => {
    const res1 = await app.fetch(new Request('http://localhost/'), testEnv);
    expect(res1.status).toBe(200);
    const body1: any = await res1.json();
    expect(body1.status).toBe('UP');

    const res2 = await app.fetch(new Request('http://localhost/healthz'), testEnv);
    expect(res2.status).toBe(200);
    const body2: any = await res2.json();
    expect(body2.status).toBe('UP');
  });

  it('lists seeded environments via GET /api/v1/environments', async () => {
    const res = await app.fetch(new Request('http://localhost/api/v1/environments'), testEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.environments).toBeInstanceOf(Array);
    expect(body.environments.length).toBeGreaterThanOrEqual(3);

    const k8s = body.environments.find((e: any) => e.id === 'kubernetes');
    expect(k8s).toBeDefined();
    expect(k8s.active_release_version).toBe('v1.0.0');
  });

  it('registers and retrieves releases via /api/v1/releases', async () => {
    // 1. Unauthorized POST without API key
    const unauthRes = await app.fetch(
      new Request('http://localhost/api/v1/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'v1.2.0', commit_sha: '1234567890123456789012345678901234567890' })
      }),
      testEnv
    );
    expect(unauthRes.status).toBe(401);

    // 2. Authorized POST with API key
    const authRes = await app.fetch(
      new Request('http://localhost/api/v1/releases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-admin-key'
        },
        body: JSON.stringify({
          version: 'v1.2.0',
          commit_sha: '1234567890123456789012345678901234567890',
          branch: 'release/v1.2',
          git_author: 'lead-dev',
          commit_message: 'feat: payment webhook integration'
        })
      }),
      testEnv
    );
    expect(authRes.status).toBe(201);
    const created: any = await authRes.json();
    expect(created.release.version).toBe('v1.2.0');

    // 3. GET /api/v1/releases
    const listRes = await app.fetch(new Request('http://localhost/api/v1/releases'), testEnv);
    expect(listRes.status).toBe(200);
    const listBody: any = await listRes.json();
    expect(listBody.releases.some((r: any) => r.version === 'v1.2.0')).toBe(true);
  });

  it('creates, lists, and updates deployments via /api/v1/deployments', async () => {
    // Create deployment
    const createRes = await app.fetch(
      new Request('http://localhost/api/v1/deployments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-admin-key'
        },
        body: JSON.stringify({
          environment: 'kubernetes',
          version: 'v1.0.0',
          strategy: 'rolling',
          deployed_by: 'ci-runner'
        })
      }),
      testEnv
    );
    expect(createRes.status).toBe(201);
    const createBody: any = await createRes.json();
    const depId = createBody.deployment.id;
    expect(depId).toBeDefined();

    // Update deployment status to success
    const patchRes = await app.fetch(
      new Request(`http://localhost/api/v1/deployments/${depId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-admin-key'
        },
        body: JSON.stringify({
          status: 'success',
          message: 'Rolling update completed across all pods'
        })
      }),
      testEnv
    );
    expect(patchRes.status).toBe(200);
    const patchBody: any = await patchRes.json();
    expect(patchBody.deployment.status).toBe('success');
  });

  it('records and queries immutable audit logs via /api/v1/audit and /api/v1/audit-logs', async () => {
    // Record audit event
    const postRes = await app.fetch(
      new Request('http://localhost/api/v1/audit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-admin-key'
        },
        body: JSON.stringify({
          actor: 'secops-auditor',
          action: 'SECURITY_AUDIT_COMPLETED',
          environment: 'kubernetes',
          details: { passed_rules: 42, score: 100 }
        })
      }),
      testEnv
    );
    expect(postRes.status).toBe(201);
    const postBody: any = await postRes.json();
    expect(postBody.audit_id).toBeDefined();

    // Query audit logs via /api/v1/audit
    const getRes = await app.fetch(new Request('http://localhost/api/v1/audit?action=SECURITY_AUDIT_COMPLETED'), testEnv);
    expect(getRes.status).toBe(200);
    const getBody: any = await getRes.json();
    expect(getBody.audit_logs.length).toBe(1);
    expect(getBody.audit_logs[0].actor).toBe('secops-auditor');

    // Query audit logs via /api/v1/audit-logs
    const logsRes = await app.fetch(new Request('http://localhost/api/v1/audit-logs'), testEnv);
    expect(logsRes.status).toBe(200);
    const logsBody: any = await logsRes.json();
    expect(logsBody.audit_logs.length).toBeGreaterThanOrEqual(1);
  });
});
