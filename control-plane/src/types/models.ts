export type EnvironmentType = 'local' | 'staging' | 'production' | 'cloud';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type DeploymentStatus = 'pending' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'rolled_back';
export type DeploymentStrategy = 'rolling' | 'canary' | 'blue_green' | 'direct';
export type DeploymentTriggerType = 'webhook' | 'manual' | 'rollback' | 'ci_cd';
export type ProbeType = 'liveness' | 'readiness' | 'smoke' | 'synthetic';

export interface Environment {
  id: string;
  name: string;
  description: string | null;
  type: EnvironmentType;
  active_release_id: string | null;
  target_version: string | null;
  current_health_status: HealthStatus;
  consecutive_failures: number;
  last_health_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Release {
  id: string;
  version: string;
  commit_sha: string;
  branch: string | null;
  tag: string | null;
  git_author: string;
  commit_message: string | null;
  changelog: string | null;
  container_image_tag: string | null;
  metadata_json: string | null;
  schema_compatible: number;
  created_at: string;
}

export interface ReleaseLock {
  id: string;
  environment_id: string;
  locked_by: string;
  locked_at: string;
  ttl_seconds: number;
}

export interface Deployment {
  id: string;
  release_id: string;
  environment_id: string;
  github_deployment_id: number | null;
  status: DeploymentStatus;
  strategy: DeploymentStrategy;
  trigger_type: DeploymentTriggerType;
  deployed_by: string;
  target_profile: string;
  config_snapshot_json: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  rollback_deployment_id: string | null;
}

export interface DeploymentEvent {
  id: string;
  deployment_id: string;
  status: string;
  message: string;
  details_json: string | null;
  created_at: string;
}

export interface HealthMetric {
  id: string;
  environment_id: string;
  deployment_id: string | null;
  service_name: string;
  endpoint_url: string;
  http_status: number;
  latency_ms: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  probe_type: ProbeType;
  details_json: string | null;
  recorded_at: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  environment_id: string | null;
  details_json: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface WebhookDelivery {
  delivery_id: string;
  event_type: string;
  signature_verified: number;
  payload_preview: string | null;
  status: 'processing' | 'processed' | 'ignored' | 'failed';
  error_message: string | null;
  created_at: string;
}

export interface RollbackCandidate {
  previous_deployment_id: string;
  release_id: string;
  version: string;
  commit_sha: string;
  container_image_tag: string | null;
  last_healthy_at: string;
  rollback_safe: boolean;
  schema_backward_compatible: boolean;
  schema_compatible: number;
}

export type EventStatus = 'pending' | 'delivered' | 'failed' | 'dlq';

export interface Event {
  id: string;
  idempotency_key: string;
  event_type: string;
  source: string;
  subject: string | null;
  payload_json: string;
  payload_hash: string;
  target_url: string | null;
  status: EventStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  deduplication_window_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface EventDelivery {
  id: string;
  event_id: string;
  attempt: number;
  target_url: string;
  http_status: number | null;
  response_body_preview: string | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface DlqMessage {
  id: string;
  event_id: string;
  reason: string;
  last_http_status: number | null;
  last_error_message: string | null;
  total_attempts: number;
  replayed: number;
  replayed_at: string | null;
  created_at: string;
}

export interface IngestEventRequest {
  idempotency_key: string;
  event_type: string;
  source: string;
  subject?: string | null;
  payload: Record<string, any>;
  target_url?: string | null;
  max_retries?: number | null;
  deduplication_window_seconds?: number | null;
}

export interface IngestEventResult {
  event: Event;
  duplicate: boolean;
}

export interface DispatchResult {
  processed: number;
  delivered: number;
  failed: number;
  dlq: number;
  details: Array<{
    event_id: string;
    attempt: number;
    status: 'delivered' | 'retry' | 'dlq';
    http_status: number | null;
    error_message: string | null;
  }>;
}
