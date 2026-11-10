/**
 * Tier 1 - Feature Coverage: React Dashboard Data Contracts (Feature 8 / Requirement R1)
 *
 * Verifies that Control Plane API responses fulfill the exact interface schemas
 * expected by the React + TypeScript frontend dashboard components:
 * - CORS preflight headers
 * - Environment pulse cards schema
 * - Deployment timeline schema
 * - Immutable audit log stream schema
 * - Release catalog schema
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';

export const name = 'Tier 1 - React Dashboard Data Contracts';

export async function run(client) {
  // Test 1: CORS headers allow dashboard cross-origin requests
  {
    const res = await client._request(client.controlPlaneUrl, '/api/v1/environments', {
      method: 'OPTIONS',
    });
    // OPTIONS should succeed with 204 or 200
    assertTrue(res.status === 204 || res.status === 200);
    const allowOrigin = res.headers.get('access-control-allow-origin');
    assertTrue(Boolean(allowOrigin), 'access-control-allow-origin must be present');
  }

  // Test 2: Environment pulse cards contract validation
  {
    const res = await client.getEnvironments();
    assertStatus(res, 200);
    for (const env of res.data) {
      assertTrue(typeof env.id === 'string', 'env.id must be a string');
      assertTrue(typeof env.name === 'string', 'env.name must be a string');
      assertTrue(['healthy', 'degraded', 'unhealthy', 'unknown'].includes(env.current_health_status), 'Valid health status');
      assertTrue(typeof env.consecutive_failures === 'number', 'consecutive_failures must be a number');
    }
  }

  // Test 3: Deployment timeline contract validation
  {
    const res = await client.getDeployments();
    assertStatus(res, 200);
    for (const dep of res.data) {
      assertTrue(typeof dep.id === 'string', 'dep.id must be a string');
      assertTrue(typeof dep.environment_id === 'string', 'dep.environment_id must be a string');
      assertTrue(['pending', 'in_progress', 'success', 'failure', 'cancelled', 'rolled_back'].includes(dep.status), 'Valid status');
      assertTrue(typeof dep.strategy === 'string', 'dep.strategy must be a string');
      assertTrue(typeof dep.trigger_type === 'string', 'dep.trigger_type must be a string');
    }
  }

  // Test 4: Audit log ledger contract validation
  {
    const res = await client.getAuditLogs();
    assertStatus(res, 200);
    for (const log of res.data) {
      assertTrue(typeof log.id === 'string', 'log.id must be a string');
      assertTrue(typeof log.actor === 'string', 'log.actor must be a string');
      assertTrue(typeof log.action === 'string', 'log.action must be a string');
      assertTrue(Boolean(log.created_at), 'created_at timestamp must be present');
    }
  }

  // Test 5: Release catalog contract validation
  {
    const res = await client.getReleases();
    assertStatus(res, 200);
    for (const rel of res.data) {
      assertTrue(typeof rel.id === 'string', 'rel.id must be a string');
      assertTrue(typeof rel.version === 'string', 'rel.version must be a string');
      assertTrue(typeof rel.commit_sha === 'string', 'rel.commit_sha must be a string');
      assertTrue(Boolean(rel.created_at), 'created_at must be present');
    }
  }
}
