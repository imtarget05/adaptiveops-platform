import type { Env } from '../types/env';
import type { DeploymentStatus } from '../types/models';

export interface ProcessWebhookResult {
  duplicate: boolean;
  deliveryId: string;
  eventType: string;
  action?: string;
  deploymentId?: string;
  status?: string;
  environment?: string;
  message?: string;
}

export async function processGitHubWebhook(
  env: Env,
  deliveryId: string,
  eventType: string,
  rawPayload: string
): Promise<ProcessWebhookResult> {
  const db = env.DB;

  // 1. Webhook Deduplication Check via primary key insertion in webhook_deliveries
  const preview = rawPayload.slice(0, 500);
  try {
    const existing = await db
      .prepare('SELECT delivery_id, status FROM webhook_deliveries WHERE delivery_id = ?')
      .bind(deliveryId)
      .first<{ delivery_id: string; status: string }>();

    if (existing) {
      return {
        duplicate: true,
        deliveryId,
        eventType,
        message: 'Delivery ID already processed. Duplicate skipped.'
      };
    }

    // Atomic claim of delivery ID
    await db
      .prepare(
        'INSERT INTO webhook_deliveries (delivery_id, event_type, signature_verified, payload_preview, status) VALUES (?, ?, 1, ?, ?)'
      )
      .bind(deliveryId, eventType, preview, 'processing')
      .run();
  } catch (err: any) {
    // SQLite primary key constraint violation indicates duplicate concurrent delivery
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return {
        duplicate: true,
        deliveryId,
        eventType,
        message: 'Delivery ID already processed. Duplicate skipped.'
      };
    }
    throw err;
  }

  // 2. Parse JSON payload
  let payload: any = {};
  if (rawPayload && rawPayload.trim().length > 0) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      await db
        .prepare('UPDATE webhook_deliveries SET status = ?, error_message = ? WHERE delivery_id = ?')
        .bind('failed', 'Invalid JSON payload', deliveryId)
        .run();
      const err: any = new Error('Malformed JSON payload');
      err.status = 400;
      throw err;
    }
  }

  try {
    // 3. Process specific GitHub events
    if (eventType === 'deployment') {
      const ghDep = payload.deployment || {};
      const envName = (ghDep.environment || 'local').toLowerCase();
      const commitSha = ghDep.sha || `sha-${Date.now()}`;
      const version =
        ghDep.payload?.tag ||
        (ghDep.ref && ghDep.ref.startsWith('refs/tags/') ? ghDep.ref.replace('refs/tags/', '') : null) ||
        (ghDep.ref ? `${ghDep.ref}-${commitSha.substring(0, 7)}` : `v-${commitSha.substring(0, 7)}`);
      const releaseId = `rel-${version}`;
      const deploymentId = `dep-${ghDep.id || crypto.randomUUID().slice(0, 8)}`;
      const creator = ghDep.creator?.login || 'github-actions';
      const imageTag = ghDep.payload?.image || `adaptiveops/order-service:${version}`;

      // Upsert release
      await db
        .prepare(`
          INSERT INTO releases (id, version, commit_sha, branch, tag, git_author, commit_message, container_image_tag, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            commit_sha = excluded.commit_sha,
            container_image_tag = excluded.container_image_tag
        `)
        .bind(
          releaseId,
          version,
          commitSha,
          ghDep.ref || 'main',
          version,
          creator,
          ghDep.description || `Deployment ${version}`,
          imageTag,
          JSON.stringify(ghDep.payload || {})
        )
        .run();

      // Ensure environment exists
      await db
        .prepare(`
          INSERT OR IGNORE INTO environments (id, name, description, type, current_health_status, target_version)
          VALUES (?, ?, ?, 'staging', 'unknown', ?)
        `)
        .bind(envName, envName.toUpperCase(), `Environment ${envName}`, version)
        .run();

      // Insert deployment
      await db
        .prepare(`
          INSERT INTO deployments (id, release_id, environment_id, github_deployment_id, status, strategy, trigger_type, deployed_by, target_profile, started_at)
          VALUES (?, ?, ?, ?, 'in_progress', 'rolling', 'webhook', ?, ?, CURRENT_TIMESTAMP)
        `)
        .bind(deploymentId, releaseId, envName, ghDep.id || null, creator, envName)
        .run();

      // Record timeline event
      await db
        .prepare(`
          INSERT INTO deployment_events (id, deployment_id, status, message, details_json)
          VALUES (?, ?, 'in_progress', 'Deployment started via GitHub Webhook', ?)
        `)
        .bind(`ev-${crypto.randomUUID().slice(0, 8)}`, deploymentId, JSON.stringify({ ref: ghDep.ref, sha: commitSha }))
        .run();

      // Record audit log
      await db
        .prepare(`
          INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json)
          VALUES (?, ?, 'DEPLOYMENT_INITIATED', 'deployment', ?, ?, ?)
        `)
        .bind(`aud-${crypto.randomUUID().slice(0, 8)}`, creator, deploymentId, envName, JSON.stringify({ version, sha: commitSha }))
        .run();

      await db
        .prepare('UPDATE webhook_deliveries SET status = ? WHERE delivery_id = ?')
        .bind('processed', deliveryId)
        .run();

      return {
        duplicate: false,
        deliveryId,
        eventType,
        action: 'deployment_created',
        deploymentId,
        status: 'in_progress',
        environment: envName
      };
    }

    if (eventType === 'deployment_status') {
      const ghStatus = payload.deployment_status || {};
      const ghDep = payload.deployment || {};
      const envName = (ghDep.environment || 'local').toLowerCase();
      const state = (ghStatus.state || 'pending').toLowerCase();

      let mappedStatus: DeploymentStatus = 'in_progress';
      if (state === 'success') mappedStatus = 'success';
      else if (state === 'failure' || state === 'error') mappedStatus = 'failure';
      else if (state === 'pending') mappedStatus = 'pending';
      else if (state === 'in_progress') mappedStatus = 'in_progress';

      // Find deployment by github_deployment_id or most recent in this environment
      let depRow: { id: string; release_id: string } | null = null;
      if (ghDep.id) {
        depRow = await db
          .prepare('SELECT id, release_id FROM deployments WHERE github_deployment_id = ? LIMIT 1')
          .bind(ghDep.id)
          .first<{ id: string; release_id: string }>();
      }

      if (!depRow) {
        depRow = await db
          .prepare('SELECT id, release_id FROM deployments WHERE environment_id = ? ORDER BY started_at DESC LIMIT 1')
          .bind(envName)
          .first<{ id: string; release_id: string }>();
      }

      const depId = depRow ? depRow.id : `dep-${ghDep.id || crypto.randomUUID().slice(0, 8)}`;

      // Update deployment record
      const isTerminal = mappedStatus === 'success' || mappedStatus === 'failure';
      await db
        .prepare(`
          UPDATE deployments 
          SET status = ?, 
              completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE completed_at END,
              error_message = CASE WHEN ? = 'failure' THEN ? ELSE error_message END
          WHERE id = ?
        `)
        .bind(mappedStatus, isTerminal ? 1 : 0, mappedStatus, ghStatus.description || 'GitHub reported failure', depId)
        .run();

      // If success, update active release on environment and reset consecutive failures
      if (mappedStatus === 'success' && depRow) {
        await db
          .prepare(`
            UPDATE environments 
            SET active_release_id = ?,
                target_version = (SELECT version FROM releases WHERE id = ?),
                current_health_status = 'healthy',
                consecutive_failures = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(depRow.release_id, depRow.release_id, envName)
          .run();
      } else if (mappedStatus === 'failure') {
        await db
          .prepare(`
            UPDATE environments 
            SET current_health_status = 'degraded',
                consecutive_failures = consecutive_failures + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
          .bind(envName)
          .run();
      }

      // Record timeline event
      await db
        .prepare(`
          INSERT INTO deployment_events (id, deployment_id, status, message, details_json)
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          `ev-${crypto.randomUUID().slice(0, 8)}`,
          depId,
          mappedStatus,
          ghStatus.description || `Deployment status transitioned to ${mappedStatus}`,
          JSON.stringify(ghStatus)
        )
        .run();

      // Audit log
      await db
        .prepare(`
          INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json)
          VALUES (?, 'github-webhook', ?, 'deployment', ?, ?, ?)
        `)
        .bind(
          `aud-${crypto.randomUUID().slice(0, 8)}`,
          `DEPLOYMENT_${mappedStatus.toUpperCase()}`,
          depId,
          envName,
          JSON.stringify({ state, description: ghStatus.description })
        )
        .run();

      await db
        .prepare('UPDATE webhook_deliveries SET status = ? WHERE delivery_id = ?')
        .bind('processed', deliveryId)
        .run();

      return {
        duplicate: false,
        deliveryId,
        eventType,
        action: 'deployment_status_updated',
        deploymentId: depId,
        status: mappedStatus,
        environment: envName
      };
    }

    // Generic event handling (ping, push, etc.)
    await db
      .prepare('UPDATE webhook_deliveries SET status = ? WHERE delivery_id = ?')
      .bind('processed', deliveryId)
      .run();

    return {
      duplicate: false,
      deliveryId,
      eventType,
      action: 'event_recorded',
      message: `Event ${eventType} recorded successfully.`
    };
  } catch (err: any) {
    await db
      .prepare('UPDATE webhook_deliveries SET status = ?, error_message = ? WHERE delivery_id = ?')
      .bind('failed', err.message || 'Unknown processing error', deliveryId)
      .run();
    throw err;
  }
}
