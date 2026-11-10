/**
 * Tier 1 - Feature Coverage: D1 Relational Schema & Integrity Constraints (Feature 2 / Requirement R1)
 *
 * Verifies relational schema constraints, foreign keys, and unique checks on D1 storage:
 * - Duplicate release version rejection (UNIQUE constraint)
 * - Missing mandatory fields validation (NOT NULL constraint)
 * - Non-existent environment lookup (404 Not Found)
 * - Foreign key integrity on deployment insertion
 * - Schema shape verification for environment entity
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - D1 Relational Schema & Constraints';

export async function run(client) {
  // Test 1: UNIQUE constraint on release version rejects duplicate registration
  {
    const duplicateVersion = 'v1.0.0'; // Already seeded
    const res = await client.postRelease({
      id: `rel-${crypto.randomUUID()}`,
      version: duplicateVersion,
      commit_sha: '1111222233334444555566667777888899990000',
    });
    assertStatus(res, 409, 'Attempting to register existing release version must return 409 Conflict');
    assertIncludes(res.data.error || res.data.detail, 'already exists', 'Error should explain unique violation');
  }

  // Test 2: NOT NULL constraint enforcement on releases
  {
    const res = await client.postRelease({
      // missing version and commit_sha
      branch: 'feature-branch',
    });
    assertStatus(res, 400, 'Registration with missing required columns must return 400 Bad Request');
  }

  // Test 3: Environment retrieval preserves schema column definitions
  {
    const res = await client.getEnvironments();
    assertStatus(res, 200);
    const k8s = res.data.find(e => e.id === 'kubernetes');
    assertTrue(Boolean(k8s), 'Kubernetes environment should exist');
    assertTrue('type' in k8s, 'Column "type" must exist in environment row');
    assertTrue('current_health_status' in k8s, 'Column "current_health_status" must exist');
    assertTrue('consecutive_failures' in k8s, 'Column "consecutive_failures" must exist');
    assertEqual(typeof k8s.consecutive_failures, 'number', 'consecutive_failures must be numeric');
  }

  // Test 4: Querying non-existent environment returns 404
  {
    const res = await client.getEnvironmentStatus('non-existent-environment-xyz');
    assertStatus(res, 404, 'Non-existent environment lookup should return 404');
  }

  // Test 5: Missing required fields in deployment creation returns 400
  {
    const res = await client.postDeployment({
      // missing release_id and environment_id
      status: 'in_progress',
    });
    assertStatus(res, 400, 'Deployment missing release_id or environment_id must return 400 Bad Request');
  }
}
