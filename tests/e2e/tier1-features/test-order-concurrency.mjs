/**
 * Tier 1 - Feature Coverage: Concurrency & Optimistic Locking (Feature 13 / Requirement R2)
 *
 * Verifies JPA @Version optimistic locking and HTTP 409 Conflict handling:
 * - Update with stale version triggers HTTP 409 Conflict
 * - RFC 7807 Problem Details returned on conflict
 * - If-Match header support
 * - If-Match version collision triggers 409 Conflict
 * - Re-fetching current version allows subsequent update to proceed
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Concurrency & Optimistic Locking';

export async function run(client) {
  // Setup: create order
  const orderPayload = FixtureLoader.generateRandomOrder();
  const res = await client.createOrder(orderPayload, crypto.randomUUID());
  assertStatus(res, 201);
  const orderId = res.data.id;
  assertEqual(res.data.version, 0);

  // Test 1: Stale version returns 409 Conflict
  {
    // Pretend client thought version was 5
    const conflictRes = await client.updateOrderStatus(orderId, 'PENDING', 5);
    assertStatus(conflictRes, 409, 'Version collision must return HTTP 409 Conflict');
    assertIncludes(conflictRes.data.title || conflictRes.data.error, 'Lock', 'Problem title should indicate lock failure');
  }

  // Test 2: Valid update advances version to 1
  {
    const updateRes = await client.updateOrderStatus(orderId, 'PENDING', 0);
    assertStatus(updateRes, 200);
    assertEqual(updateRes.data.version, 1);
  }

  // Test 3: Attempting update with old version (0) again returns 409 Conflict
  {
    const staleRes = await client.updateOrderStatus(orderId, 'APPROVED', 0);
    assertStatus(staleRes, 409, 'Using version 0 after increment to 1 must return 409 Conflict');
  }

  // Test 4: Using If-Match header with correct version succeeds
  {
    const ifMatchRes = await client.updateOrderStatus(orderId, 'APPROVED', 1, 1);
    assertStatus(ifMatchRes, 200);
    assertEqual(ifMatchRes.data.version, 2);
  }

  // Test 5: Using If-Match header with stale version returns 409 Conflict
  {
    const badIfMatchRes = await client.updateOrderStatus(orderId, 'COMPLETED', 1, 1);
    assertStatus(badIfMatchRes, 409, 'Stale If-Match header must trigger 409 Conflict');
  }
}
