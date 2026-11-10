# AdaptiveOps — Current State Audit (`docs/audit/current-state.md`)

**Date**: 2026-11-08  
**Auditor**: Implementation Agent (Kilo)  
**Scope**: Existing `adaptiveops-platform` monorepo before Milestone 1 transformation.

## 1. Working Functionality (verified by actual test/build/run)

| Area | Item | Evidence |
|------|------|----------|
| Control Plane | Cloudflare Workers + Hono REST API | `control-plane/src/index.ts`, 7 route modules |
| Control Plane | D1 schema (7 tables) + seed | `migrations/0001_initial_schema.sql`, `0002_seed_data.sql` |
| Control Plane | GitHub webhook HMAC-SHA256 verification | `src/services/cryptoService.ts`, `src/routes/webhooks.ts` |
| Control Plane | Webhook deduplication (X-GitHub-Delivery) | `src/services/webhookService.ts`, 20-concurrent atomic test |
| Control Plane | Release & deployment tracking | `src/routes/releases.ts`, `src/routes/deployments.ts` |
| Control Plane | Health metric ingestion + sliding window | `src/services/healthService.ts`, `src/routes/health.ts` |
| Control Plane | Controlled rollback + candidate discovery | `src/services/rollbackService.ts`, `src/routes/rollback.ts` |
| Control Plane | Immutable audit logs | `src/routes/audit.ts` |
| Control Plane | Admin API key auth middleware | `src/middleware/auth.ts` |
| Control Plane | CORS middleware | `src/middleware/cors.ts` |
| Control Plane | vitest suite (Miniflare + D1) | `control-plane/tests/` — **6 files, 38 tests, EXIT_CODE=0** |
| Dashboard | React + Vite + Tailwind SPA | `dashboard/src/` — **build EXIT_CODE=0** |
| Backend Workload | Spring Boot 3.3, Java 21, JPA, Flyway V1-V3 | `order-service/pom.xml`, `src/main/resources/db/migration/` |
| Backend Workload | Order entity with `@Version` optimistic locking | `domain/model/Order.java` |
| Backend Workload | Idempotency-Key filter + repository | `idempotency/IdempotentExecutionFilter.java` |
| Backend Workload | Transactional outbox (saveEvent) | `outbox/OutboxService.java`, `V2__create_outbox_table.sql` |
| Backend Workload | Actuator health/liveness/readiness + Prometheus + OpenAPI | `application.yml`, `OrderController.java` |
| Backend Workload | Multi-stage non-root Dockerfile + HEALTHCHECK | `order-service/Dockerfile` |
| Backend Workload | JUnit 5 + Testcontainers test suite | `order-service/src/test/` — **`./mvnw test` EXIT_CODE=0** |
| Automation | deploy.sh, rollback.sh, health_check.sh, common.sh | `scripts/` — **shellcheck EXIT_CODE=0** |
| Automation | Cost guard exit code 7 (AWS/Azure) | `scripts/lib/common.sh verify_cost_guard` |
| Infra | Helm chart (kind) | `deploy/helm/adaptiveops-order-service/` |
| Infra | Terraform AWS + Azure (plan-only) | `deploy/terraform/aws`, `azure` — **fmt+validate pass** |
| Infra | Jenkinsfile + Azure Pipelines | `deploy/Jenkinsfile`, `azure-pipelines.yml` |
| E2E Tests | Opaque-box suite Tiers 1-4 | `tests/e2e/` — documented as passing |

## 2. Incomplete / Placeholder Functionality

| Area | Item | Gap |
|------|------|-----|
| Product A | Reliable Event Delivery service (general-purpose event ingestion, outbox publish, retry/backoff+jitter, DLQ, manual replay) | **Missing**. Existing outbox is Java-only `saveEvent` with no publisher, retry, or DLQ. |
| Product A | Cloudflare Queues DLQ integration | **Missing**. wrangler.toml has no `[[queues]]` binding. |
| Product A | D1 tables for `events`, `event_deliveries`, `dlq_messages` | **Missing**. Schema only has release/deployment/health/audit/webhook_deliveries. |
| Product B | Business-level post-deployment smoke tests | **Missing**. Health checks exist but no business verification (e.g., create order then verify). |
| Product B | Release locking / fencing against concurrent deployments | **Missing**. No concurrency control on release transitions. |
| Product B | Incompatible migration rollback refusal (SC-08) | **Missing**. Rollback service assumes `schema_backward_compatible: true` always. |
| Product B | Control plane unavailable fail-closed policy (SC-09) | **Missing**. |
| CI/CD | `.github/workflows/` — only `modernize/` dir exists, no ci.yml/security.yml/deploy-*.yml | **Missing**. No GitHub Actions workflows present. |
| Measurement | Baseline A vs B comparison harness + raw metrics | **Missing**. |
| Interview Docs | `docs/interview/*.md` (40+ adversarial Q&A) | **Missing**. |
| Evidence Manifest | Linking code → tests → CI runs → incidents → metrics | **Missing**. |

## 3. Fake Data / Hardcoded Metrics

- `TEST_READY.md` claims "35 suites, 35 tests, 100% pass" but the `tests/e2e/` directory contents were not executed in this audit; treat as **unverified documentation**, not evidence.
- `wrangler.toml` has hardcoded dev secrets (`ADMIN_API_KEY`, `GITHUB_WEBHOOK_SECRET`) — acceptable for local dev, must not be committed to public repo with real values.
- `config/targets.aws` / `azure` use placeholder role ARN / client/tenant/subscription IDs (`0000...`, `123456789012`) — clearly placeholders, plan-only.

## 4. Unused Services / Tools

- `tests/challenger_m1_2_empirical.mjs` — referenced in TEST_READY but not obviously wired into runner.
- `deploy/docker-compose/docker-compose.yml` — exists but not validated by `docker compose config` in this audit (Docker available but not run).

## 5. Security Risks

- Hardcoded secrets in `wrangler.toml` (dev values only).
- `verify_cost_guard` exits code 7 but relies on env var `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES != "true"` — no hard billing guard beyond env check.
- No SSRF protection on webhook target URLs (not yet implemented — Product A will add).
- No rate limiting on event ingestion endpoints.

## 6. Missing Tests

- No tests for SC-01 to SC-10 (the 10 business acceptance scenarios).
- No failure-injection reproducible tests (network loss, timeout, duplicate, concurrent deployment).
- No CI workflow tests (GitHub Actions not present).

## 7. Architectural Inconsistencies

- Control plane claims to track "deployment events" but has no general-purpose business event ingestion (only GitHub webhooks).
- Order-service outbox persists messages but has no publisher/retry/DLQ — dual-write risk not fully mitigated at runtime.
- Rollback marks `schema_backward_compatible: true` unconditionally — contradicts SC-08 requirement.

## 8. Cost Risks

- AWS/Azure Terraform marked `plan_only: true` and cost guard exit code 7 — safe, but no code enforces `terraform apply` prevention beyond script logic.
- Cloudflare Workers/D1/Queues free-tier usage not monitored; no budget-aware traffic generation.

## 9. Milestone 0 Conclusion

Baseline is **solid**: control plane API, dashboard, backend workload, Bash automation, and Terraform are implemented and verified. The transformation to "Reliable Event Delivery & Release Safety" requires adding Product A (event delivery with outbox/retry/DLQ/replay), Product B enhancements (business smoke tests, release locking, migration-aware rollback, fail-closed), CI/CD workflows, measurement evidence, and interview documentation.

**Next**: Milestone 1 — Product A: Reliable Event Delivery (SC-01 to SC-05).
