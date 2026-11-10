import { Hono } from 'hono';
import type { Env } from '../types/env';
import { runSmokeTest, listSmokeTests } from '../services/smokeTestService';
import { adminAuthMiddleware } from '../middleware/auth';

export const smokeTestRoutes = new Hono<{ Bindings: Env }>();

// Run a business-level smoke test after a deployment (release gate).
smokeTestRoutes.post('/', adminAuthMiddleware, async (c) => {
  const body = await c.req.json<{
    deployment_id?: string;
    environment_id?: string;
    test_name?: string;
    target_url?: string | null;
    timeout_ms?: number;
  }>();

  if (!body.deployment_id || !body.environment_id || !body.test_name) {
    return c.json(
      { error: 'Bad Request', message: 'Missing required fields: deployment_id, environment_id, test_name' },
      400
    );
  }

  const result = await runSmokeTest(c.env, {
    deployment_id: body.deployment_id,
    environment_id: body.environment_id,
    test_name: body.test_name,
    target_url: body.target_url ?? null,
    timeout_ms: body.timeout_ms,
  });

  return c.json({ success: true, result }, 200);
});

// List smoke test results.
smokeTestRoutes.get('/', async (c) => {
  const rows = await listSmokeTests(c.env, {
    deployment_id: c.req.query('deployment_id') || undefined,
    environment_id: c.req.query('environment_id') || undefined,
    limit: Math.min(Number(c.req.query('limit')) || 50, 200),
  });
  return c.json({ smoke_tests: rows, limit: rows.length });
});
