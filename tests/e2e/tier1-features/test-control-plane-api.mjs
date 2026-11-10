/**
 * Tier 1 - Feature Coverage: Control Plane Edge API (Feature 1 / Requirement R1)
 *
 * Verifies core HTTP REST endpoints on Cloudflare Workers Control Plane API:
 * - GET /api/v1/environments
 * - GET /api/v1/releases
 * - POST /api/v1/releases
 * - GET /api/v1/deployments
 * - POST /api/v1/deployments
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import crypto from 'node:crypto';

export const name = 'Tier 1 - Control Plane Edge API Endpoints';

export async function run(client) {
  // Test 1: GET /api/v1/environments returns 200 and list of configured environments
  {
    const res = await client.getEnvironments();
    assertStatus(res, 200, 'GET /api/v1/environments should return 200 OK');
    assertTrue(Array.isArray(res.data), 'Response data should be an array');
    assertTrue(res.data.length >= 3, 'Should contain at least local, kubernetes, and cloudflare environments');
    const envIds = res.data.map(e => e.id);
    assertIncludes(envIds, 'local', 'Should include local environment');
    assertIncludes(envIds, 'kubernetes', 'Should include kubernetes environment');
    assertIncludes(envIds, 'cloudflare', 'Should include cloudflare environment');
  }

  // Test 2: GET /api/v1/releases returns 200 with list of registered releases
  {
    const res = await client.getReleases();
    assertStatus(res, 200, 'GET /api/v1/releases should return 200 OK');
    assertTrue(Array.isArray(res.data), 'Releases data should be an array');
    assertTrue(res.data.length >= 1, 'Should contain seeded release v1.0.0');
    const v1 = res.data.find(r => r.version === 'v1.0.0');
    assertTrue(Boolean(v1), 'Should contain v1.0.0');
    assertEqual(v1.git_author, 'release-bot', 'Author should match seeded author');
  }

  // Test 3: POST /api/v1/releases creates a new release and returns 201 Created
  const testVersion = `v1.9.${Math.floor(Math.random() * 1000)}`;
  const testReleaseId = `rel-${testVersion}`;
  {
    const payload = {
      id: testReleaseId,
      version: testVersion,
      commit_sha: crypto.randomBytes(20).toString('hex'),
      branch: 'main',
      tag: testVersion,
      git_author: 'e2e-runner',
      commit_message: 'feat: add edge rate limiting',
    };
    const res = await client.postRelease(payload);
    assertStatus(res, 201, 'POST /api/v1/releases should return 201 Created');
    assertEqual(res.data.version, testVersion, 'Created version should match request');

    // Verify it is retrievable
    const getRes = await client.getReleaseById(testReleaseId);
    assertStatus(getRes, 200, 'GET /api/v1/releases/:id should return 200 OK');
    assertEqual(getRes.data.version, testVersion, 'Fetched version should match');
  }

  // Test 4: GET /api/v1/deployments returns 200 and allows filtering
  {
    const res = await client.getDeployments();
    assertStatus(res, 200, 'GET /api/v1/deployments should return 200 OK');
    assertTrue(Array.isArray(res.data), 'Deployments data should be an array');

    const filtered = await client.getDeployments({ environment: 'kubernetes' });
    assertStatus(filtered, 200, 'Filtered query should return 200 OK');
    assertTrue(Array.isArray(filtered.data), 'Filtered data should be an array');
    assertTrue(filtered.data.every(d => d.environment_id === 'kubernetes'), 'All returned deployments must belong to kubernetes');
  }

  // Test 5: POST /api/v1/deployments creates new deployment record with initial pending/in_progress state
  {
    const depPayload = {
      release_id: testReleaseId,
      environment_id: 'kubernetes',
      status: 'in_progress',
      strategy: 'rolling',
      trigger_type: 'manual',
      deployed_by: 'qa-tester',
    };
    const res = await client.postDeployment(depPayload);
    assertStatus(res, 201, 'POST /api/v1/deployments should return 201 Created');
    assertTrue(Boolean(res.data.id), 'Deployment ID should be present');
    assertEqual(res.data.status, 'in_progress', 'Initial status should be in_progress');
  }
}
