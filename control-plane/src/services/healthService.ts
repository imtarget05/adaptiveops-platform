import type { Env } from '../types/env';
import type { HealthStatus } from '../types/models';

export interface IngestHealthPayload {
  environment: string;
  service_name?: string;
  target_id?: string;
  endpoint_url?: string;
  http_status?: number;
  latency_ms?: number;
  status?: string;
  probe_type?: string;
  version?: string;
  details?: Record<string, any>;
  probes?: Record<string, any>;
}

export interface IngestHealthResult {
  acknowledged: boolean;
  metric_id: string;
  environment: string;
  environment_status: HealthStatus;
  consecutive_failures: number;
  recorded_at: string;
}

export async function ingestHealthMetric(
  env: Env,
  payload: IngestHealthPayload
): Promise<IngestHealthResult> {
  const db = env.DB;
  const envId = (payload.environment || 'local').toLowerCase();
  const serviceName = payload.service_name || payload.target_id || 'order-service';
  const endpointUrl = payload.endpoint_url || `/actuator/health`;
  const isHealthy = payload.status === 'healthy' || payload.http_status === 200;
  const httpStatus = payload.http_status ?? (isHealthy ? 200 : 503);
  const latencyMs = payload.latency_ms ?? 50;
  const metricStatus: 'healthy' | 'degraded' | 'unhealthy' =
    payload.status === 'unhealthy' || httpStatus >= 500
      ? 'unhealthy'
      : payload.status === 'degraded' || latencyMs > 1000 || (httpStatus >= 400 && httpStatus < 500)
        ? 'degraded'
        : 'healthy';

  const probeType = (['liveness', 'readiness', 'smoke', 'synthetic'].includes(payload.probe_type || '')
    ? payload.probe_type
    : 'readiness') as 'liveness' | 'readiness' | 'smoke' | 'synthetic';

  const metricId = `met-${crypto.randomUUID().slice(0, 8)}`;
  const details = {
    ...(payload.details || {}),
    ...(payload.probes ? { probes: payload.probes } : {}),
    version: payload.version
  };

  // 1. Insert metric
  await db
    .prepare(`
      INSERT INTO health_metrics (
        id, environment_id, service_name, endpoint_url, http_status, latency_ms, status, probe_type, details_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .bind(
      metricId,
      envId,
      serviceName,
      endpointUrl,
      httpStatus,
      latencyMs,
      metricStatus,
      probeType,
      JSON.stringify(details)
    )
    .run();

  // 2. Fetch last 5 probes for this environment for sliding-window evaluation
  const recentProbes = await db
    .prepare('SELECT status, http_status, latency_ms FROM health_metrics WHERE environment_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 5')
    .bind(envId)
    .all<{ status: string; http_status: number; latency_ms: number }>();

  const probes = recentProbes.results || [];
  const failureCount = probes.filter((p) => p.status === 'unhealthy' || p.http_status >= 500).length;
  const degradedCount = probes.filter((p) => p.status === 'degraded' || p.latency_ms > 1000).length;

  let newHealthStatus: HealthStatus = 'healthy';
  if (failureCount >= 3 || (metricStatus === 'unhealthy' && probeType === 'smoke')) {
    newHealthStatus = 'unhealthy';
  } else if (failureCount > 0 || degradedCount > 0) {
    newHealthStatus = 'degraded';
  } else {
    newHealthStatus = 'healthy';
  }

  // Check current consecutive failures
  const envRow = await db
    .prepare('SELECT consecutive_failures, current_health_status FROM environments WHERE id = ?')
    .bind(envId)
    .first<{ consecutive_failures: number; current_health_status: string }>();

  let consecutiveFailures = envRow?.consecutive_failures ?? 0;
  if (metricStatus === 'unhealthy') {
    consecutiveFailures += 1;
  } else if (metricStatus === 'healthy') {
    consecutiveFailures = 0;
  }

  // Update environment state
  await db
    .prepare(`
      UPDATE environments 
      SET current_health_status = ?,
          consecutive_failures = ?,
          last_health_check_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(newHealthStatus, consecutiveFailures, envId)
    .run();

  // If status transitioned to unhealthy, record audit log
  if (newHealthStatus === 'unhealthy' && envRow?.current_health_status !== 'unhealthy') {
    await db
      .prepare(`
        INSERT INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json)
        VALUES (?, 'health-monitor', 'HEALTH_ALERT_UNHEALTHY', 'environment', ?, ?, ?)
      `)
      .bind(
        `aud-${crypto.randomUUID().slice(0, 8)}`,
        envId,
        envId,
        JSON.stringify({
          consecutive_failures: consecutiveFailures,
          failureCount,
          last_probe: { http_status: httpStatus, latency_ms: latencyMs, probe_type: probeType }
        })
      )
      .run();
  }

  return {
    acknowledged: true,
    metric_id: metricId,
    environment: envId,
    environment_status: newHealthStatus,
    consecutive_failures: consecutiveFailures,
    recorded_at: new Date().toISOString()
  };
}
