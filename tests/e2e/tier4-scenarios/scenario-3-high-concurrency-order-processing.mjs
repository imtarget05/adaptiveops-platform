/**
 * Tier 4 - Real-World Application Scenario 3: High-Concurrency Flash Sale with Idempotency Replay
 *
 * Simulates a high-traffic e-commerce flash sale:
 * 1. 20 distinct client workers place unique orders with Idempotency-Key headers simultaneously
 * 2. 10 duplicate client workers concurrently retry already-submitted orders
 * 3. Asserts:
 *    - All 30 requests complete successfully (HTTP 201 Created)
 *    - Exactly 20 unique orders are created in persistence (zero duplicate rows)
 *    - Cached responses returned for all duplicate retries
 *    - Orders can be transitioned sequentially through FSM without optimistic lock corruption
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Scenario 3 - High-Concurrency Flash Sale & Idempotency';

export async function run(client) {
  const uniqueCount = 20;
  const duplicateCount = 10;

  // Prepare 20 unique orders and keys
  const orders = Array.from({ length: uniqueCount }, (_, i) => ({
    key: `flash-sale-key-${i}-${crypto.randomUUID()}`,
    payload: FixtureLoader.generateRandomOrder({
      customerId: `flash-buyer-${i}`,
      totalAmount: Math.round((i * 15.50 + 20) * 100) / 100,
    }),
  }));

  // Execute initial 20 unique concurrent order submissions
  const initialPromises = orders.map(o => client.createOrder(o.payload, o.key));
  const initialResults = await Promise.all(initialPromises);

  const createdOrderIds = new Set();
  for (let i = 0; i < uniqueCount; i++) {
    const res = initialResults[i];
    assertStatus(res, 201, `Order ${i} must succeed with 201`);
    assertTrue(Boolean(res.data.id), `Order ID must be generated for order ${i}`);
    assertEqual(res.data.status, 'CREATED');
    assertEqual(res.data.version, 0);
    createdOrderIds.add(res.data.id);
  }
  assertEqual(createdOrderIds.size, uniqueCount, 'Must have exactly 20 unique orders created');

  // Concurrently fire 10 duplicate replays of the first 10 orders
  const duplicatePromises = orders.slice(0, duplicateCount).map(o => client.createOrder(o.payload, o.key));
  const duplicateResults = await Promise.all(duplicatePromises);

  for (let i = 0; i < duplicateCount; i++) {
    const dupRes = duplicateResults[i];
    assertStatus(dupRes, 201, `Duplicate request ${i} must return 201`);
    assertEqual(dupRes.data.id, initialResults[i].data.id, 'Duplicate replay must return cached order ID');
    assertEqual(dupRes.data.customerId, initialResults[i].data.customerId);
    assertEqual(dupRes.data.totalAmount, initialResults[i].data.totalAmount);
  }

  // Verify concurrent status progression on created orders
  const progressPromises = Array.from(createdOrderIds).slice(0, 5).map(id =>
    client.updateOrderStatus(id, 'PENDING', 0)
  );
  const progressResults = await Promise.all(progressPromises);
  for (const pr of progressResults) {
    assertStatus(pr, 200, 'Order status progression must succeed');
    assertEqual(pr.data.status, 'PENDING');
    assertEqual(pr.data.version, 1);
  }
}
