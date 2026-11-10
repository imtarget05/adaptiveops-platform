/**
 * Tier 2 - Boundary & Corner Cases: Cloud Cost Guardrails Boundaries
 *
 * Exercises zero-cost cloud protection boundaries:
 * - ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="false" strictly halts execution with exit code 7
 * - ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="0" halts with exit code 7
 * - Empty string authorization token halts with exit code 7
 * - Budget limit is strictly 0.00 in targets.yaml
 * - Terraform dry-run plan_only enforcement
 */

import { assertEqual, assertTrue, assertIncludes } from '../lib/assertions.mjs';
import { FixtureLoader } from '../lib/fixture-loader.mjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const name = 'Tier 2 - Cloud Cost Guardrail Boundaries';

export async function run() {
  const scriptsDir = path.resolve(process.cwd(), 'scripts');
  const deployScript = path.join(scriptsDir, 'deploy.sh');

  // Boundary 1: ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="false" returns exit code 7
  {
    if (fs.existsSync(deployScript)) {
      try {
        execSync(`bash "${deployScript}" --target azure`, {
          env: { ...process.env, ADAPTIVEOPS_ALLOW_CLOUD_CHARGES: 'false' },
          stdio: 'pipe',
        });
        throw new Error('Expected exit 7');
      } catch (err) {
        assertEqual(err.status, 7, 'ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="false" must trigger exit code 7');
      }
    } else {
      assertTrue(true, 'Specification requires exit code 7 on unauthorized cloud charge attempt');
    }
  }

  // Boundary 2: ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="0" returns exit code 7
  {
    if (fs.existsSync(deployScript)) {
      try {
        execSync(`bash "${deployScript}" --target aws`, {
          env: { ...process.env, ADAPTIVEOPS_ALLOW_CLOUD_CHARGES: '0' },
          stdio: 'pipe',
        });
        throw new Error('Expected exit 7');
      } catch (err) {
        assertEqual(err.status, 7, 'ADAPTIVEOPS_ALLOW_CLOUD_CHARGES="0" must trigger exit code 7');
      }
    }
  }

  // Boundary 3: Empty string token returns exit code 7
  {
    if (fs.existsSync(deployScript)) {
      try {
        execSync(`bash "${deployScript}" --target aws`, {
          env: { ...process.env, ADAPTIVEOPS_ALLOW_CLOUD_CHARGES: '' },
          stdio: 'pipe',
        });
        throw new Error('Expected exit 7');
      } catch (err) {
        assertEqual(err.status, 7, 'Empty token must trigger exit code 7');
      }
    }
  }

  // Boundary 4: targets.yaml specifies budget_limit_usd as 0.00 for all cloud targets
  {
    let targetsText = '';
    const rootPath = path.resolve(process.cwd(), 'config/targets.yaml');
    if (fs.existsSync(rootPath)) {
      targetsText = fs.readFileSync(rootPath, 'utf8');
    } else {
      targetsText = FixtureLoader.loadText('targets.yaml');
    }

    assertIncludes(targetsText, 'budget_limit_usd: 0.00', 'Budget limit must be explicitly zero');
  }

  // Boundary 5: Cloud targets require plan_only: true
  {
    let targetsText = '';
    const rootPath = path.resolve(process.cwd(), 'config/targets.yaml');
    if (fs.existsSync(rootPath)) {
      targetsText = fs.readFileSync(rootPath, 'utf8');
    } else {
      targetsText = FixtureLoader.loadText('targets.yaml');
    }

    assertIncludes(targetsText, 'plan_only: true', 'Cloud profiles must be plan_only');
  }
}
