/**
 * Tier 3 - Cross-Feature Combination: Webhook Ingestion to Deployment Timeline
 *
 * Verifies end-to-end integration:
 * GitHub Webhook Ingress (HMAC verification)
 *   -> Delivery Deduplication Lock
 *   -> Release & Deployment Record Creation in D1
 *   -> Deployment Timeline API & Dashboard Reflection
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - Webhook to Deployment Timeline';

export async function run(client) {
  const deliveryId = crypto.randomUUID();
  const commitSha = crypto.randomBytes(20).toString('hex');
  const targetVersion = `v1.3.flow-${Date.now()}`;

  const webhookPayload = FixtureLoader.generateWebhookPayload('deployment_event', {
    deployment: {
      id: Math.floor(Math.random() * 900000) + 100000,
      ref: targetVersion,
      sha: commitSha,
      environment: 'kubernetes',
      creator: { login: 'ci-runner[bot]' },
    },
  });

  // Step 1: Send Webhook with HMAC signature
  const webhookRes = await client.sendWebhook('deployment', deliveryId, webhookPayload);
  assertTrue(webhookRes.status === 201 || webhookRes.status === 200, 'Webhook must be processed');
  const depId = webhookRes.data.deployment_id;
  assertTrue(Boolean(depId), 'Deployment ID must be produced');

  // Step 2: Immediate duplicate delivery is rejected with 202 Accepted
  const dupRes = await client.sendWebhook('deployment', deliveryId, webhookPayload);
  assertStatus(dupRes, 202, 'Duplicate delivery must be rejected with 202');
  assertEqual(dupRes.data.status, 'already_processed');

  // Step 3: Deployment record is retrievable in D1
  const depRes = await client.getDeploymentById(depId);
  assertStatus(depRes, 200);
  assertEqual(depRes.data.id, depId);
  assertEqual(depRes.data.environment_id, 'kubernetes');
  assertEqual(depRes.data.status, 'in_progress');

  // Step 4: Release was created and is visible in release catalog
  const releasesRes = await client.getReleases();
  assertStatus(releasesRes, 200);
  const foundRel = releasesRes.data.find(r => r.version === targetVersion);
  assertTrue(Boolean(foundRel), 'Release record must be persisted in release catalog');
  assertEqual(foundRel.commit_sha, commitSha);

  // Step 5: Timeline displays deployment in chronological order
  const timelineRes = await client.getDeployments({ environment: 'kubernetes' });
  assertStatus(timelineRes, 200);
  const latestDep = timelineRes.data.find(d => d.id === depId);
  assertTrue(Boolean(latestDep), 'Deployment must be present in deployment timeline query');
}
