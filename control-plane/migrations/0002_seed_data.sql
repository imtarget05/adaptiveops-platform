-- migrations/0002_seed_data.sql
-- Seed environments and baseline release

-- Seed environments
INSERT OR IGNORE INTO environments (id, name, description, type, current_health_status, target_version) VALUES
('local', 'Local Docker Compose', 'Local developer Docker Compose environment', 'local', 'healthy', 'v1.0.0'),
('kubernetes', 'Kubernetes (kind)', 'Local/CI Kubernetes kind cluster with Helm rolling updates', 'staging', 'healthy', 'v1.0.0'),
('cloudflare', 'Cloudflare Edge', 'Cloudflare Workers + D1 + Pages edge deployment', 'production', 'healthy', 'v1.0.0'),
('aws', 'AWS ECS Fargate', 'Amazon Web Services ECS Fargate target (dry-run ready)', 'cloud', 'unknown', 'v1.0.0'),
('azure', 'Azure Container Apps', 'Microsoft Azure Container Apps target (dry-run ready)', 'cloud', 'unknown', 'v1.0.0');

-- Seed baseline release v1.0.0
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
    '- Initial production-ready order-service\n- PostgreSQL idempotency and outbox support\n- Health probes configured',
    'adaptiveops/order-service:v1.0.0',
    '{"build_number": 1, "ci_provider": "github-actions"}'
);

-- Associate initial active releases on environments
UPDATE environments SET active_release_id = 'rel-v1.0.0', target_version = 'v1.0.0', current_health_status = 'healthy' WHERE id IN ('local', 'kubernetes', 'cloudflare');

-- Record baseline initial deployments
INSERT OR IGNORE INTO deployments (
    id, release_id, environment_id, status, strategy, trigger_type, deployed_by, target_profile, started_at, completed_at
) VALUES 
('dep-init-local', 'rel-v1.0.0', 'local', 'success', 'direct', 'ci_cd', 'system-init', 'local', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('dep-init-k8s', 'rel-v1.0.0', 'kubernetes', 'success', 'rolling', 'ci_cd', 'system-init', 'kubernetes', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('dep-init-cf', 'rel-v1.0.0', 'cloudflare', 'success', 'direct', 'ci_cd', 'system-init', 'cloudflare', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Record baseline audit entries
INSERT OR IGNORE INTO audit_logs (id, actor, action, target_type, target_id, environment_id, details_json) VALUES
('aud-seed-01', 'system', 'SYSTEM_INITIALIZED', 'environment', 'local', 'local', '{"message": "Local environment initialized with v1.0.0"}'),
('aud-seed-02', 'system', 'SYSTEM_INITIALIZED', 'environment', 'kubernetes', 'kubernetes', '{"message": "Kubernetes environment initialized with v1.0.0"}'),
('aud-seed-03', 'system', 'SYSTEM_INITIALIZED', 'environment', 'cloudflare', 'cloudflare', '{"message": "Cloudflare edge environment initialized with v1.0.0"}');
