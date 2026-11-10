import type { Env } from '../types/env';
import { isAllowedTargetUrl } from './deliveryService';

const NOW = () => new Date().toISOString();
const DEFAULT_TIMEOUT_MS = 10000;

export interface SmokeTestResult {
  id: string;
  deployment_id: string;
  environment_id: string;
  test_name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error_message: string | null;
  created_at: string;
}

export interface RunSmokeTestInput {
  deployment_id: string;
  environment_id: string;
  test_name: string;
  target_url?: string | null;
  timeout_ms?: number;
}

export async function runSmokeTest(
  env: Env,
  input: RunSmokeTestInput
): Promise<SmokeTestResult> {
  const db = env.DB;
  const now = NOW();
  const id = `st-${crypto.randomUUID()}`;
  const envId = (input.environment_id || 'local').toLowerCase();
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  let status: 'passed' | 'failed' | 'skipped' = 'passed';
  let errorMessage: string | null = null;
  let httpStatus: number | null = null;

  const urlCheck = isAllowedTargetUrl(input.target_url ?? undefined, env.ENVIRONMENT);
  if (!urlCheck.allowed) {
    status = 'failed';
    errorMessage = `smoke test blocked: ${urlCheck.reason ?? 'invalid target_url'}`;
  } else {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(input.target_url!, {
          method: 'GET',
          headers: { 'X-AdaptiveOps-Smoke-Test': '1' },
          signal: controller.signal,
          redirect: 'manual',
        });
        httpStatus = res.status;

        if (httpStatus < 200 || httpStatus >= 300) {
          status = 'failed';
          errorMessage = `HTTP ${httpStatus}`;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      status = 'failed';
      errorMessage = err?.message ?? String(err);
    }
  }

  const durationMs = Date.now() - start;

  await db
    .prepare(`
      INSERT INTO smoke_test_results (
        id, deployment_id, environment_id, test_name, status, duration_ms,
        error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(id, input.deployment_id, envId, input.test_name, status, durationMs, errorMessage)
    .run();

  // If smoke test failed, degrade the environment and record an audit alert.
  if (status === 'failed') {
    await db
      .prepare(`
        UPDATE environments
        SET current_health_status = 'degraded',
            consecutive_failures = consecutive_failures + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(envId)
      .run();

    await db
      .prepare(`
        INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json, created_at)
        VALUES (?, 'smoke-test', 'SMOKE_TEST_FAILED', 'deployment', ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(
        `aud-${crypto.randomUUID().slice(0, 8)}`,
        input.deployment_id,
        envId,
        JSON.stringify({
          test_name: input.test_name,
          http_status: httpStatus,
          error: errorMessage,
          duration_ms: durationMs,
        })
      )
      .run();
  }

  return {
    id,
    deployment_id: input.deployment_id,
    environment_id: envId,
    test_name: input.test_name,
    status,
    duration_ms: durationMs,
    error_message: errorMessage,
    created_at: now,
  };
}

export async function listSmokeTests(
  env: Env,
  options: { deployment_id?: string; environment_id?: string; limit?: number } = {}
): Promise<SmokeTestResult[]> {
  const db = env.DB;
  const limit = Math.min(options.limit ?? 50, 200);
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (options.deployment_id) {
    whereClauses.push('deployment_id = ?');
    params.push(options.deployment_id);
  }
  if (options.environment_id) {
    whereClauses.push('environment_id = ?');
    params.push(options.environment_id.toLowerCase());
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT * FROM smoke_test_results ${whereSql} ORDER BY created_at DESC LIMIT ?`
    )
    .bind(...params, limit)
    .all<SmokeTestResult>()
    .then((r) => r.results as SmokeTestResult[]);
}
