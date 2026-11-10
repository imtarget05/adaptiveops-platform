/**
 * Tier 2 - Boundary & Corner Cases: Rollback Candidate Selection Boundaries
 *
 * Exercises candidate discovery edge cases:
 * - Environment with no prior healthy deployments returns candidate_release: null
 * - Candidate must never equal currently failing active release
 * - Historical ordering selects strictly the latest successful release
 * - Rollback execution auto-discovers candidate when target_release_id is omitted
 * - Invoking rollback on environment with no candidates returns 422
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 2 - Rollback Candidate Selection Boundaries';

export async function run(client) {
  // Boundary 1: Environment with no successful deployments has null candidate
  {
    const res = await client.getRollbackCandidates('aws'); // aws has no prior deployments
    assertStatus(res, 200);
    assertEqual(res.data.candidate_release, null, 'AWS target with no history should have null candidate');
  }

  // Boundary 2: Candidate release id must not equal active_release_id
  {
    const res = await client.getRollbackCandidates('kubernetes');
    assertStatus(res, 200);
    if (res.data.candidate_release) {
      assertTrue(
        res.data.candidate_release.release_id !== res.data.current_release_id,
        'Candidate release must never be the same as the current active release'
      );
    }
  }

  // Boundary 3: Multiple historical releases: strictly select the most recent one
  {
    const env = 'cloudflare';
    // Deploy v1.0.0
    const rel1Ver = `v1.cf.1-${Date.now()}`;
    const rel1Id = `rel-${rel1Ver}`;
    await client.postRelease({ id: rel1Id, version: rel1Ver, commit_sha: 'sha-cf-1' });
    const dep1 = await client.postDeployment({ release_id: rel1Id, environment_id: env, status: 'in_progress' });
    await client.updateDeploymentStatus(dep1.data.id, 'success');

    // Deploy v1.0.1
    const rel2Ver = `v1.cf.2-${Date.now()}`;
    const rel2Id = `rel-${rel2Ver}`;
    await client.postRelease({ id: rel2Id, version: rel2Ver, commit_sha: 'sha-cf-2' });
    const dep2 = await client.postDeployment({ release_id: rel2Id, environment_id: env, status: 'in_progress' });
    await client.updateDeploymentStatus(dep2.data.id, 'success');

    // Deploy v2.0.0 (active failing)
    const rel3Ver = `v2.cf.0-${Date.now()}`;
    const rel3Id = `rel-${rel3Ver}`;
    await client.postRelease({ id: rel3Id, version: rel3Ver, commit_sha: 'sha-cf-3' });
    const dep3 = await client.postDeployment({ release_id: rel3Id, environment_id: env, status: 'in_progress' });
    await client.updateDeploymentStatus(dep3.data.id, 'success');

    // Candidate should be v1.cf.2 (rel2), NOT v1.cf.1
    const candRes = await client.getRollbackCandidates(env);
    assertStatus(candRes, 200);
    assertTrue(Boolean(candRes.data.candidate_release), 'Candidate must exist');
    assertEqual(candRes.data.candidate_release.version, rel2Ver, 'Must select the latest preceding healthy release');
  }

  // Boundary 4: Rollback execution auto-discovers candidate when target_release_id is omitted
  {
    const res = await client.executeRollback({
      environment: 'cloudflare',
      reason: 'Testing auto-discovery rollback',
      triggered_by: 'auto-tester',
    });
    assertStatus(res, 200);
    assertEqual(res.data.status, 'initiated');
  }

  // Boundary 5: Invoking rollback on environment with no candidate returns 422
  {
    const res = await client.executeRollback({
      environment: 'aws', // has null candidate
      reason: 'Should fail',
    });
    assertStatus(res, 422, 'Rollback with no candidate available must return 422 Unprocessable');
  }
}
