/**
 * Tier 4 - Real-World Application Scenario 1: Multi-Cloud Release Rollout & Verification Pipeline
 *
 * Simulates an enterprise deployment pipeline where a new release v1.2.0 is:
 * 1. Dispatched via GitHub deployment webhook
 * 2. Deployed concurrently to local and kubernetes environments
 * 3. Verified via Actuator liveness/readiness probes and smoke metrics
 * 4. Marked successful across both targets
 * 5. Tracked on the central deployment timeline
 */

import { assertEqual, assertStatus, assertTrue } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import crypto from 'node:crypto';

export const name = 'Scenario 1 - Multi-Cloud Release Rollout & Verification';

export async function run(client) {
  const version = `v1.2.prod-${Date.now()}`;
  const commitSha = crypto.randomBytes(20).toString('hex');
  const relId = `rel-${version}`;

  // Step 1: Register Release via CI Pipeline
  const releaseRes = await client.postRelease({
    id: relId,
    version,
    commit_sha: commitSha,
    branch: 'release/v1.2',
    git_author: 'release-manager@corporate.internal',
    commit_message: 'Release v1.2.0 with optimized order processing',
  });
  assertStatus(releaseRes, 201);

  // Step 2: Ingest GitHub Webhook for Local Target Deployment
  const localDeliveryId = crypto.randomUUID();
  const localWebhook = FixtureLoader.generateWebhookPayload('deployment_event', {
    deployment: {
      id: 88001,
      ref: version,
      sha: commitSha,
      environment: 'local',
      creator: { login: 'github-actions' },
    },
  });
  const localWhRes = await client.sendWebhook('deployment', localDeliveryId, localWebhook);
  assertTrue(localWhRes.status === 200 || localWhRes.status === 201);
  const localDepId = localWhRes.data.deployment_id;

  // Step 3: Ingest GitHub Webhook for Kubernetes Target Deployment
  const k8sDeliveryId = crypto.randomUUID();
  const k8sWebhook = FixtureLoader.generateWebhookPayload('deployment_event', {
    deployment: {
      id: 88002,
      ref: version,
      sha: commitSha,
      environment: 'kubernetes',
      creator: { login: 'github-actions' },
    },
  });
  const k8sWhRes = await client.sendWebhook('deployment', k8sDeliveryId, k8sWebhook);
  assertTrue(k8sWhRes.status === 200 || k8sWhRes.status === 201);
  const k8sDepId = k8sWhRes.data.deployment_id;

  // Step 4: Run Post-Deployment Smoke Probes on Local Target
  for (let i = 0; i < 5; i++) {
    const probeRes = await client.postHealthMetric({
      environment: 'local',
      service_name: 'order-service',
      endpoint_url: 'http://localhost:8080/actuator/health',
      http_status: 200,
      latency_ms: 22,
      status: 'healthy',
      probe_type: 'smoke',
    });
    assertStatus(probeRes, 200);
  }
  await client.updateDeploymentStatus(localDepId, 'success');

  // Step 5: Run Post-Deployment Smoke Probes on Kubernetes Target
  for (let i = 0; i < 5; i++) {
    const probeRes = await client.postHealthMetric({
      environment: 'kubernetes',
      service_name: 'order-service',
      endpoint_url: 'http://order-service:8080/actuator/health',
      http_status: 200,
      latency_ms: 38,
      status: 'healthy',
      probe_type: 'smoke',
    });
    assertStatus(probeRes, 200);
  }
  await client.updateDeploymentStatus(k8sDepId, 'success');

  // Step 6: Verify Both Environments report active release as v1.2.x
  const localEnv = await client.getEnvironmentStatus('local');
  assertEqual(localEnv.data.environment.active_release_id, relId);
  assertEqual(localEnv.data.environment.current_health_status, 'healthy');

  const k8sEnv = await client.getEnvironmentStatus('kubernetes');
  assertEqual(k8sEnv.data.environment.active_release_id, relId);
  assertEqual(k8sEnv.data.environment.current_health_status, 'healthy');

  // Step 7: Verify Deployments appear on Dashboard Timeline
  const allDeps = await client.getDeployments();
  assertStatus(allDeps, 200);
  const deployedIds = allDeps.data.map(d => d.id);
  assertTrue(deployedIds.includes(localDepId), 'Local deployment must be in timeline');
  assertTrue(deployedIds.includes(k8sDepId), 'K8s deployment must be in timeline');
}
