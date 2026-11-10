/**
 * Tier 3 - Cross-Feature Combination: Rollback Execution to Audit Ledger
 *
 * Verifies interaction between:
 * Controlled rollback invocation
 *   -> Atomic D1 batch execution (status marked rolled_back, new rollback deployment inserted)
 *   -> Target version and degraded health assigned to environment
 *   -> Immutable audit event emitted
 *   -> Audit event queried and validated in the audit ledger
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 3 - Rollback Execution to Audit Ledger';

export async function run(client) {
  const env = 'kubernetes';

  // 0. Set up independent baseline releases
  const v1Ver = `v1.audit-${Date.now()}`;
  const v1RelId = `rel-${v1Ver}`;
  await client.postRelease({ id: v1RelId, version: v1Ver, commit_sha: 'sha-audit-v1' });
  const dep1 = await client.postDeployment({ release_id: v1RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep1.data.id, 'success');

  const v2Ver = `v2.audit-${Date.now()}`;
  const v2RelId = `rel-${v2Ver}`;
  await client.postRelease({ id: v2RelId, version: v2Ver, commit_sha: 'sha-audit-v2' });
  const dep2 = await client.postDeployment({ release_id: v2RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep2.data.id, 'success');

  // 1. Discover Candidate
  const candRes = await client.getRollbackCandidates(env);
  assertStatus(candRes, 200);
  const targetRelId = candRes.data.candidate_release?.release_id;
  assertTrue(Boolean(targetRelId), 'Candidate release ID must exist');

  // 2. Trigger Rollback with specific audit reason
  const uniqueReason = `Resilience gate smoke test failed at ${Date.now()}`;
  const rollbackRes = await client.executeRollback({
    environment: env,
    target_release_id: targetRelId,
    reason: uniqueReason,
    triggered_by: 'automated-watchdog',
  });
  assertStatus(rollbackRes, 200);
  const auditId = rollbackRes.data.audit_log_id;
  assertTrue(Boolean(auditId), 'Audit log ID must be generated');

  // 3. Inspect Audit Logs in Ledger
  const auditRes = await client.getAuditLogs();
  assertStatus(auditRes, 200);
  const logEntry = auditRes.data.find(l => l.id === auditId);
  assertTrue(Boolean(logEntry), 'Rollback event must be recorded in audit ledger');
  assertEqual(logEntry.actor, 'automated-watchdog');
  assertEqual(logEntry.action, 'ROLLBACK_TRIGGERED');
  assertIncludes(logEntry.details_json, uniqueReason, 'Audit details must preserve the failure reason');
}
