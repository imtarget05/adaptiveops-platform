import type { Env } from '../types/env';
import type { ReleaseLock } from '../types/models';

const NOW = () => new Date().toISOString();

export interface AcquireLockResult {
  acquired: boolean;
  lockId?: string;
  reason?: string;
}

export async function acquireLock(
  env: Env,
  environmentId: string,
  lockedBy: string,
  ttlSeconds = 300
): Promise<AcquireLockResult> {
  const db = env.DB;
  const envId = environmentId.toLowerCase();
  const now = NOW();

  // Check for an active (non-expired) lock on this environment.
  const existing = await db
    .prepare(`
      SELECT id, locked_at, ttl_seconds FROM release_locks
      WHERE environment_id = ?
      ORDER BY locked_at DESC
      LIMIT 1
    `)
    .bind(envId)
    .first<{ id: string; locked_at: string; ttl_seconds: number }>();

  if (existing) {
    const lockedAt = Number(existing.locked_at);
    const ttlMs = (existing.ttl_seconds ?? 300) * 1000;
    if (Date.now() - lockedAt < ttlMs) {
      return {
        acquired: false,
        reason: `Environment ${envId} is locked by ${existing.id} (TTL not expired)`,
      };
    }
    // Expired lock: treat as free (stale lock cleanup on acquire).
    await db
      .prepare('DELETE FROM release_locks WHERE id = ?')
      .bind(existing.id)
      .run();
  }

  const lockId = `rl-${crypto.randomUUID()}`;
  await db
    .prepare(`
      INSERT INTO release_locks (id, environment_id, locked_by, locked_at, ttl_seconds)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(lockId, envId, lockedBy, Date.now(), ttlSeconds)
    .run();

  return { acquired: true, lockId };
}

export async function releaseLock(
  env: Env,
  environmentId: string
): Promise<void> {
  await env.DB
    .prepare('DELETE FROM release_locks WHERE environment_id = ?')
    .bind(environmentId.toLowerCase())
    .run();
}

export async function isLocked(env: Env, environmentId: string): Promise<boolean> {
  const db = env.DB;
  const envId = environmentId.toLowerCase();
  const now = Date.now();

  const row = await db
    .prepare(`
      SELECT id, locked_at, ttl_seconds FROM release_locks
      WHERE environment_id = ?
      ORDER BY locked_at DESC
      LIMIT 1
    `)
    .bind(envId)
    .first<{ id: string; locked_at: string; ttl_seconds: number }>();

  if (!row) return false;
  const lockedAt = Number(row.locked_at);
  const ttlMs = (row.ttl_seconds ?? 300) * 1000;
  return Date.now() - lockedAt < ttlMs;
}

export async function listLocks(env: Env): Promise<ReleaseLock[]> {
  return env.DB
    .prepare('SELECT * FROM release_locks ORDER BY locked_at DESC')
    .all<ReleaseLock>()
    .then((r) => r.results as ReleaseLock[]);
}
