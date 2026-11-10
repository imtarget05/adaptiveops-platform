/**
 * Tier 1 - Feature Coverage: Release & Deployment Lifecycle Tracking (Feature 5 / Requirement R1)
 *
 * Verifies deployment state transitions and target environment tracking:
 * - Deployment creation with initial status
 * - Successful status patch updates environment active release
 * - Failed status patch retains previous active release
 * - Non-existent deployment update returns 404
 * - Query deployment by ID returns complete record
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Release & Deployment Lifecycle Tracking';

export async function run(client) {
  // Setup release
  const relVer = `v1.5.${Math.floor(Math.random() * 1000)}`;
  const relId = `rel-${relVer}`;
  await client.postRelease({
    id: relId,
    version: relVer,
    commit_sha: crypto.randomBytes(20).toString('hex'),
  });

  // Test 1: Create deployment record
  let depId = null;
  {
    const res = await client.postDeployment({
      release_id: relId,
      environment_id: 'local',
      status: 'in_progress',
      strategy: 'rolling',
      trigger_type: 'manual',
      deployed_by: 'qa-engineer',
    });
    assertStatus(res, 201);
    depId = res.data.id;
    assertTrue(Boolean(depId), 'Deployment ID must be returned');
    assertEqual(res.data.status, 'in_progress');
  }

  // Test 2: Query deployment by ID
  {
    const res = await client.getDeploymentById(depId);
    assertStatus(res, 200);
    assertEqual(res.data.id, depId);
    assertEqual(res.data.release_id, relId);
    assertEqual(res.data.environment_id, 'local');
  }

  // Test 3: Update deployment status to 'success' updates environment active_release_id
  {
    const patchRes = await client.updateDeploymentStatus(depId, 'success');
    assertStatus(patchRes, 200);
    assertEqual(patchRes.data.status, 'success');

    const envRes = await client.getEnvironmentStatus('local');
    assertStatus(envRes, 200);
    assertEqual(envRes.data.environment.active_release_id, relId, 'Active release must update to newly successful release');
  }

  // Test 4: Failed deployment status preserves existing active release
  {
    const failVer = `v1.5.fail-${Math.floor(Math.random() * 1000)}`;
    const failRelId = `rel-${failVer}`;
    await client.postRelease({
      id: failRelId,
      version: failVer,
      commit_sha: crypto.randomBytes(20).toString('hex'),
    });

    const createRes = await client.postDeployment({
      release_id: failRelId,
      environment_id: 'local',
      status: 'in_progress',
    });
    assertStatus(createRes, 201);
    const failedDepId = createRes.data.id;

    const patchRes = await client.updateDeploymentStatus(failedDepId, 'failure', {
      error_message: 'Port conflict on container startup',
    });
    assertStatus(patchRes, 200);

    const envRes = await client.getEnvironmentStatus('local');
    assertStatus(envRes, 200);
    // Active release should still be relId, NOT failRelId
    assertEqual(envRes.data.environment.active_release_id, relId, 'Active release must NOT switch to failed release');
  }

  // Test 5: Patching non-existent deployment returns 404
  {
    const res = await client.updateDeploymentStatus('dep-non-existent-xyz', 'success');
    assertStatus(res, 404, 'Updating non-existent deployment must return 404');
  }
}
