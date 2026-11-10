-- migrations/0001_initial_schema.sql
-- AdaptiveOps Control Plane D1 SQL Schema

PRAGMA foreign_keys = ON;

-- 1. Environments Table
CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('local', 'staging', 'production', 'cloud')),
    active_release_id TEXT,
    target_version TEXT,
    current_health_status TEXT NOT NULL DEFAULT 'unknown' 
        CHECK(current_health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_health_check_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Releases Table
CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL UNIQUE,
    commit_sha TEXT NOT NULL,
    branch TEXT,
    tag TEXT,
    git_author TEXT NOT NULL,
    commit_message TEXT,
    changelog TEXT,
    container_image_tag TEXT,
    metadata_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Deployments Table
CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    github_deployment_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'success', 'failure', 'cancelled', 'rolled_back')),
    strategy TEXT NOT NULL DEFAULT 'rolling' CHECK(strategy IN ('rolling', 'canary', 'blue_green', 'direct')),
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('webhook', 'manual', 'rollback', 'ci_cd')),
    deployed_by TEXT NOT NULL,
    target_profile TEXT NOT NULL,
    config_snapshot_json TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    rollback_deployment_id TEXT,
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE RESTRICT,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT,
    FOREIGN KEY (rollback_deployment_id) REFERENCES deployments(id) ON DELETE SET NULL
);

-- 4. Deployment Events Table (Timeline Audit)
CREATE TABLE IF NOT EXISTS deployment_events (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);

-- 5. Health Metrics Table
CREATE TABLE IF NOT EXISTS health_metrics (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    deployment_id TEXT,
    service_name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('healthy', 'degraded', 'unhealthy')),
    probe_type TEXT NOT NULL CHECK(probe_type IN ('liveness', 'readiness', 'smoke', 'synthetic')),
    details_json TEXT,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE SET NULL
);

-- 6. Immutable Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    environment_id TEXT,
    details_json TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL
);

-- 7. Webhook Deliveries Deduplication Table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    signature_verified INTEGER NOT NULL CHECK(signature_verified IN (0, 1)),
    payload_preview TEXT,
    status TEXT NOT NULL CHECK(status IN ('processing', 'processed', 'ignored', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_deployments_env_status ON deployments(environment_id, status);
CREATE INDEX IF NOT EXISTS idx_deployments_release ON deployments(release_id);
CREATE INDEX IF NOT EXISTS idx_deployments_started ON deployments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_env_recorded ON health_metrics(environment_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_deliveries(status, created_at DESC);
