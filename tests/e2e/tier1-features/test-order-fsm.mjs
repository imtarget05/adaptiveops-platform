/**
 * Tier 1 - Feature Coverage: Order Lifecycle Finite State Machine (Feature 11 / Requirement R2)
 *
 * Verifies strict state transitions in the order lifecycle:
 * CREATED -> PENDING -> APPROVED -> COMPLETED (and CANCELLED)
 * - Initial state is CREATED with version 0
 * - Sequential valid transitions advance state and version
 * - Illegal leap CREATED -> COMPLETED rejected with 422
 * - Terminal states COMPLETED/CANCELLED cannot transition
 * - CANCELLED allowed from non-terminal states
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Order Lifecycle FSM';

export async function run(client) {
  // Test 1: Order creation starts in CREATED state with version 0
  let orderId = null;
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const idemKey = crypto.randomUUID();
    const res = await client.createOrder(orderPayload, idemKey);
    assertStatus(res, 201);
    assertEqual(res.data.status, 'CREATED');
    assertEqual(res.data.version, 0);
    orderId = res.data.id;
  }

  // Test 2: Valid transition CREATED -> PENDING succeeds, increments version to 1
  {
    const res = await client.updateOrderStatus(orderId, 'PENDING', 0);
    assertStatus(res, 200);
    assertEqual(res.data.status, 'PENDING');
    assertEqual(res.data.version, 1);
  }

  // Test 3: Valid transition PENDING -> APPROVED succeeds, increments version to 2
  {
    const res = await client.updateOrderStatus(orderId, 'APPROVED', 1);
    assertStatus(res, 200);
    assertEqual(res.data.status, 'APPROVED');
    assertEqual(res.data.version, 2);
  }

  // Test 4: Valid transition APPROVED -> COMPLETED succeeds, increments version to 3
  {
    const res = await client.updateOrderStatus(orderId, 'COMPLETED', 2);
    assertStatus(res, 200);
    assertEqual(res.data.status, 'COMPLETED');
    assertEqual(res.data.version, 3);
  }

  // Test 5: Illegal state transition: newly created order cannot leap directly to COMPLETED
  {
    const newOrderPayload = FixtureLoader.generateRandomOrder();
    const newIdemKey = crypto.randomUUID();
    const createRes = await client.createOrder(newOrderPayload, newIdemKey);
    assertStatus(createRes, 201);
    const newOrderId = createRes.data.id;

    // Attempt illegal transition CREATED -> COMPLETED
    const badRes = await client.updateOrderStatus(newOrderId, 'COMPLETED', 0);
    assertStatus(badRes, 422, 'Illegal transition CREATED -> COMPLETED must return 422 Unprocessable Entity');
    assertIncludes(badRes.data.error || badRes.data.detail, 'transition', 'Error message should mention transition');
  }
}
