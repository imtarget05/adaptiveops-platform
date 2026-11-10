/**
 * Tier 2 - Boundary & Corner Cases: Order Concurrency Contention
 *
 * Exercises extreme concurrency contention and edge boundary conditions:
 * - 10 simultaneous clients competing to transition same order (exactly 1 wins, 9 get 409 Conflict)
 * - Negative version number in collision check
 * - Large integer version overflow
 * - Non-existent order ID status update returns 404
 * - Attempting status change on already terminal order (COMPLETED -> PENDING)
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 2 - Order Concurrency Contention Boundaries';

export async function run(client) {
  // Boundary 1: 10 concurrent clients competing to update CREATED -> PENDING simultaneously
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const createRes = await client.createOrder(orderPayload, crypto.randomUUID());
    assertStatus(createRes, 201);
    const orderId = createRes.data.id;
    assertEqual(createRes.data.version, 0);

    // Launch 10 simultaneous PUT requests with version 0
    const updatePromises = Array.from({ length: 10 }, () =>
      client.updateOrderStatus(orderId, 'PENDING', 0)
    );

    const results = await Promise.all(updatePromises);
    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409);

    assertEqual(successes.length, 1, 'Exactly one concurrent request must win the optimistic lock race');
    assertEqual(conflicts.length, 9, 'All other 9 concurrent requests must fail with HTTP 409 Conflict');

    // Confirm final order state is PENDING and version is 1
    const finalOrder = await client.getOrder(orderId);
    assertStatus(finalOrder, 200);
    assertEqual(finalOrder.data.status, 'PENDING');
    assertEqual(finalOrder.data.version, 1);
  }

  // Boundary 2: Negative version number
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const createRes = await client.createOrder(orderPayload, crypto.randomUUID());
    assertStatus(createRes, 201);
    const orderId = createRes.data.id;

    const res = await client.updateOrderStatus(orderId, 'PENDING', -1);
    assertStatus(res, 409, 'Negative version number must trigger 409 Conflict');
  }

  // Boundary 3: Large integer version number
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const createRes = await client.createOrder(orderPayload, crypto.randomUUID());
    assertStatus(createRes, 201);
    const orderId = createRes.data.id;

    const res = await client.updateOrderStatus(orderId, 'PENDING', Number.MAX_SAFE_INTEGER);
    assertStatus(res, 409, 'Large version overflow must trigger 409 Conflict');
  }

  // Boundary 4: Updating status of non-existent order ID returns 404
  {
    const res = await client.updateOrderStatus('ord-non-existent-xyz', 'PENDING', 0);
    assertStatus(res, 404, 'Non-existent order status update must return 404 Not Found');
  }

  // Boundary 5: Attempting status transition on terminal COMPLETED order returns 422
  {
    const orderPayload = FixtureLoader.generateRandomOrder();
    const createRes = await client.createOrder(orderPayload, crypto.randomUUID());
    assertStatus(createRes, 201);
    const orderId = createRes.data.id;

    // Advance to COMPLETED
    await client.updateOrderStatus(orderId, 'PENDING', 0);
    await client.updateOrderStatus(orderId, 'APPROVED', 1);
    await client.updateOrderStatus(orderId, 'COMPLETED', 2);

    // Attempt to revert from COMPLETED to PENDING with version 3
    const revertRes = await client.updateOrderStatus(orderId, 'PENDING', 3);
    assertStatus(revertRes, 422, 'Cannot transition out of terminal COMPLETED state');
  }
}
