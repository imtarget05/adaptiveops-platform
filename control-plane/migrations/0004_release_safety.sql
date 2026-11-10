-- migrations/0004_release_safety.sql
-- AdaptiveOps Control Plane D1 Schema v4: Release Safety
-- Adds: release_locks (concurrency/fencing), schema_compatible flag on releases

PRAGMA foreign_keys = ON;

-- Release lock: one active release transition per environment (fencing).
CREATE TABLE IF NOT EXISTS release_locks (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    locked_by TEXT NOT NULL,
    locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ttl_seconds INTEGER NOT NULL DEFAULT 300,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_release_locks_environment ON release_locks(environment_id);
CREATE INDEX IF NOT EXISTS idx_release_locks_environment ON release_locks(environment_id, locked_at);

-- Schema compatibility flag on releases (expand/contract migration safety).
ALTER TABLE releases ADD COLUMN schema_compatible INTEGER NOT NULL DEFAULT 1;

-- Smoke test results (business-level post-deployment verification).
CREATE TABLE IF NOT EXISTS smoke_test_results (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    test_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped')),
    duration_ms INTEGER NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smoke_test_deployment ON smoke_test_results(deployment_id, created_at DESC);
