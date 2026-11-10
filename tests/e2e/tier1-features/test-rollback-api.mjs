/**
 * Tier 1 - Feature Coverage: Controlled Rollback API (Feature 7 / Requirement R1)
 *
 * Verifies candidate discovery query and atomic rollback execution:
 * - Candidate discovery finds previous successful release
 * - Candidate discovery excludes current active release
 * - Rollback execution creates deployment with trigger_type='rollback'
 * - Rollback updates target_version on environment
 * - Rollback with invalid environment returns 404
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Controlled Rollback API';

export async function run(client) {
  const env = 'kubernetes';

  // Setup: Deploy a healthy v1.1.0 release and mark successful
  const v1Ver = `v1.1.${Math.floor(Math.random() * 1000)}`;
  const v1RelId = `rel-${v1Ver}`;
  await client.postRelease({ id: v1RelId, version: v1Ver, commit_sha: crypto.randomBytes(20).toString('hex') });

  const dep1 = await client.postDeployment({ release_id: v1RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep1.data.id, 'success');

  // Next: Deploy a failing v2.0.0 release and mark it active
  const v2Ver = `v2.0.${Math.floor(Math.random() * 1000)}`;
  const v2RelId = `rel-${v2Ver}`;
  await client.postRelease({ id: v2RelId, version: v2Ver, commit_sha: crypto.randomBytes(20).toString('hex') });

  const dep2 = await client.postDeployment({ release_id: v2RelId, environment_id: env, status: 'in_progress' });
  await client.updateDeploymentStatus(dep2.data.id, 'success'); // currently active

  // Test 1: Query rollback candidates returns previous healthy v1.1.x, NOT v2.0.x
  {
    const res = await client.getRollbackCandidates(env);
    assertStatus(res, 200);
    assertTrue(Boolean(res.data.candidate_release), 'Candidate release must be found');
    assertEqual(res.data.candidate_release.version, v1Ver, 'Candidate must be the previous healthy release');
  }

  // Test 2: Execute rollback to candidate
  let rollbackResult = null;
  {
    const res = await client.executeRollback({
      environment: env,
      target_release_id: v1RelId,
      reason: 'Automated smoke test assertion failure on v2',
      triggered_by: 'automated-health-monitor',
    });
    assertStatus(res, 200);
    assertEqual(res.data.status, 'initiated');
    assertEqual(res.data.target_version, v1Ver);
    assertTrue(Boolean(res.data.rollback_id), 'rollback_id must be generated');
    assertTrue(Boolean(res.data.audit_log_id), 'audit_log_id must be generated');
    rollbackResult = res.data;
  }

  // Test 3: Environment target_version updated to candidate version
  {
    const envRes = await client.getEnvironmentStatus(env);
    assertStatus(envRes, 200);
    assertEqual(envRes.data.environment.target_version, v1Ver);
    assertEqual(envRes.data.environment.current_health_status, 'degraded');
  }

  // Test 4: Rollback deployment has trigger_type = 'rollback'
  {
    const depRes = await client.getDeploymentById(rollbackResult.deployment_id);
    assertStatus(depRes, 200);
    assertEqual(depRes.data.trigger_type, 'rollback');
    assertEqual(depRes.data.release_id, v1RelId);
  }

  // Test 5: Rollback invocation with invalid environment returns 404
  {
    const res = await client.executeRollback({
      environment: 'non-existent-cluster',
      reason: 'Testing 404',
    });
    assertStatus(res, 404);
  }
}
