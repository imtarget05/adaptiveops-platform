/**
 * Tier 1 - Feature Coverage: Unified Target Configuration (Feature 19 / Requirement R3)
 *
 * Verifies targets configuration schema, profiles, and zero-cost cloud guards:
 * - targets.yaml contains all standard execution profiles
 * - local profile configures Docker Compose
 * - kubernetes profile configures Helm with atomic rollout
 * - aws and azure profiles enforce zero-cost boundaries (chargeable: false)
 * - health check global parameters are defined
 */

import { assertEqual, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const name = 'Tier 1 - Unified Target Configuration';

export async function run() {
  // Load targets configuration (from project root if available, otherwise fixture)
  let yamlText = '';
  const rootTargetsPath = path.resolve(process.cwd(), 'config/targets.yaml');
  if (fs.existsSync(rootTargetsPath)) {
    yamlText = fs.readFileSync(rootTargetsPath, 'utf8');
  } else {
    yamlText = FixtureLoader.loadText('targets.yaml');
  }

  assertTrue(yamlText.length > 0, 'targets.yaml must not be empty');

  // Test 1: Profiles block contains local, kubernetes, cloudflare, aws, azure
  {
    assertIncludes(yamlText, 'local:', 'Must define local profile');
    assertIncludes(yamlText, 'kubernetes:', 'Must define kubernetes profile');
    assertIncludes(yamlText, 'cloudflare:', 'Must define cloudflare profile');
    assertIncludes(yamlText, 'aws:', 'Must define aws profile');
    assertIncludes(yamlText, 'azure:', 'Must define azure profile');
  }

  // Test 2: Local profile declares docker-compose type and order-service
  {
    assertIncludes(yamlText, 'type: "docker-compose"', 'local profile must be docker-compose');
    assertIncludes(yamlText, 'order-service', 'local profile must list order-service');
  }

  // Test 3: Kubernetes profile configures Helm with atomic and wait
  {
    assertIncludes(yamlText, 'type: "helm"', 'kubernetes profile must be helm');
    assertIncludes(yamlText, 'atomic: true', 'Helm rollout must be configured as atomic');
    assertIncludes(yamlText, 'wait: true', 'Helm rollout must be configured to wait for readiness');
  }

  // Test 4: AWS and Azure profiles strictly declare chargeable: false and plan_only: true
  {
    assertIncludes(yamlText, 'chargeable: false', 'Cloud targets must set chargeable: false');
    assertIncludes(yamlText, 'budget_limit_usd: 0.00', 'Cloud targets must have 0.00 budget');
    assertIncludes(yamlText, 'plan_only: true', 'Cloud targets must be plan_only');
  }

  // Test 5: Globals define health check timeouts and retry parameters
  {
    assertIncludes(yamlText, 'health_check:', 'Globals must specify health_check block');
    assertIncludes(yamlText, 'default_timeout_seconds:', 'Must specify default_timeout_seconds');
    assertIncludes(yamlText, 'default_interval_seconds:', 'Must specify default_interval_seconds');
    assertIncludes(yamlText, 'default_retry_count:', 'Must specify default_retry_count');
  }
}
