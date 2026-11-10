/**
 * Tier 1 - Feature Coverage: Webhook HMAC-SHA256 Verification (Feature 3 / Requirement R1)
 *
 * Verifies cryptographic verification of GitHub webhooks:
 * - Valid signature acceptance (200/201)
 * - Tampered body rejection (401)
 * - Wrong secret rejection (401)
 * - Missing signature header rejection (400)
 * - Malformed signature header rejection (401)
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Webhook HMAC-SHA256 Verification';

export async function run(client) {
  const payload = FixtureLoader.generateWebhookPayload('deployment_event', {
    deployment: {
      id: 9901001,
      ref: 'v1.0.1-rc1',
      sha: crypto.randomBytes(20).toString('hex'),
      environment: 'kubernetes',
    },
  });

  // Test 1: Valid signature produces 201/200 OK
  {
    const deliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('deployment', deliveryId, payload);
    assertTrue(res.status === 201 || res.status === 200, `Valid webhook should return 200 or 201, got ${res.status}`);
    assertEqual(res.data.delivery_id, deliveryId, 'Response should confirm delivery_id');
  }

  // Test 2: Tampered payload body produces 401 Unauthorized
  {
    const deliveryId = crypto.randomUUID();
    const rawBody = JSON.stringify(payload);
    // Sign the original body
    const validSignature = client.computeHmacSignature(rawBody);
    // Tamper the body sent over wire
    const tamperedBody = rawBody.replace('v1.0.1-rc1', 'v1.0.1-hacked');

    const res = await client.sendWebhook('deployment', deliveryId, tamperedBody, {
      signature: validSignature,
    });
    assertStatus(res, 401, 'Tampered payload body must fail signature check and return 401 Unauthorized');
    assertIncludes(res.data.error || res.data.detail, 'signature', 'Error should mention signature');
  }

  // Test 3: Signature computed with wrong secret produces 401 Unauthorized
  {
    const deliveryId = crypto.randomUUID();
    const wrongSignature = client.computeHmacSignature(payload, 'wrong-secret-token-key');
    const res = await client.sendWebhook('deployment', deliveryId, payload, {
      signature: wrongSignature,
    });
    assertStatus(res, 401, 'Signature with incorrect secret must return 401 Unauthorized');
  }

  // Test 4: Missing X-Hub-Signature-256 header produces 400 Bad Request
  {
    const deliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('deployment', deliveryId, payload, {
      signature: null,
    });
    assertStatus(res, 400, 'Missing signature header must return 400 Bad Request');
  }

  // Test 5: Malformed signature header format produces 401 Unauthorized
  {
    const deliveryId = crypto.randomUUID();
    const malformedSignatures = [
      'invalid-format-without-sha256-prefix',
      'sha256=1234', // too short
      'sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // invalid hex
    ];

    for (const badSig of malformedSignatures) {
      const res = await client.sendWebhook('deployment', deliveryId, payload, {
        signature: badSig,
      });
      assertStatus(res, 401, `Malformed signature "${badSig}" must return 401 Unauthorized`);
    }
  }
}
