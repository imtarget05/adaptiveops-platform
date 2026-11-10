export const SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS deployment_events (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    signature_verified INTEGER NOT NULL CHECK(signature_verified IN (0, 1)),
    payload_preview TEXT,
    status TEXT NOT NULL CHECK(status IN ('processing', 'processed', 'ignored', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_env_status ON deployments(environment_id, status);
CREATE INDEX IF NOT EXISTS idx_deployments_release ON deployments(release_id);
CREATE INDEX IF NOT EXISTS idx_deployments_started ON deployments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_env_recorded ON health_metrics(environment_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_deliveries(status, created_at DESC);

-- 8. Events ledger (Reliable Event Delivery)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    subject TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    target_url TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'failed', 'dlq')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP,
    delivered_at TIMESTAMP,
    deduplication_window_seconds INTEGER NOT NULL DEFAULT 86400,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_events_idempotency_key ON events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_events_status_next_retry ON events(status, next_retry_at);

-- 9. Event deliveries (attempt log)
CREATE TABLE IF NOT EXISTS event_deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    target_url TEXT NOT NULL,
    http_status INTEGER,
    response_body_preview TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_event_id ON event_deliveries(event_id, created_at DESC);

-- 10. Dead-letter queue
CREATE TABLE IF NOT EXISTS dlq_messages (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    last_http_status INTEGER,
    last_error_message TEXT,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    replayed INTEGER NOT NULL DEFAULT 0,
    replayed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON dlq_messages(created_at DESC);

-- 11. Release locks (concurrency/fencing) - migration 0004
CREATE TABLE IF NOT EXISTS release_locks (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    locked_by TEXT NOT NULL,
    locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ttl_seconds INTEGER NOT NULL DEFAULT 300
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_release_locks_environment ON release_locks(environment_id);

-- 12. Smoke test results - migration 0004
CREATE TABLE IF NOT EXISTS smoke_test_results (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped')),
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_smoke_test_deployment ON smoke_test_results(deployment_id, created_at DESC);

-- Release safety: schema compatibility flag on releases (migration 0004)
ALTER TABLE releases ADD COLUMN schema_compatible INTEGER NOT NULL DEFAULT 1;
`;

export const SEED_SQL = `
INSERT OR IGNORE INTO environments (id, name, description, type, current_health_status, target_version) VALUES
('local', 'Local Docker Compose', 'Local developer Docker Compose environment', 'local', 'healthy', 'v1.0.0'),
('kubernetes', 'Kubernetes (kind)', 'Local/CI Kubernetes kind cluster with Helm rolling updates', 'staging', 'healthy', 'v1.0.0'),
('cloudflare', 'Cloudflare Edge', 'Cloudflare Workers + D1 + Pages edge deployment', 'production', 'healthy', 'v1.0.0'),
('aws', 'AWS ECS Fargate', 'Amazon Web Services ECS Fargate target (dry-run ready)', 'cloud', 'unknown', 'v1.0.0'),
('azure', 'Azure Container Apps', 'Microsoft Azure Container Apps target (dry-run ready)', 'cloud', 'unknown', 'v1.0.0');

INSERT OR IGNORE INTO releases (
    id, version, commit_sha, branch, tag, git_author, commit_message, changelog, container_image_tag, metadata_json
) VALUES (
    'rel-v1.0.0',
    'v1.0.0',
    '9876543210fedcba9876543210fedcba98765432',
    'main',
    'v1.0.0',
    'github-actions[bot]',
    'feat(order-service): initial v1.0.0 baseline release',
    '- Initial production-ready order-service',
    'adaptiveops/order-service:v1.0.0',
    '{"build_number": 1}'
);

UPDATE environments SET active_release_id = 'rel-v1.0.0', target_version = 'v1.0.0', current_health_status = 'healthy' WHERE id IN ('local', 'kubernetes', 'cloudflare');

INSERT OR IGNORE INTO deployments (
    id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, started_at, completed_at
) VALUES 
('dep-init-local', 'rel-v1.0.0', 'local', 'success', 'direct', 'ci_cd', 'system-init', 'local', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('dep-init-k8s', 'rel-v1.0.0', 'kubernetes', 'success', 'rolling', 'ci_cd', 'system-init', 'kubernetes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('dep-init-cf', 'rel-v1.0.0', 'cloudflare', 'success', 'direct', 'ci_cd', 'system-init', 'cloudflare', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`;

export function parseSqlStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function setupTestDatabase(db: D1Database) {
  const tables = ['webhook_deliveries', 'dlq_messages', 'event_deliveries', 'events', 'deployment_events', 'health_metrics', 'audit_logs', 'smoke_test_results', 'release_locks', 'deployments', 'environments', 'releases'];
  for (const t of tables) {
    try {
      await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
    } catch {
      // ignore
    }
  }

  const schemaStmts = parseSqlStatements(SCHEMA_SQL);
  for (const stmt of schemaStmts) {
    await db.prepare(stmt).run();
  }

  const seedStmts = parseSqlStatements(SEED_SQL);
  for (const stmt of seedStmts) {
    await db.prepare(stmt).run();
  }
}
