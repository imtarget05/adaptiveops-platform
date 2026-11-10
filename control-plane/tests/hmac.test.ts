import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { computeGitHubSignature } from '../src/services/cryptoService';
import { setupTestDatabase } from './helpers';

describe('HMAC-SHA256 Cryptographic Verification', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  const secret = 'test-webhook-secret-32-bytes-long';
  const testEnv = {
    ...env,
    GITHUB_WEBHOOK_SECRET: secret
  };

  it('accepts webhooks with valid constant-time HMAC-SHA256 signature', async () => {
    const payload = JSON.stringify({
      deployment: {
        id: 1001,
        sha: 'a1b2c3d4e5f67890123456789abcdef012345678',
        ref: 'refs/tags/v1.0.1',
        environment: 'kubernetes',
        creator: { login: 'ci-runner' }
      }
    });

    const signature = await computeGitHubSignature(secret, payload);

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-valid-hmac-001',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.delivery_id).toBe('del-test-valid-hmac-001');
  });

  it('rejects tampered payload with 401 Unauthorized', async () => {
    const originalPayload = JSON.stringify({ action: 'original' });
    const tamperedPayload = JSON.stringify({ action: 'tampered-payload-attack' });
    const signature = await computeGitHubSignature(secret, originalPayload);

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-tampered-002',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: tamperedPayload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(401);
    const body: any = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects missing X-Hub-Signature-256 header with 401 Unauthorized', async () => {
    const payload = JSON.stringify({ action: 'no-sig' });

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-missing-sig-003',
        'X-GitHub-Event': 'deployment'
      },
      body: payload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it('fails closed when the GitHub webhook secret is not configured', async () => {
    const payload = JSON.stringify({ action: 'unconfigured-secret' });
    const signature = await computeGitHubSignature('dev-webhook-secret', payload);
    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-no-configured-secret',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });

    const res = await app.fetch(req, { ...env, GITHUB_WEBHOOK_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it('rejects malformed signature header without sha256= prefix with 401 Unauthorized', async () => {
    const payload = JSON.stringify({ action: 'bad-prefix' });

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-bad-prefix-004',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': 'md5=abcdef123456'
      },
      body: payload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });

  it('rejects missing X-GitHub-Delivery header with 400 Bad Request', async () => {
    const payload = JSON.stringify({ action: 'missing-delivery-header' });
    const signature = await computeGitHubSignature(secret, payload);

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBe('Bad Request');
  });

  it('accepts empty payload with valid HMAC signature on ping event without 500 error', async () => {
    const emptyPayload = '';
    const signature = await computeGitHubSignature(secret, emptyPayload);

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-empty-ping-005',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': signature
      },
      body: emptyPayload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.event).toBe('ping');
  });

  it('returns 400 Bad Request on malformed JSON payload with valid HMAC signature', async () => {
    const malformedPayload = '{ "event": "deployment", unquoted_broken ';
    const signature = await computeGitHubSignature(secret, malformedPayload);

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-malformed-json-006',
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: malformedPayload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBe('Bad Request');
    expect(body.message).toContain('Malformed JSON payload');
  });

  it('accepts signature header with surrounding whitespace padding', async () => {
    const payload = JSON.stringify({ action: 'ping' });
    const signature = await computeGitHubSignature(secret, payload);
    const paddedSig = `   ${signature}   `;

    const req = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': 'del-test-padded-sig-007',
        'X-GitHub-Event': 'ping',
        'X-Hub-Signature-256': paddedSig
      },
      body: payload
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
  });
});
