import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { setupTestDatabase } from './helpers';

describe('Controlled Rollback Engine & Candidate Discovery', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);

    // Simulate deployment of release v2.0.0 onto kubernetes
    await env.DB.prepare(`
      INSERT INTO releases (id, version, commit_sha, git_author, commit_message, container_image_tag)
      VALUES ('rel-v2.0.0', 'v2.0.0', '2222222222222222222222222222222222222222', 'developer', 'feat: v2 release', 'adaptiveops/order-service:v2.0.0')
    `).run();

    await env.DB.prepare(`
      INSERT INTO deployments (id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, started_at)
      VALUES ('dep-v2-k8s', 'rel-v2.0.0', 'kubernetes', 'in_progress', 'rolling', 'webhook', 'ci-bot', 'kubernetes', CURRENT_TIMESTAMP)
    `).run();

    await env.DB.prepare(`
      UPDATE environments 
      SET active_release_id = 'rel-v2.0.0', target_version = 'v2.0.0', current_health_status = 'unhealthy' 
      WHERE id = 'kubernetes'
    `).run();
  });

  const testEnv = {
    ...env,
    ADMIN_API_KEY: 'test-admin-key'
  };

  it('discovers previous known-healthy release candidate', async () => {
    const req = new Request('http://localhost/api/v1/rollback/candidates/kubernetes', {
      method: 'GET'
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.environment).toBe('kubernetes');
    expect(body.current_release.version).toBe('v2.0.0');
    expect(body.candidate_release).not.toBeNull();
    expect(body.candidate_release.version).toBe('v1.0.0');
    expect(body.candidate_release.release_id).toBe('rel-v1.0.0');
    expect(body.candidate_release.rollback_safe).toBe(true);
  });

  it('executes atomic controlled rollback via environment endpoint', async () => {
    const req = new Request('http://localhost/api/v1/environments/kubernetes/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key'
      },
      body: JSON.stringify({
        reason: 'Automated smoke test failure detected on v2.0.0',
        triggered_by: 'automated-health-monitor'
      })
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.target_version).toBe('v1.0.0');
    expect(body.status).toBe('initiated');
    expect(body.rollback_id).toBeDefined();

    // Verify D1 state changes
    // 1. Previous deployment stays in its existing state until an actuator reports a terminal result.
    const oldDep = await env.DB.prepare('SELECT status FROM deployments WHERE id = ?')
      .bind('dep-v2-k8s')
      .first<any>();
    expect(oldDep.status).toBe('in_progress');

    // 2. New rollback deployment created
    const newDep = await env.DB.prepare('SELECT * FROM deployments WHERE id = ?')
      .bind(body.deployment_id)
      .first<any>();
    expect(newDep).not.toBeNull();
    expect(newDep.trigger_type).toBe('rollback');
    expect(newDep.release_id).toBe('rel-v1.0.0');
    expect(newDep.status).toBe('in_progress');

    // A rollback request records the intended target without claiming actuator success.
    const envRow = await env.DB.prepare('SELECT target_version FROM environments WHERE id = ?')
      .bind('kubernetes')
      .first<any>();
    expect(envRow.target_version).toBe('v1.0.0');

    // 4. Immutable audit log recorded
    const auditRow = await env.DB.prepare("SELECT * FROM audit_logs WHERE action = 'ROLLBACK_TRIGGERED' AND environment_id = ?")
      .bind('kubernetes')
      .first<any>();
    expect(auditRow).not.toBeNull();
    expect(auditRow.actor).toBe('automated-health-monitor');
  });

  it('executes controlled rollback via /api/v1/rollback endpoint', async () => {
    const req = new Request('http://localhost/api/v1/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key'
      },
      body: JSON.stringify({
        environment: 'kubernetes',
        target_version: 'v1.0.0',
        reason: 'Manual operator rollback',
        triggered_by: 'operator@adaptiveops.internal'
      })
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.target_version).toBe('v1.0.0');
    expect(body.audit_log_id).toBeDefined();
  });

  it('returns null candidate for environment with zero deployments (no fake fallback)', async () => {
    // 'aws' is seeded with no deployments in seed data
    const req = new Request('http://localhost/api/v1/rollback/candidates/aws', {
      method: 'GET'
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.environment).toBe('aws');
    expect(body.candidate_release).toBeNull();
  });

  it('fails gracefully with 422 when rollback is attempted with no candidate available', async () => {
    const req = new Request('http://localhost/api/v1/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key'
      },
      body: JSON.stringify({
        environment: 'aws',
        reason: 'Rollback without candidate'
      })
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(422);
    const body: any = await res.json();
    expect(body.error).toContain('No valid rollback candidate found');
  });

  it('fails with 404 when rollback is attempted on non-existent environment', async () => {
    const req = new Request('http://localhost/api/v1/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'test-admin-key'
      },
      body: JSON.stringify({
        environment: 'non-existent-cluster',
        reason: 'Rollback non-existent'
      })
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(404);
  });
});
