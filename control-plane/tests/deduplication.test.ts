import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../src/index';
import { computeGitHubSignature } from '../src/services/cryptoService';
import { setupTestDatabase } from './helpers';

describe('Webhook Deduplication & Replay Protection', () => {
  beforeEach(async () => {
    await setupTestDatabase(env.DB);
  });

  const secret = 'dedup-secret-key-32-bytes-test';
  const testEnv = {
    ...env,
    GITHUB_WEBHOOK_SECRET: secret
  };

  it('processes first delivery and rejects duplicate delivery with HTTP 202 Accepted', async () => {
    const deliveryId = 'delivery-unique-guid-0099';
    const payload = JSON.stringify({
      deployment: {
        id: 9901,
        sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ref: 'refs/tags/v1.1.0',
        environment: 'kubernetes',
        creator: { login: 'ci-bot' }
      }
    });

    const signature = await computeGitHubSignature(secret, payload);

    // First delivery
    const req1 = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': deliveryId,
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });

    const res1 = await app.fetch(req1, testEnv);
    expect(res1.status).toBe(200);
    const body1: any = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.delivery_id).toBe(deliveryId);

    // Verify delivery saved in D1
    const deliveryRow = await env.DB.prepare('SELECT * FROM webhook_deliveries WHERE delivery_id = ?')
      .bind(deliveryId)
      .first<any>();
    expect(deliveryRow).not.toBeNull();
    expect(deliveryRow.status).toBe('processed');

    // Second delivery: identical X-GitHub-Delivery (Replay Attempt)
    const req2 = new Request('http://localhost/api/v1/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Delivery': deliveryId,
        'X-GitHub-Event': 'deployment',
        'X-Hub-Signature-256': signature
      },
      body: payload
    });

    const res2 = await app.fetch(req2, testEnv);
    expect(res2.status).toBe(202);
    const body2: any = await res2.json();
    expect(body2.status).toBe('already_processed');
    expect(body2.delivery_id).toBe(deliveryId);

    // Ensure only 1 record exists in webhook_deliveries for this ID
    const countRow = await env.DB.prepare('SELECT COUNT(*) as count FROM webhook_deliveries WHERE delivery_id = ?')
      .bind(deliveryId)
      .first<{ count: number }>();
    expect(countRow?.count).toBe(1);

    // Ensure only 1 deployment was created for this GitHub deployment
    const depCount = await env.DB.prepare('SELECT COUNT(*) as count FROM deployments WHERE github_deployment_id = ?')
      .bind(9901)
      .first<{ count: number }>();
    expect(depCount?.count).toBe(1);
  });
});
