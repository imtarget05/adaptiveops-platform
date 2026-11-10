// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { setupTestDatabase } from './helpers';

const testEnv = {
  ...env,
  ENVIRONMENT: 'local',
  ADMIN_API_KEY: 'test-admin-key',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret-for-release-safety'
};

async function req(method, path, body) {
  return app.fetch(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    testEnv
  );
}

async function seedLocalEnvironment() {
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO environments (id, name, type, target_version, current_health_status, active_release_id)
       VALUES ('local','local','local','2.0.0','healthy','rel-v2')`
    )
    .run();
  await env.DB
    .prepare(
      `UPDATE environments SET target_version='2.0.0', current_health_status='healthy', active_release_id='rel-v2' WHERE id='local'`
    )
    .run();
}

async function seedReleases() {
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO releases (id, version, commit_sha, git_author, schema_compatible)
       VALUES ('rel-v1','1.0.0','abc111','ci',1),('rel-v2','2.0.0','abc222','ci',1)`
    )
    .run();
}

async function seedDeployments() {
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO deployments (id, release_id, environment_id, status, trigger_type, deployed_by, target_profile, started_at, completed_at)
       VALUES ('dep-v1','rel-v1','local','success','rollback','ci','local',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
              ('dep-v2','rel-v2','local','failure','webhook','ci','local',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
    )
    .run();
}

describe('SC-06 Broken release → rollback to known-good version', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    await seedLocalEnvironment();
    await seedReleases();
    await seedDeployments();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rolls back to the previous successful release when the active one fails', async () => {
    const res = await req('POST', '/rollback', {
      environment: 'local',
      reason: 'Business regression detected by smoke test',
      triggered_by: 'smoke-test-controller',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(['1.0.0','v1.0.0']).toContain(body.target_version);
    expect(body.target_release_id).toMatch(/rel-v1/);
    expect(body.status).toBe('initiated');

    const envRow = await env.DB
      .prepare('SELECT target_version FROM environments WHERE id = ?')
      .bind('local')
      .first();
    expect(['1.0.0','v1.0.0']).toContain(envRow.target_version);
    const rollbackDeployment = await env.DB.prepare('SELECT status FROM deployments WHERE id = ?').bind(body.deployment_id).first();
    expect(rollbackDeployment.status).toBe('in_progress');
  });
});

describe('SC-07 Concurrent deployments → release locking/fencing', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    await env.DB
      .prepare(`INSERT INTO environments (id, name, type) VALUES ('test-local','test-local','local')`)
      .run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('serializes concurrent deployments: second lock attempt is rejected', async () => {
    const first = await req('POST', '/release-locks', {
      environment: 'local',
      locked_by: 'deploy-a',
    });
    expect(first.status).toBe(201);
    const b1 = await first.json();
    expect(b1.success).toBe(true);
    expect(b1.acquired).toBe(true);

    const second = await req('POST', '/release-locks', {
      environment: 'local',
      locked_by: 'deploy-b',
    });
    expect(second.status).toBe(409);
    const b2 = await second.json();
    expect(b2.success).toBe(false);
    expect(b2.acquired).toBe(false);

    const check = await app.fetch(
      new Request('http://localhost/api/v1/release-locks/local/check'),
      testEnv
    );
    expect(check.status).toBe(200);
    const bc = await check.json();
    expect(bc.locked).toBe(true);

    const del = await req('DELETE', '/release-locks/local');
    expect(del.status).toBe(200);

    const check2 = await app.fetch(
      new Request('http://localhost/api/v1/release-locks/local/check'),
      testEnv
    );
    const bc2 = await check2.json();
    expect(bc2.locked).toBe(false);

    const third = await req('POST', '/release-locks', {
      environment: 'local',
      locked_by: 'deploy-c',
    });
    expect(third.status).toBe(201);
    const b3 = await third.json();
    expect(b3.acquired).toBe(true);
  });
});

describe('SC-08 Incompatible schema migration → rollback refused unless forced', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO environments (id, name, type, active_release_id)
         VALUES ('local','local','local','rel-v1.0.0')`
      )
      .run();
    await env.DB
      .prepare(
        `UPDATE environments SET active_release_id='rel-v1.0.0' WHERE id='local'`
      )
      .run();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO releases (id, version, commit_sha, git_author, schema_compatible)
         VALUES ('rel-incompat','3.0.0','abc333','ci',0)`
      )
      .run();
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO deployments (id, release_id, environment_id, status, trigger_type, deployed_by, target_profile, started_at, completed_at)
         VALUES ('dep-incompat','rel-incompat','local','success','webhook','ci','local',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`
      )
      .run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses rollback to a schema-incompatible release by default', async () => {
    const res = await req('POST', '/rollback', {
      environment: 'local',
      reason: 'attempting rollback over migrated schema',
      triggered_by: 'operator',
      force: false,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.message).toMatch(/schema-compatible|No valid rollback candidate/);
  });

  it('allows rollback when explicitly forced', async () => {
    const res = await req('POST', '/rollback', {
      environment: 'local',
      target_version: '3.0.0',
      reason: 'forced rollback after incident review',
      triggered_by: 'operator',
      force: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.target_version).toBe('3.0.0');
  });
});

describe('SC-09 Fail-closed: unauthorized control-plane operations are rejected', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
    await env.DB
      .prepare(`INSERT OR IGNORE INTO environments (id, name, type) VALUES ('test-local','test-local','local')`)
      .run();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects release-lock acquisition without admin API key', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/release-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: 'local', locked_by: 'operator' }),
      }),
      { ...env }
    );
    expect(res.status).toBe(401);
  });

  it('does not expose event payloads without admin API key', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/events'),
      { ...env }
    );
    expect(res.status).toBe(401);
  });

  it('rejects dispatch without admin API key', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/events/deliveries/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      }),
      { ...env }
    );
    expect(res.status).toBe(401);
  });
});

describe('SC-10 Security attacks → rejected and logged', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('blocks SSRF via cloud metadata IP target_url', async () => {
    const res = await app.fetch(
      new Request(
        'http://localhost/api/v1/events/target/validate?url=http://169.254.169.254/latest/meta-data/'
      ),
      testEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(body.reason).toContain('SSRF');
  });

  it('allows localhost target_url for local development', async () => {
    const res = await app.fetch(
      new Request(
        'http://localhost/api/v1/events/target/validate?url=http://localhost:8080/actuator/health'
      ),
      testEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);
  });

  it('rejects invalid HMAC webhook signature (401)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'deployment',
          'X-Hub-Signature-256': 'sha256=deadbeef',
          'X-GitHub-Delivery': 'test-delivery-001',
        },
        body: JSON.stringify({ deployment: { status: 'success' } }),
      }),
      testEnv
    );
    expect(res.status).toBe(401);
  });
});
