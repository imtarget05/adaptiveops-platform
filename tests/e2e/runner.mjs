#!/usr/bin/env node

/**
 * AdaptiveOps Platform - Master Opaque-Box E2E Test Suite Runner
 *
 * Implements 4-Tier Test Architecture:
 * - Tier 1: Feature Coverage
 * - Tier 2: Boundary & Corner Cases
 * - Tier 3: Cross-Feature Combinations
 * - Tier 4: Real-World Application Scenarios
 *
 * Runs standalone against local live targets or boots high-fidelity embedded contract servers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from './lib/logger.mjs';
import { AdaptiveOpsClient } from './lib/client.mjs';
import { ContractServer } from './lib/contract-server.mjs';

// Tier 1 Suites
import * as t1CpApi from './tier1-features/test-control-plane-api.mjs';
import * as t1D1Schema from './tier1-features/test-d1-schema.mjs';
import * as t1Hmac from './tier1-features/test-webhook-hmac.mjs';
import * as t1Dedup from './tier1-features/test-webhook-dedup.mjs';
import * as t1Deploy from './tier1-features/test-deployment-tracking.mjs';
import * as t1Health from './tier1-features/test-health-ingestion.mjs';
import * as t1Rollback from './tier1-features/test-rollback-api.mjs';
import * as t1Dashboard from './tier1-features/test-dashboard-contracts.mjs';
import * as t1OrderFsm from './tier1-features/test-order-fsm.mjs';
import * as t1OrderConcurrency from './tier1-features/test-order-concurrency.mjs';
import * as t1OrderIdempotency from './tier1-features/test-order-idempotency.mjs';
import * as t1Outbox from './tier1-features/test-transactional-outbox.mjs';
import * as t1Probes from './tier1-features/test-operational-probes.mjs';
import * as t1Targets from './tier1-features/test-target-configuration.mjs';
import * as t1Bash from './tier1-features/test-bash-automation.mjs';
import * as t1Audit from './tier1-features/test-audit-logging.mjs';

// Tier 2 Suites
import * as t2HmacBoundaries from './tier2-boundaries/test-hmac-boundaries.mjs';
import * as t2DedupBoundaries from './tier2-boundaries/test-dedup-boundaries.mjs';
import * as t2ConcurrencyBoundaries from './tier2-boundaries/test-order-concurrency-boundaries.mjs';
import * as t2IdempotencyBoundaries from './tier2-boundaries/test-idempotency-boundaries.mjs';
import * as t2ItemsBoundaries from './tier2-boundaries/test-order-items-boundaries.mjs';
import * as t2HealthBoundaries from './tier2-boundaries/test-health-sliding-window-boundaries.mjs';
import * as t2RollbackBoundaries from './tier2-boundaries/test-rollback-candidate-boundaries.mjs';
import * as t2GuardrailBoundaries from './tier2-boundaries/test-cloud-guardrail-boundaries.mjs';

// Tier 3 Suites
import * as t3WebhookToTimeline from './tier3-cross-feature/test-webhook-to-deployment-timeline.mjs';
import * as t3DeployToHealth from './tier3-cross-feature/test-deployment-health-transition.mjs';
import * as t3HealthToRollback from './tier3-cross-feature/test-health-failure-to-rollback.mjs';
import * as t3RollbackToAudit from './tier3-cross-feature/test-rollback-to-audit-log.mjs';
import * as t3OrderIdemOutbox from './tier3-cross-feature/test-order-idempotency-outbox.mjs';
import * as t3ResilienceCycle from './tier3-cross-feature/test-failure-injection-recovery-cycle.mjs';

// Tier 4 Suites
import * as s1Rollout from './tier4-scenarios/scenario-1-multi-cloud-rollout.mjs';
import * as s2Recovery from './tier4-scenarios/scenario-2-automated-incident-recovery.mjs';
import * as s3Concurrency from './tier4-scenarios/scenario-3-high-concurrency-order-processing.mjs';
import * as s4CostGuard from './tier4-scenarios/scenario-4-zero-cost-cloud-guardrails.mjs';
import * as s5ExpandContract from './tier4-scenarios/scenario-5-expand-contract-db-rollback.mjs';

const allSuites = [
  // Tier 1
  { tier: 1, ...t1CpApi },
  { tier: 1, ...t1D1Schema },
  { tier: 1, ...t1Hmac },
  { tier: 1, ...t1Dedup },
  { tier: 1, ...t1Deploy },
  { tier: 1, ...t1Health },
  { tier: 1, ...t1Rollback },
  { tier: 1, ...t1Dashboard },
  { tier: 1, ...t1OrderFsm },
  { tier: 1, ...t1OrderConcurrency },
  { tier: 1, ...t1OrderIdempotency },
  { tier: 1, ...t1Outbox },
  { tier: 1, ...t1Probes },
  { tier: 1, ...t1Targets },
  { tier: 1, ...t1Bash },
  { tier: 1, ...t1Audit },

  // Tier 2
  { tier: 2, ...t2HmacBoundaries },
  { tier: 2, ...t2DedupBoundaries },
  { tier: 2, ...t2ConcurrencyBoundaries },
  { tier: 2, ...t2IdempotencyBoundaries },
  { tier: 2, ...t2ItemsBoundaries },
  { tier: 2, ...t2HealthBoundaries },
  { tier: 2, ...t2RollbackBoundaries },
  { tier: 2, ...t2GuardrailBoundaries },

  // Tier 3
  { tier: 3, ...t3WebhookToTimeline },
  { tier: 3, ...t3DeployToHealth },
  { tier: 3, ...t3HealthToRollback },
  { tier: 3, ...t3RollbackToAudit },
  { tier: 3, ...t3OrderIdemOutbox },
  { tier: 3, ...t3ResilienceCycle },

  // Tier 4
  { tier: 4, ...s1Rollout },
  { tier: 4, ...s2Recovery },
  { tier: 4, ...s3Concurrency },
  { tier: 4, ...s4CostGuard },
  { tier: 4, ...s5ExpandContract },
];

async function isPortReachable(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const tierArg = args.find(a => a.startsWith('--tier='));
  const filterArg = args.find(a => a.startsWith('--filter='));
  const isLive = args.includes('--live');
  const isEmbedded = args.includes('--embedded');

  const selectedTier = tierArg ? parseInt(tierArg.split('=')[1], 10) : null;
  const filterPattern = filterArg ? new RegExp(filterArg.split('=')[1], 'i') : null;

  Logger.section('AdaptiveOps Platform - Opaque-Box E2E Test Suite');

  // Check target availability
  let controlPlaneUrl = process.env.CONTROL_PLANE_URL || 'http://localhost:8787';
  let orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:8080';

  let embeddedServer = null;

  if (isEmbedded) {
    Logger.info('Forcing embedded contract server execution (--embedded)');
    const cpPort = 8788 + Math.floor(Math.random() * 100);
    const osPort = 8089 + Math.floor(Math.random() * 100);
    embeddedServer = new ContractServer({ controlPlanePort: cpPort, orderServicePort: osPort });
    const endpoints = await embeddedServer.start();
    controlPlaneUrl = endpoints.controlPlaneUrl;
    orderServiceUrl = endpoints.orderServiceUrl;
    Logger.info(`Embedded Contract Server active: Control Plane (${controlPlaneUrl}), Order Service (${orderServiceUrl})`);
  } else if (!isLive) {
    const cpLive = await isPortReachable(`${controlPlaneUrl}/api/v1/environments`);
    const osLive = await isPortReachable(`${orderServiceUrl}/actuator/health/liveness`);

    if (!cpLive || !osLive) {
      Logger.info(`Live targets not reachable at ${controlPlaneUrl} / ${orderServiceUrl}.`);
      Logger.info('Automatically initializing high-fidelity embedded contract server for verification...');
      const cpPort = 8788 + Math.floor(Math.random() * 100);
      const osPort = 8089 + Math.floor(Math.random() * 100);
      embeddedServer = new ContractServer({ controlPlanePort: cpPort, orderServicePort: osPort });
      const endpoints = await embeddedServer.start();
      controlPlaneUrl = endpoints.controlPlaneUrl;
      orderServiceUrl = endpoints.orderServiceUrl;
      Logger.info(`Embedded Contract Server active: Control Plane (${controlPlaneUrl}), Order Service (${orderServiceUrl})`);
    } else {
      Logger.info(`Connected to live target servers: Control Plane (${controlPlaneUrl}), Order Service (${orderServiceUrl})`);
    }
  } else {
    Logger.info(`Running in strict live mode against ${controlPlaneUrl} and ${orderServiceUrl}`);
  }

  const client = new AdaptiveOpsClient({
    controlPlaneUrl,
    orderServiceUrl,
  });

  // Filter suites
  let suitesToRun = allSuites;
  if (selectedTier) {
    suitesToRun = suitesToRun.filter(s => s.tier === selectedTier);
    Logger.info(`Filtered to Tier ${selectedTier} (${suitesToRun.length} suites)`);
  }
  if (filterPattern) {
    suitesToRun = suitesToRun.filter(s => filterPattern.test(s.name));
    Logger.info(`Filtered by pattern "${filterPattern}" (${suitesToRun.length} suites)`);
  }

  const stats = {
    suites: suitesToRun.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
  };

  const startTime = Date.now();

  for (const suite of suitesToRun) {
    Logger.suiteHeader(suite.name, `Tier ${suite.tier}`);
    const suiteStart = Date.now();
    try {
      await suite.run(client);
      const duration = Date.now() - suiteStart;
      Logger.testPass(suite.name, duration);
      stats.passed++;
    } catch (err) {
      const duration = Date.now() - suiteStart;
      Logger.testFail(suite.name, err, duration);
      stats.failed++;
    }
  }

  stats.durationMs = Date.now() - startTime;

  if (embeddedServer) {
    await embeddedServer.stop();
  }

  Logger.summaryTable(stats);

  if (stats.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  Logger.error(`Unhandled test runner exception: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
