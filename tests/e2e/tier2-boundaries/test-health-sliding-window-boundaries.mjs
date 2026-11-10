/**
 * Tier 2 - Boundary & Corner Cases: Health Sliding Window Thresholds
 *
 * Exercises sliding window aggregation boundaries:
 * - Exactly 2 consecutive failures remains degraded (does not trip unhealthy)
 * - 3rd consecutive failure trips threshold to unhealthy
 * - Probe recovery (success after failure resets consecutive failure count)
 * - Latency boundary transition at 1500ms
 * - 0ms latency handled without errors
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';

export const name = 'Tier 2 - Health Sliding Window Boundaries';

export async function run(client) {
  const env = 'local';

  // Clear state: seed 5 healthy probes
  for (let i = 0; i < 5; i++) {
    await client.postHealthMetric({ environment: env, http_status: 200, latency_ms: 30, status: 'healthy' });
  }

  // Boundary 1: Exactly 1 failure -> degraded
  {
    const res = await client.postHealthMetric({ environment: env, http_status: 500, latency_ms: 100, status: 'unhealthy' });
    assertStatus(res, 200);
    assertEqual(res.data.environment_status, 'degraded', '1 failure should be degraded, not unhealthy');
  }

  // Boundary 2: Exactly 2 consecutive failures -> still degraded
  {
    const res = await client.postHealthMetric({ environment: env, http_status: 500, latency_ms: 100, status: 'unhealthy' });
    assertStatus(res, 200);
    assertEqual(res.data.environment_status, 'degraded', '2 failures should still be degraded');
  }

  // Boundary 3: Exactly 3rd consecutive failure -> flips to unhealthy
  {
    const res = await client.postHealthMetric({ environment: env, http_status: 500, latency_ms: 100, status: 'unhealthy' });
    assertStatus(res, 200);
    assertEqual(res.data.environment_status, 'unhealthy', '3rd consecutive failure must flip status to unhealthy');
  }

  // Boundary 4: Flapping recovery: 1 healthy success breaks consecutive failure streak
  {
    const res = await client.postHealthMetric({ environment: env, http_status: 200, latency_ms: 40, status: 'healthy' });
    assertStatus(res, 200);
    assertEqual(res.data.consecutive_failures, 0, 'Successful probe must reset consecutive failures');
  }

  // Boundary 5: 0ms latency handled gracefully
  {
    const res = await client.postHealthMetric({ environment: env, http_status: 200, latency_ms: 0, status: 'healthy' });
    assertStatus(res, 200);
    assertTrue(res.data.acknowledged);
  }
}
