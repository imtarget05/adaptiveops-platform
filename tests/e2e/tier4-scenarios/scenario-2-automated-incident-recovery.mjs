/**
 * Tier 4 - Real-World Application Scenario 2: Automated Incident Recovery & Resilient Rollback
 *
 * Simulates a production outage scenario:
 * 1. Stable baseline v1.0.0 running in production
 * 2. Defective release v2.1.0 deployed, causing database connection failures
 * 3. Health monitor records 3 consecutive 503 failures
 * 4. Control plane automatically flips environment to unhealthy
 * 5. Rollback daemon discovers candidate v1.0.0 and initiates atomic rollback
 * 6. System recovers, health returns to healthy, immutable audit ledger captures full incident context
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Scenario 2 - Automated Incident Recovery & Rollback';

export async function run(client) {
  const env = 'kubernetes';

  // Step 1: Ensure stable v1.0.0 baseline
  const stableVer = `v1.stable-${Date.now()}`;
  const stableRelId = `rel-${stableVer}`;
  await client.postRelease({ id: stableRelId, version: stableVer, commit_sha: 'sha-stable-v1' });
  const depStable = await client.postDeployment({ release_id: stableRelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(depStable.data.id, 'success');

  // Step 2: Deploy defective release v2.1.0
  const defectVer = `v2.defect-${Date.now()}`;
  const defectRelId = `rel-${defectVer}`;
  await client.postRelease({ id: defectRelId, version: defectVer, commit_sha: 'sha-defect-v2' });
  const depDefect = await client.postDeployment({ release_id: defectRelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(depDefect.data.id, 'success');

  // Step 3: Outage occurs: Actuator health returns 503 (DB connection pool exhausted)
  for (let i = 0; i < 3; i++) {
    await client.postHealthMetric({
      environment: env,
      service_name: 'order-service',
      endpoint_url: 'http://order-service:8080/actuator/health',
      http_status: 503,
      latency_ms: 3200,
      status: 'unhealthy',
      probe_type: 'readiness',
      details: { db: 'DOWN', connection_error: 'HikariPool-1 - Connection is not available' },
    });
  }

  // Step 4: Verify environment is marked unhealthy
  const envStatus = await client.getEnvironmentStatus(env);
  assertEqual(envStatus.data.environment.current_health_status, 'unhealthy');

  // Step 5: Rollback daemon queries candidate
  const candRes = await client.getRollbackCandidates(env);
  assertStatus(candRes, 200);
  assertEqual(candRes.data.candidate_release.version, stableVer, 'Candidate must be the stable baseline');

  // Step 6: Rollback daemon executes controlled rollback
  const rollbackRes = await client.executeRollback({
    environment: env,
    target_release_id: stableRelId,
    reason: `Automated recovery: 503 outage detected on ${defectVer}`,
    triggered_by: 'incident-recovery-daemon',
  });
  assertStatus(rollbackRes, 200);
  assertEqual(rollbackRes.data.status, 'initiated');
  assertEqual(rollbackRes.data.target_version, stableVer);

  // Complete rollback deployment
  await client.updateDeploymentStatus(rollbackRes.data.deployment_id, 'success');

  // Step 7: Post-rollback verification - Service restores health
  for (let i = 0; i < 5; i++) {
    await client.postHealthMetric({
      environment: env,
      http_status: 200,
      latency_ms: 28,
      status: 'healthy',
      probe_type: 'readiness',
    });
  }

  const finalEnv = await client.getEnvironmentStatus(env);
  assertEqual(finalEnv.data.environment.current_health_status, 'healthy');
  assertEqual(finalEnv.data.environment.active_release_id, stableRelId);

  // Step 8: Verify immutable incident audit entry
  const auditLogs = await client.getAuditLogs();
  const incidentAudit = auditLogs.data.find(a => a.id === rollbackRes.data.audit_log_id);
  assertTrue(Boolean(incidentAudit), 'Incident recovery audit entry must exist');
  assertEqual(incidentAudit.actor, 'incident-recovery-daemon');
  assertIncludes(incidentAudit.details_json, defectVer);
}
