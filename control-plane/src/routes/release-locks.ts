import { Hono } from 'hono';
import type { Env } from '../types/env';
import {
  acquireLock,
  releaseLock,
  isLocked,
  listLocks,
  type AcquireLockResult,
} from '../services/releaseLockService';
import { adminAuthMiddleware } from '../middleware/auth';

export const releaseLockRoutes = new Hono<{ Bindings: Env }>();

// Acquire a release lock for an environment (fencing against concurrent deploys).
releaseLockRoutes.post('/', adminAuthMiddleware, async (c) => {
  const body = await c.req.json<{
    environment?: string;
    locked_by?: string;
    ttl_seconds?: number;
  }>();

  if (!body.environment) {
    return c.json(
      { error: 'Bad Request', message: 'Missing required field: environment' },
      400
    );
  }

  const result: AcquireLockResult = await acquireLock(
    c.env,
    body.environment,
    body.locked_by ?? 'operator',
    body.ttl_seconds ?? 300
  );

  return c.json({ success: result.acquired, ...result }, result.acquired ? 201 : 409);
});

// List active release locks.
releaseLockRoutes.get('/', async (c) => {
  const locks = await listLocks(c.env);
  return c.json({ locks, count: locks.length });
});

// Release (delete) the lock for an environment.
releaseLockRoutes.delete('/:environment', adminAuthMiddleware, async (c) => {
  await releaseLock(c.env, c.req.param('environment'));
  return c.json({ success: true, message: `Lock released for ${c.req.param('environment')}` });
});

// Check whether an environment is currently locked.
releaseLockRoutes.get('/:environment/check', async (c) => {
  const locked = await isLocked(c.env, c.req.param('environment'));
  return c.json({ environment: c.req.param('environment'), locked });
});
