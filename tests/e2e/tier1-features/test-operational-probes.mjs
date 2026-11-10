/**
 * Tier 1 - Feature Coverage: Operational Probes & OpenAPI (Feature 17 / Requirement R2)
 *
 * Verifies Spring Boot Actuator liveness/readiness probes, Prometheus metrics exporter, and OpenAPI 3 docs:
 * - /actuator/health/liveness returns 200 UP
 * - /actuator/health/readiness returns 200 UP
 * - /actuator/prometheus returns 200 with metrics text
 * - /v3/api-docs returns 200 with valid OpenAPI JSON
 * - Non-existent actuator endpoint returns 404
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';

export const name = 'Tier 1 - Operational Probes & OpenAPI';

export async function run(client) {
  // Test 1: Liveness probe returns 200 UP
  {
    const res = await client.getLiveness();
    assertStatus(res, 200, 'Liveness probe should return 200');
    assertEqual(res.data.status, 'UP', 'Status should be UP');
  }

  // Test 2: Readiness probe returns 200 UP
  {
    const res = await client.getReadiness();
    assertStatus(res, 200, 'Readiness probe should return 200');
    assertEqual(res.data.status, 'UP', 'Status should be UP');
  }

  // Test 3: Prometheus metrics endpoint returns 200 text format
  {
    const res = await client.getPrometheusMetrics();
    assertStatus(res, 200, 'Prometheus metrics endpoint should return 200');
    assertTrue(typeof res.rawText === 'string', 'Prometheus metrics should be plain text');
    assertIncludes(res.rawText, '# HELP', 'Prometheus output should include HELP directives');
  }

  // Test 4: OpenAPI 3.0 specification endpoint returns 200 and valid JSON
  {
    const res = await client.getOpenApiSpec();
    assertStatus(res, 200, 'OpenAPI docs endpoint should return 200');
    assertTrue(typeof res.data === 'object', 'OpenAPI response should be JSON');
    assertIncludes(res.data.openapi || '', '3.', 'OpenAPI version should be 3.x');
    assertTrue(Boolean(res.data.info?.title), 'API title must be present');
  }

  // Test 5: Non-existent actuator endpoint returns 404
  {
    const res = await client._request(client.orderServiceUrl, '/actuator/non-existent-probe-xyz');
    assertStatus(res, 404, 'Unknown actuator endpoint must return 404');
  }
}
