/**
 * Tier 1 - Feature Coverage: Webhook Deduplication Engine (Feature 4 / Requirement R1)
 *
 * Verifies atomic deduplication of GitHub webhooks based on X-GitHub-Delivery:
 * - First delivery succeeds (200/201)
 * - Duplicate delivery returns 202 Accepted with status "already_processed"
 * - Triple replay still returns 202 Accepted
 * - Missing delivery header rejected (400)
 * - Distinct delivery IDs processed independently
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Webhook Deduplication Engine';

export async function run(client) {
  const payload = FixtureLoader.generateWebhookPayload('deployment_event', {
    deployment: {
      id: 9902001,
      ref: 'v1.0.2',
      sha: crypto.randomBytes(20).toString('hex'),
      environment: 'kubernetes',
    },
  });

  const testDeliveryId = crypto.randomUUID();

  // Test 1: First delivery is processed normally (201 or 200)
  {
    const res = await client.sendWebhook('deployment', testDeliveryId, payload);
    assertTrue(res.status === 201 || res.status === 200, `First delivery should succeed, got ${res.status}`);
    assertEqual(res.data.delivery_id, testDeliveryId, 'Delivery ID should match');
  }

  // Test 2: Second delivery with IDENTICAL delivery ID returns 202 Accepted
  {
    const res = await client.sendWebhook('deployment', testDeliveryId, payload);
    assertStatus(res, 202, 'Duplicate delivery must return HTTP 202 Accepted');
    assertEqual(res.data.status, 'already_processed', 'Status must be "already_processed"');
    assertEqual(res.data.delivery_id, testDeliveryId, 'Delivery ID must match in 202 response');
  }

  // Test 3: Third replay also returns 202 Accepted idempotently
  {
    const res = await client.sendWebhook('deployment', testDeliveryId, payload);
    assertStatus(res, 202, 'Third duplicate delivery must still return HTTP 202 Accepted');
    assertEqual(res.data.status, 'already_processed');
  }

  // Test 4: Missing X-GitHub-Delivery header returns 400 Bad Request
  {
    const res = await client.sendWebhook('deployment', null, payload);
    assertStatus(res, 400, 'Webhook without X-GitHub-Delivery header must return 400 Bad Request');
  }

  // Test 5: Distinct delivery ID with identical payload body is accepted as new event
  {
    const distinctDeliveryId = crypto.randomUUID();
    const res = await client.sendWebhook('deployment', distinctDeliveryId, payload);
    assertTrue(res.status === 201 || res.status === 200, `Distinct delivery ID should succeed, got ${res.status}`);
    assertEqual(res.data.delivery_id, distinctDeliveryId);
  }
}
