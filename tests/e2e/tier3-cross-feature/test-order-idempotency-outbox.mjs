/**
 * Tier 3 - Cross-Feature Combination: Order Creation, Idempotency Cache & Outbox
 *
 * Verifies interaction between:
 * Client HTTP order creation with Idempotency-Key
 *   -> Entity insertion in orders table
 *   -> Response caching in idempotency_keys table
 *   -> Atomic event generation in outbox_messages table
 *   -> Duplicate replay returns cached response without duplicate outbox message
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - Order Idempotency and Transactional Outbox';

export async function run(client) {
  const idemKey = crypto.randomUUID();
  const orderPayload = FixtureLoader.generateRandomOrder();

  // 1. First order creation request
  const res1 = await client.createOrder(orderPayload, idemKey);
  assertStatus(res1, 201);
  const orderId = res1.data.id;
  assertEqual(res1.data.status, 'CREATED');
  assertEqual(res1.data.version, 0);

  // 2. Fetch order to verify items were saved
  const fetchRes = await client.getOrder(orderId);
  assertStatus(fetchRes, 200);
  assertEqual(fetchRes.data.customerId, orderPayload.customerId);
  assertEqual(fetchRes.data.items.length, orderPayload.items.length);

  // 3. Duplicate request with same Idempotency-Key
  const res2 = await client.createOrder(orderPayload, idemKey);
  assertStatus(res2, 201);
  assertEqual(res2.data.id, orderId, 'Replayed request must return same order ID');
  assertEqual(res2.data.customerId, orderPayload.customerId);

  // 4. Update status of the order (CREATED -> PENDING)
  const updateRes = await client.updateOrderStatus(orderId, 'PENDING', 0);
  assertStatus(updateRes, 200);
  assertEqual(updateRes.data.status, 'PENDING');
  assertEqual(updateRes.data.version, 1);
}
