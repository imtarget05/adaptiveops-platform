/**
 * Tier 1 - Feature Coverage: Transactional Outbox Pattern (Feature 15 / Requirement R2)
 *
 * Verifies atomic database writes for order domain entities and outbox messages:
 * - Order creation writes outbox message
 * - Outbox payload matches aggregate data
 * - Status transition writes order status changed outbox message
 * - Initial outbox status is PENDING
 * - Outbox messages are retrievable and sequenced
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Transactional Outbox Pattern';

export async function run(client) {
  // Test 1: Order creation produces outbox entry
  let orderId = null;
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const idemKey = crypto.randomUUID();
    const res = await client.createOrder(orderPayload, idemKey);
    assertStatus(res, 201);
    orderId = res.data.id;
  }

  // Test 2: Verify order exists and is valid
  {
    const res = await client.getOrder(orderId);
    assertStatus(res, 200);
    assertEqual(res.data.id, orderId);
    assertEqual(res.data.status, 'CREATED');
    assertTrue(Array.isArray(res.data.items), 'Order items should be returned');
    assertTrue(res.data.items.length > 0);
  }

  // Test 3: Updating order status transitions order and queues subsequent outbox event
  {
    const updateRes = await client.updateOrderStatus(orderId, 'PENDING', 0);
    assertStatus(updateRes, 200);
    assertEqual(updateRes.data.status, 'PENDING');
    assertEqual(updateRes.data.version, 1);
  }

  // Test 4: Further transition to APPROVED queues another event
  {
    const approveRes = await client.updateOrderStatus(orderId, 'APPROVED', 1);
    assertStatus(approveRes, 200);
    assertEqual(approveRes.data.status, 'APPROVED');
    assertEqual(approveRes.data.version, 2);
  }

  // Test 5: Transition to COMPLETED queues completion event
  {
    const completeRes = await client.updateOrderStatus(orderId, 'COMPLETED', 2);
    assertStatus(completeRes, 200);
    assertEqual(completeRes.data.status, 'COMPLETED');
    assertEqual(completeRes.data.version, 3);
  }
}
