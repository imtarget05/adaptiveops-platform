/**
 * Tier 2 - Boundary & Corner Cases: Idempotency Key Handling
 *
 * Exercises payload hash sensitivity, key formats, and concurrency on idempotency:
 * - Single-character mutation in payload triggers 409 Conflict
 * - Ultra-long idempotency key (1024 chars) handled properly
 * - Key with symbols and special characters
 * - Concurrent requests with identical key return same order ID
 * - Whitespace differences in JSON payload
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 2 - Idempotency Key Handling Boundaries';

export async function run(client) {
  // Boundary 1: Single character change in customerId triggers 409 Conflict
  {
    const key = crypto.randomUUID();
    const originalPayload = FixtureLoader.generateRandomOrder({ customerId: 'cust-abc-1' });
    const res1 = await client.createOrder(originalPayload, key);
    assertStatus(res1, 201);

    const tamperedPayload = { ...originalPayload, customerId: 'cust-abc-2' }; // single char change
    const res2 = await client.createOrder(tamperedPayload, key);
    assertStatus(res2, 409, 'Single character payload difference must trigger 409 Conflict');
  }

  // Boundary 2: Ultra-long idempotency key (1024 characters)
  {
    const longKey = 'key-'.padEnd(1024, 'z');
    const payload = FixtureLoader.generateRandomOrder();
    const res1 = await client.createOrder(payload, longKey);
    assertStatus(res1, 201);

    const res2 = await client.createOrder(payload, longKey);
    assertStatus(res2, 201);
    assertEqual(res2.data.id, res1.data.id, 'Ultra-long key must be cached and returned');
  }

  // Boundary 3: Key containing URL-encoded characters and symbols
  {
    const symbolsKey = `idem:key/custom+test@domain#tag=${crypto.randomUUID()}`;
    const payload = FixtureLoader.generateRandomOrder();
    const res1 = await client.createOrder(payload, symbolsKey);
    assertStatus(res1, 201);

    const res2 = await client.createOrder(payload, symbolsKey);
    assertStatus(res2, 201);
    assertEqual(res2.data.id, res1.data.id);
  }

  // Boundary 4: Concurrent creation with same idempotency key
  {
    const sharedKey = crypto.randomUUID();
    const payload = FixtureLoader.generateRandomOrder();

    const promises = Array.from({ length: 5 }, () =>
      client.createOrder(payload, sharedKey)
    );

    const results = await Promise.all(promises);
    for (const r of results) {
      assertStatus(r, 201, 'All simultaneous requests with same key must return 201');
      assertEqual(r.data.id, results[0].data.id, 'All responses must share the exact same order ID');
    }
  }

  // Boundary 5: Empty payload object with idempotency key
  {
    const res = await client.createOrder({}, crypto.randomUUID());
    assertStatus(res, 400, 'Empty payload must return 400 Bad Request');
  }
}
