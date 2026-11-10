/**
 * Tier 1 - Feature Coverage: Health Metric Ingestion & Sliding Window (Feature 6 / Requirement R1)
 *
 * Verifies probe ingestion and health state transitions:
 * - Ingestion of valid probe returns 200 acknowledged
 * - Missing fields in health submission rejected (400)
 * - 5 healthy probes result in "healthy" status
 * - High latency probe transitions status to "degraded"
 * - 3 consecutive 503 failures flip environment to "unhealthy"
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';

export const name = 'Tier 1 - Health Metric Ingestion & Sliding Window';

export async function run(client) {
  const env = 'kubernetes';

  // Test 1: Ingestion of valid health probe
  {
    const probe = {
      environment: env,
      service_name: 'order-service',
      endpoint_url: 'http://order-service:8080/actuator/health',
      http_status: 200,
      latency_ms: 25,
      status: 'healthy',
      probe_type: 'readiness',
    };
    const res = await client.postHealthMetric(probe);
    assertStatus(res, 200);
    assertTrue(res.data.acknowledged, 'acknowledged field should be true');
    assertTrue(Boolean(res.data.metric_id), 'metric_id should be returned');
  }

  // Test 2: Missing required fields returns 400
  {
    const badProbe = {
      // missing environment and http_status
      service_name: 'order-service',
    };
    const res = await client.postHealthMetric(badProbe);
    assertStatus(res, 400, 'Health metric without environment or http_status must return 400 Bad Request');
  }

  // Test 3: Series of healthy low-latency probes maintains "healthy" status
  {
    for (let i = 0; i < 5; i++) {
      await client.postHealthMetric({
        environment: env,
        http_status: 200,
        latency_ms: 30,
        status: 'healthy',
      });
    }
    const envRes = await client.getEnvironmentStatus(env);
    assertStatus(envRes, 200);
    assertEqual(envRes.data.environment.current_health_status, 'healthy');
    assertEqual(envRes.data.environment.consecutive_failures, 0);
  }

  // Test 4: High latency (>1500ms) probe transitions environment to "degraded"
  {
    const res = await client.postHealthMetric({
      environment: env,
      http_status: 200,
      latency_ms: 2200, // Spike
      status: 'degraded',
    });
    assertStatus(res, 200);
    assertEqual(res.data.environment_status, 'degraded');
  }

  // Test 5: 3 consecutive failure probes flip environment to "unhealthy"
  {
    for (let i = 0; i < 3; i++) {
      const res = await client.postHealthMetric({
        environment: env,
        http_status: 503,
        latency_ms: 3000,
        status: 'unhealthy',
      });
      assertStatus(res, 200);
    }
    const envRes = await client.getEnvironmentStatus(env);
    assertStatus(envRes, 200);
    assertEqual(envRes.data.environment.current_health_status, 'unhealthy');
    assertTrue(envRes.data.environment.consecutive_failures >= 3, 'Consecutive failures counter must be >= 3');
  }
}
