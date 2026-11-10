/**
 * Tier 3 - Cross-Feature Combination: Health Degradation to Rollback Trigger
 *
 * Verifies interaction between:
 * Post-deployment smoke/health probe degradation
 *   -> 3 consecutive failures trigger "unhealthy" status
 *   -> Automated candidate solver identifies previous known-healthy release
 *   -> Safety verification excludes currently failing version
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - Health Degradation to Rollback Solver';

export async function run(client) {
  const env = 'kubernetes';

  // 1. Establish known healthy baseline v1.1.0
  const v1Ver = `v1.1.base-${Date.now()}`;
  const v1RelId = `rel-${v1Ver}`;
  await client.postRelease({ id: v1RelId, version: v1Ver, commit_sha: crypto.randomBytes(20).toString('hex') });
  const dep1 = await client.postDeployment({ release_id: v1RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep1.data.id, 'success');

  // 2. Rollout new faulty version v2.0.0
  const v2Ver = `v2.0.fault-${Date.now()}`;
  const v2RelId = `rel-${v2Ver}`;
  await client.postRelease({ id: v2RelId, version: v2Ver, commit_sha: crypto.randomBytes(20).toString('hex') });
  const dep2 = await client.postDeployment({ release_id: v2RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep2.data.id, 'success'); // becomes active

  // 3. Ingest 3 consecutive 503 failures from v2
  for (let i = 0; i < 3; i++) {
    await client.postHealthMetric({
      environment: env,
      service_name: 'order-service',
      endpoint_url: 'http://order-service:8080/actuator/health',
      http_status: 503,
      latency_ms: 2500,
      status: 'unhealthy',
      probe_type: 'readiness',
    });
  }

  // 4. Verify environment status flipped to "unhealthy"
  const envRes = await client.getEnvironmentStatus(env);
  assertStatus(envRes, 200);
  assertEqual(envRes.data.environment.current_health_status, 'unhealthy');
  assertTrue(envRes.data.environment.consecutive_failures >= 3);

  // 5. Query candidate: must identify v1.1.base and NOT the failing v2.0.fault
  const candRes = await client.getRollbackCandidates(env);
  assertStatus(candRes, 200);
  assertTrue(Boolean(candRes.data.candidate_release), 'Candidate must be found');
  assertEqual(candRes.data.candidate_release.version, v1Ver, 'Candidate version must be v1 baseline');
  assertTrue(candRes.data.candidate_release.version !== v2Ver, 'Candidate must not be failing version');
}
