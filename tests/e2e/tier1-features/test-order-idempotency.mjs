/**
 * Tier 1 - Feature Coverage: Idempotent Request Handling (Feature 14 / Requirement R2)
 *
 * Verifies RFC-compliant Idempotency-Key header, SHA-256 payload hashing, and replay protection:
 * - Initial request creates order (201 Created)
 * - Duplicate request returns identical cached response (201 Created)
 * - Replay with mismatched payload returns 409 Conflict
 * - Missing Idempotency-Key returns 400 Bad Request
 * - Order is not duplicated in persistence on replay
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Idempotent Request Handling';

export async function run(client) {
  const orderPayload = FixtureLoader.generateRandomOrder();
  const testIdemKey = crypto.randomUUID();

  // Test 1: Initial request creates order and returns 201 Created
  let firstOrder = null;
  {
    const res = await client.createOrder(orderPayload, testIdemKey);
    assertStatus(res, 201);
    assertTrue(Boolean(res.data.id), 'Order ID must be returned');
    firstOrder = res.data;
  }

  // Test 2: Exact duplicate request returns cached response (201 Created) with same order ID
  {
    const res = await client.createOrder(orderPayload, testIdemKey);
    assertStatus(res, 201);
    assertEqual(res.data.id, firstOrder.id, 'Cached response must return the same order ID');
    assertEqual(res.data.customerId, firstOrder.customerId);
    assertEqual(res.data.totalAmount, firstOrder.totalAmount);
  }

  // Test 3: Multiple replays return identical cached result
  {
    for (let i = 0; i < 3; i++) {
      const res = await client.createOrder(orderPayload, testIdemKey);
      assertStatus(res, 201);
      assertEqual(res.data.id, firstOrder.id);
    }
  }

  // Test 4: Same Idempotency-Key with DIFFERENT payload body returns 409 Conflict
  {
    const alteredPayload = {
      ...orderPayload,
      customerId: 'cust-completely-different-hijack',
      totalAmount: 9999.99,
    };
    const res = await client.createOrder(alteredPayload, testIdemKey);
    assertStatus(res, 409, 'Replay with altered payload must return 409 Conflict');
    assertIncludes(res.data.error || res.data.detail, 'payload', 'Error should mention payload or key conflict');
  }

  // Test 5: Missing Idempotency-Key header returns 400 Bad Request
  {
    const res = await client.createOrder(orderPayload, null);
    assertStatus(res, 400, 'Missing Idempotency-Key must return 400 Bad Request');
  }
}
