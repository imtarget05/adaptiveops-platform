import type { Env } from '../types/env';
import type { RollbackCandidate } from '../types/models';
import { acquireLock, releaseLock } from './releaseLockService';

export interface RollbackOptions {
  environment: string;
  target_release_id?: string;
  target_version?: string;
  reason: string;
  triggered_by?: string;
  force?: boolean;
}

export interface RollbackExecutionResult {
  success: boolean;
  rollback_id: string;
  environment: string;
  target_version: string;
  target_release_id: string;
  status: 'initiated' | 'failed';
  deployment_id: string;
  audit_id: string;
  audit_log_id: string;
  candidate: RollbackCandidate;
  message: string;
}

export async function findRollbackCandidate(
  env: Env,
  environmentId: string
): Promise<RollbackCandidate | null> {
  const db = env.DB;
  const envId = environmentId.toLowerCase();

  // Find previous successful deployment in this environment that is not the current active release
  const row = await db
    .prepare(`
      SELECT 
        d.id AS previous_deployment_id,
        d.release_id,
        r.version,
        r.commit_sha,
        r.container_image_tag,
        r.schema_compatible,
        COALESCE(d.completed_at, d.started_at) AS last_healthy_at
      FROM deployments d
      JOIN releases r ON d.release_id = r.id
      WHERE d.environment_id = ?
        AND d.status = 'success'
        AND d.release_id != COALESCE((SELECT active_release_id FROM environments WHERE id = ?), '')
      ORDER BY d.completed_at DESC, d.started_at DESC
      LIMIT 1
    `)
    .bind(envId, envId)
    .first<{
      previous_deployment_id: string;
      release_id: string;
      version: string;
      commit_sha: string;
      container_image_tag: string | null;
      schema_compatible: number;
      last_healthy_at: string;
    }>();

  if (row) {
    return {
      previous_deployment_id: row.previous_deployment_id,
      release_id: row.release_id,
      version: row.version,
      commit_sha: row.commit_sha,
      container_image_tag: row.container_image_tag,
      last_healthy_at: row.last_healthy_at,
      rollback_safe: true,
      schema_backward_compatible: true,
      schema_compatible: row.schema_compatible ?? 1
    };
  }

  // If an environment has no previous successful deployments, return null (never fabricate a fake candidate)
  return null;
}

export async function executeRollback(
  env: Env,
  options: RollbackOptions
): Promise<RollbackExecutionResult> {
  const db = env.DB;
  const envId = options.environment.toLowerCase();
  const actor = options.triggered_by || 'automated-health-monitor';
  const reason = options.reason || 'Controlled rollback requested';

  // 0. Verify environment exists
  const envRow = await db
    .prepare('SELECT id FROM environments WHERE id = ?')
    .bind(envId)
    .first<any>();

  if (!envRow) {
    const notFoundErr: any = new Error(`Environment not found: ${envId}`);
    notFoundErr.status = 404;
    throw notFoundErr;
  }

  // Release-lock fencing: prevent conflicting deployments / rollbacks.
  const lockResult = await acquireLock(env, options.environment, options.triggered_by || 'rollback-controller', 300);
  if (!lockResult.acquired) {
    const lockErr: any = new Error(
      `Environment ${options.environment} is locked; a conflicting deployment or rollback is in progress`
    );
    lockErr.status = 409;
    throw lockErr;
  }

  let rollbackId: string;
  let deploymentId: string;
  let auditId: string;
  let eventId: string;
  let candidate: RollbackCandidate | null = null;
  try {
  if (options.target_release_id) {
    const r = await db
      .prepare('SELECT id, version, commit_sha, container_image_tag, schema_compatible, created_at FROM releases WHERE id = ?')
      .bind(options.target_release_id)
      .first<any>();
    if (r) {
      candidate = {
        previous_deployment_id: 'manual-target',
        release_id: r.id,
        version: r.version,
        commit_sha: r.commit_sha,
        container_image_tag: r.container_image_tag,
        last_healthy_at: r.created_at,
        rollback_safe: true,
        schema_backward_compatible: true,
        schema_compatible: r.schema_compatible ?? 1
      };
    }
  } else if (options.target_version) {
    const r = await db
      .prepare('SELECT id, version, commit_sha, container_image_tag, schema_compatible, created_at FROM releases WHERE version = ?')
      .bind(options.target_version)
      .first<any>();
    if (r) {
      candidate = {
        previous_deployment_id: 'manual-target',
        release_id: r.id,
        version: r.version,
        commit_sha: r.commit_sha,
        container_image_tag: r.container_image_tag,
        last_healthy_at: r.created_at,
        rollback_safe: true,
        schema_backward_compatible: true,
        schema_compatible: r.schema_compatible ?? 1
      };
    }
  }

  if (!candidate) {
    candidate = await findRollbackCandidate(env, envId);
  }

  if (!candidate) {
    const noCandErr: any = new Error(`No valid rollback candidate found for environment: ${envId}`);
    noCandErr.status = 422;
    throw noCandErr;
  }

  // Schema-compatibility guard: refuse rollback to an incompatible release unless forced.
  if (!options.force && Number(candidate.schema_compatible) === 0) {
    const incompatErr: any = new Error(
      `Rollback refused: release ${candidate.version} is not schema-compatible. An expand/contract migration or controlled remediation is required first.`
    );
    incompatErr.status = 422;
    throw incompatErr;
  }

  rollbackId = `rb-${crypto.randomUUID().slice(0, 8)}`;
  deploymentId = `dep-${crypto.randomUUID().slice(0, 8)}`;
  auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
  eventId = `ev-${crypto.randomUUID().slice(0, 8)}`;

  // 2. Execute Atomic D1 Batch
  const batchStatements = [
    // Insert new deployment record representing the rollback
    db.prepare(`
      INSERT INTO deployments (
        id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, started_at
      ) VALUES (?, ?, ?, 'in_progress', 'rolling', 'rollback', ?, ?, CURRENT_TIMESTAMP)
    `).bind(deploymentId, candidate.release_id, envId, actor, envId),

    // Record the requested target; active version and health only change after an actuator callback.
    db.prepare(`
      UPDATE environments 
      SET target_version = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(candidate.version, envId),

    // Record deployment event
    db.prepare(`
      INSERT INTO deployment_events (id, deployment_id, status, message, details_json)
      VALUES (?, ?, 'in_progress', ?, ?)
    `).bind(
      eventId,
      deploymentId,
      `Rollback initiated to version ${candidate.version}. Reason: ${reason}`,
      JSON.stringify({ rollback_id: rollbackId, candidate })
    ),

    // Record immutable audit log
    db.prepare(`
      INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json, created_at)
      VALUES (?, ?, 'ROLLBACK_TRIGGERED', 'environment', ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      auditId,
      actor,
      envId,
      envId,
      JSON.stringify({
        rollback_id: rollbackId,
        deployment_id: deploymentId,
        target_version: candidate.version,
        target_release_id: candidate.release_id,
        reason,
        force: !!options.force
      })
    ),

  ];
    await db.batch(batchStatements);
  } catch (error) {
    throw error;
  } finally {
    // This endpoint only records intent and has no actuator owning a long-running lock.
    await releaseLock(env, options.environment);
  }

  return {
    success: true,
    rollback_id: rollbackId,
    environment: envId,
    target_version: candidate.version,
    target_release_id: candidate.release_id,
    status: 'initiated',
    deployment_id: deploymentId,
    audit_id: auditId,
    audit_log_id: auditId,
    candidate,
    message: `Controlled rollback to ${candidate.version} initiated successfully.`
  };
}
