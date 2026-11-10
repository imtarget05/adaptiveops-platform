export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export type DeploymentStatus = 'pending' | 'in_progress' | 'success' | 'failure' | 'cancelled' | 'rolled_back';
export type DeploymentStrategy = 'rolling' | 'canary' | 'blue_green' | 'direct';
export type DeploymentTriggerType = 'webhook' | 'manual' | 'rollback' | 'ci_cd';

export interface Environment {
  id: string;
  name: string;
  description: string | null;
  type: string;
  active_release_id: string | null;
  target_version: string | null;
  current_health_status: HealthStatus;
  consecutive_failures: number;
  last_health_check_at: string | null;
  active_release_version?: string;
  active_release_commit_sha?: string;
  active_release_image_tag?: string;
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
  created_at: string;
}

export interface Deployment {
  id: string;
  release_id: string;
  release_version?: string;
  release_commit_sha?: string;
  release_image_tag?: string;
  environment_id: string;
  github_deployment_id: number | null;
  status: DeploymentStatus;
  strategy: DeploymentStrategy;
  trigger_type: DeploymentTriggerType;
  deployed_by: string;
  target_profile: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  rollback_deployment_id: string | null;
}

export interface HealthMetric {
  id: string;
  environment_id: string;
  service_name: string;
  endpoint_url: string;
  http_status: number;
  latency_ms: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  probe_type: string;
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
}

export interface RollbackCandidateResponse {
  environment: string;
  current_release: {
    id: string | null;
    version: string | null;
    commit_sha: string | null;
    status: string;
  };
  candidate_release: RollbackCandidate | null;
}
