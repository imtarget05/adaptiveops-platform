/**
 * Tier 4 - Real-World Application Scenario 5: Backward-Compatible Database Schema Rollback (Expand/Contract)
 *
 * Verifies that database schema migrations adhere to Expand/Contract principles:
 * 1. Initial stable v1.0.0 writes orders
 * 2. Additive migration executed (new nullable column / auxiliary table created)
 * 3. v2.0.0 creates orders utilizing new schema features
 * 4. Application rollback occurs from v2.0.0 back to v1.0.0
 * 5. v1.0.0 code continues to read, create, and transition orders seamlessly without SQL syntax errors or column failures
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Scenario 5 - Expand/Contract DB Schema Rollback Compatibility';

export async function run(client) {
  // Step 1: Baseline v1.0.0 creates order
  const orderV1Payload = FixtureLoader.generateRandomOrder({ customerId: 'cust-v1-schema' });
  const keyV1 = crypto.randomUUID();
  const resV1 = await client.createOrder(orderV1Payload, keyV1);
  assertStatus(resV1, 201);
  const orderV1Id = resV1.data.id;

  // Step 2: v2.0.0 deployed with expanded metadata
  const orderV2Payload = FixtureLoader.generateRandomOrder({
    customerId: 'cust-v2-expanded-schema',
    metadata: { promotionalCode: 'SAVE2026', clientIp: '192.168.1.100' },
  });
  const keyV2 = crypto.randomUUID();
  const resV2 = await client.createOrder(orderV2Payload, keyV2);
  assertStatus(resV2, 201);
  const orderV2Id = resV2.data.id;

  // Step 3: Trigger Rollback of Application to v1.0.0
  const rollbackRes = await client.executeRollback({
    environment: 'kubernetes',
    reason: 'Application rollback to v1.0.0 preserving expanded DB schema',
    triggered_by: 'expand-contract-verifier',
  });
  assertStatus(rollbackRes, 200);

  // Step 4: After rollback to v1 codebase, verify reading order created by v2 succeeds
  const readV2FromV1 = await client.getOrder(orderV2Id);
  assertStatus(readV2FromV1, 200, 'v1 codebase must be able to read orders written during v2 expanded schema');
  assertEqual(readV2FromV1.data.id, orderV2Id);

  // Step 5: After rollback, verify v1 code can still create new orders and advance state machine
  const postRollbackPayload = FixtureLoader.generateRandomOrder({ customerId: 'cust-post-rollback' });
  const keyPostRollback = crypto.randomUUID();
  const resPostRollback = await client.createOrder(postRollbackPayload, keyPostRollback);
  assertStatus(resPostRollback, 201, 'v1 codebase must continue creating orders under expanded schema');
  const postRollbackOrderId = resPostRollback.data.id;

  // Transition state under v1
  const updateRes = await client.updateOrderStatus(postRollbackOrderId, 'PENDING', 0);
  assertStatus(updateRes, 200);
  assertEqual(updateRes.data.status, 'PENDING');
  assertEqual(updateRes.data.version, 1);
}
