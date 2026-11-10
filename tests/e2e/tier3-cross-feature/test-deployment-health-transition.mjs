/**
 * Tier 3 - Cross-Feature Combination: Deployment Success & Health Evaluation
 *
 * Verifies interaction between:
 * Deployment lifecycle status updates
 *   -> Environment active release activation
 *   -> Health probe ingestion
 *   -> Rolling health status transitions (healthy / degraded)
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - Deployment Health Transition';

export async function run(client) {
  const env = 'local';
  const newVer = `v1.4.health-${Date.now()}`;
  const newRelId = `rel-${newVer}`;

  // 1. Create Release
  await client.postRelease({
    id: newRelId,
    version: newVer,
    commit_sha: crypto.randomBytes(20).toString('hex'),
  });

  // 2. Create and start Deployment
  const depRes = await client.postDeployment({
    release_id: newRelId,
    environment_id: env,
    status: 'in_progress',
  });
  assertStatus(depRes, 201);
  const depId = depRes.data.id;

  // 3. Mark Deployment Successful
  const patchRes = await client.updateDeploymentStatus(depId, 'success');
  assertStatus(patchRes, 200);

  // 4. Verify Environment active release updated
  const envRes = await client.getEnvironmentStatus(env);
  assertStatus(envRes, 200);
  assertEqual(envRes.data.environment.active_release_id, newRelId);

  // 5. Ingest series of healthy probes from new release
  for (let i = 0; i < 5; i++) {
    const probeRes = await client.postHealthMetric({
      environment: env,
      service_name: 'order-service',
      endpoint_url: 'http://localhost:8080/actuator/health',
      http_status: 200,
      latency_ms: 30,
      status: 'healthy',
    });
    assertStatus(probeRes, 200);
  }

  // 6. Verify environment health status reflects 'healthy' with 0 consecutive failures
  const finalEnv = await client.getEnvironmentStatus(env);
  assertStatus(finalEnv, 200);
  assertEqual(finalEnv.data.environment.current_health_status, 'healthy');
  assertEqual(finalEnv.data.environment.consecutive_failures, 0);
}
