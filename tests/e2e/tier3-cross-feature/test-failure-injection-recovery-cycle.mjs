/**
 * Tier 3 - Cross-Feature Combination: 6-Phase Resilience & Rollback Recovery Cycle
 *
 * Simulates Requirement R4 complete resilience lifecycle:
 * Phase 1: Deploy healthy version v1.0.0
 * Phase 2: Deploy faulty version v2.0.0
 * Phase 3: Post-deployment smoke test fails
 * Phase 4: Failure detected -> automated rollback solver triggered
 * Phase 5: Rollback executed to v1.0.0
 * Phase 6: System recovers to healthy, audit event logged
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - 6-Phase Failure Injection & Recovery Cycle';

export async function run(client) {
  const env = 'kubernetes';

  // =========================================================================
  // Phase 1: Deploy Healthy Version v1.0.0
  // =========================================================================
  const v1Ver = `v1.cycle-${Date.now()}`;
  const v1RelId = `rel-${v1Ver}`;
  await client.postRelease({ id: v1RelId, version: v1Ver, commit_sha: 'sha-v1-cycle' });
  const dep1 = await client.postDeployment({ release_id: v1RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep1.data.id, 'success');

  // Verify baseline healthy
  for (let i = 0; i < 5; i++) {
    await client.postHealthMetric({ environment: env, http_status: 200, latency_ms: 25, status: 'healthy' });
  }
  const envV1 = await client.getEnvironmentStatus(env);
  assertEqual(envV1.data.environment.current_health_status, 'healthy');
  assertEqual(envV1.data.environment.active_release_id, v1RelId);

  // =========================================================================
  // Phase 2: Deploy Faulty Version v2.0.0
  // =========================================================================
  const v2Ver = `v2.cycle-${Date.now()}`;
  const v2RelId = `rel-${v2Ver}`;
  await client.postRelease({ id: v2RelId, version: v2Ver, commit_sha: 'sha-v2-cycle' });
  const dep2 = await client.postDeployment({ release_id: v2RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep2.data.id, 'success'); // becomes active

  // =========================================================================
  // Phase 3: Post-deployment smoke test detects failure (3 consecutive 503s)
  // =========================================================================
  for (let i = 0; i < 3; i++) {
    await client.postHealthMetric({
      environment: env,
      http_status: 503,
      latency_ms: 2500,
      status: 'unhealthy',
      probe_type: 'smoke',
    });
  }

  // =========================================================================
  // Phase 4: Health status flips to unhealthy & automated watchdog solver runs
  // =========================================================================
  const envV2 = await client.getEnvironmentStatus(env);
  assertEqual(envV2.data.environment.current_health_status, 'unhealthy');

  const candRes = await client.getRollbackCandidates(env);
  assertStatus(candRes, 200);
  assertEqual(candRes.data.candidate_release.version, v1Ver, 'Solver must identify v1 as rollback candidate');

  // =========================================================================
  // Phase 5: Execute Automated Rollback to v1.0.0
  // =========================================================================
  const rollbackRes = await client.executeRollback({
    environment: env,
    target_release_id: v1RelId,
    reason: `Automated 6-phase resilience failure detection on ${v2Ver}`,
    triggered_by: 'resilience-watchdog',
  });
  assertStatus(rollbackRes, 200);
  assertEqual(rollbackRes.data.status, 'initiated');
  assertEqual(rollbackRes.data.target_version, v1Ver);

  // Complete the rollback deployment
  await client.updateDeploymentStatus(rollbackRes.data.deployment_id, 'success');

  // =========================================================================
  // Phase 6: System recovers to healthy and audit event is recorded
  // =========================================================================
  for (let i = 0; i < 5; i++) {
    await client.postHealthMetric({ environment: env, http_status: 200, latency_ms: 20, status: 'healthy' });
  }

  const finalEnv = await client.getEnvironmentStatus(env);
  assertEqual(finalEnv.data.environment.current_health_status, 'healthy');
  assertEqual(finalEnv.data.environment.active_release_id, v1RelId);

  // Assert audit ledger contains rollback event
  const auditRes = await client.getAuditLogs();
  const rollbackAudit = auditRes.data.find(a => a.id === rollbackRes.data.audit_log_id);
  assertTrue(Boolean(rollbackAudit), 'Rollback audit log must be visible in ledger');
  assertIncludes(rollbackAudit.details_json, v2Ver, 'Audit log must reference failing release');
}
