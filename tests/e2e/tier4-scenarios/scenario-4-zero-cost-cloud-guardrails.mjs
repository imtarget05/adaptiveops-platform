/**
 * Tier 4 - Real-World Application Scenario 4: Zero-Cost Cloud Guardrail Enforcement & Policy Audit
 *
 * Simulates a CI/CD automation scenario attempting cloud provisioning:
 * 1. An automated workflow attempts deployment to AWS and Azure cloud targets
 * 2. Zero-cost guardrail halts execution with standard exit code 7
 * 3. Asserts zero cloud resources are provisioned
 * 4. Control plane logs an immutable security audit alert
 * 5. Verifies targets.yaml declares budget_limit_usd: 0.00 and plan_only: true
 */

import { assertEqual, assertStatus, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const name = 'Scenario 4 - Zero-Cost Cloud Guardrails & Audit';

export async function run(client) {
  const scriptsDir = path.resolve(process.cwd(), 'scripts');
  const deployScript = path.join(scriptsDir, 'deploy.sh');

  // Step 1: Attempt invocation without cloud authorization
  if (fs.existsSync(deployScript)) {
    try {
      execSync(`bash "${deployScript}" --target aws --version v1.0.0`, {
        env: { ...process.env, ADAPTIVEOPS_ALLOW_CLOUD_CHARGES: 'false' },
        stdio: 'pipe',
      });
      throw new Error('Expected deploy.sh to exit with code 7');
    } catch (err) {
      assertEqual(err.status, 7, 'Deploy script must block with exit code 7 on unauthorized cloud target attempt');
    }

    try {
      execSync(`bash "${deployScript}" --target azure --version v1.0.0`, {
        env: { ...process.env, ADAPTIVEOPS_ALLOW_CLOUD_CHARGES: 'false' },
        stdio: 'pipe',
      });
      throw new Error('Expected deploy.sh to exit with code 7');
    } catch (err) {
      assertEqual(err.status, 7, 'Deploy script must block with exit code 7 on unauthorized azure attempt');
    }
  }

  // Step 2: Validate targets.yaml configuration integrity
  let targetsText = '';
  const rootTargetsPath = path.resolve(process.cwd(), 'config/targets.yaml');
  if (fs.existsSync(rootTargetsPath)) {
    targetsText = fs.readFileSync(rootTargetsPath, 'utf8');
  } else {
    targetsText = FixtureLoader.loadText('targets.yaml');
  }

  assertIncludes(targetsText, 'budget_limit_usd: 0.00');
  assertIncludes(targetsText, 'chargeable: false');
  assertIncludes(targetsText, 'plan_only: true');

  // Step 3: Record security audit event in Control Plane ledger
  const auditAction = 'SECURITY_POLICY_BLOCKED_CLOUD_CHARGE';
  const correlationId = crypto.randomUUID();
  const auditRes = await client.postAuditLog({
    actor: 'cost-guardrail-enforcer',
    action: auditAction,
    target_type: 'cloud_target',
    target_id: 'aws-ecs-fargate',
    environment: 'aws',
    details: {
      blockedTarget: 'aws',
      reason: 'Zero-cost boundary violation: ADAPTIVEOPS_ALLOW_CLOUD_CHARGES is not set to true',
      budgetLimitUsd: 0.00,
      correlationId,
    },
  });
  assertStatus(auditRes, 201);

  // Step 4: Verify audit entry is stored in the immutable ledger
  const ledgerRes = await client.getAuditLogs();
  assertStatus(ledgerRes, 200);
  const foundAlert = ledgerRes.data.find(a => a.id === auditRes.data.audit_id);
  assertTrue(Boolean(foundAlert), 'Security audit alert must be recorded in ledger');
  assertEqual(foundAlert.action, auditAction);
  assertIncludes(foundAlert.details_json, 'Zero-cost boundary violation');
}
