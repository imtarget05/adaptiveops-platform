# Evidence Manifest — AdaptiveOps (`docs/evidence-manifest.md`)

**Purpose**: Link every major feature to source code, tests, actual test output, configuration, reproducible commands, failure-case verification, and documentation.  
**Principle**: No decorative badges for unverified capabilities. All claims backed by code/tests or labeled "proposed / not yet verified".

## Feature → Evidence Mapping

### 1. Event Ingestion & Idempotency (Product A)
| Item | Evidence |
|------|----------|
| Source | `control-plane/src/routes/events.ts` (POST /api/v1/events) |
| Source | `control-plane/src/services/eventService.ts` (ingestEvent, dedup) |
| Schema | `control-plane/migrations/0003_event_delivery.sql` (events table, unique idempotency_key) |
| Test | `control-plane/tests/event-delivery.test.ts` SC-01, SC-02 (verified via vitest) |
| CI | `.github/workflows/ci.yml` (control-plane-ts matrix: tsc + vitest) |
| Actual output | `npm test` → 52 tests pass (8 files), EXIT_CODE=0 (verified this session) |
| Reproducible | `cd control-plane && npm test` |

### 2. Reliable Delivery: Retry / Backoff / Jitter / DLQ
| Item | Evidence |
|------|----------|
| Source | `control-plane/src/services/deliveryService.ts` (deliverEvent, classifyHttpStatus) |
| Source | `control-plane/src/services/eventService.ts` (markFailed, computeBackoffMs, moveToDlq) |
| Schema | `control-plane/migrations/0003_event_delivery.sql` (dlq_messages) |
| Test | `control-plane/tests/event-delivery.test.ts` SC-03, SC-04, SC-05 |
| SSRF | `deliveryService.ts` (isAllowedTargetUrl); SC-10 in `tests/release-safety.test.ts` |
| Actual output | vitest SC-01..SC-05 pass; SC-06..SC-10 pass |
| Reproducible | `cd control-plane && npx vitest run tests/event-delivery.test.ts tests/release-safety.test.ts` |

### 3. Release Reliability Control (Product B)
| Item | Evidence |
|------|----------|
| Source | `control-plane/src/services/releaseLockService.ts` (fencing) |
| Source | `control-plane/src/services/rollbackService.ts` (executeRollback, schema-compat guard) |
| Source | `control-plane/src/services/smokeTestService.ts` (business smoke test) |
| Schema | `control-plane/migrations/0004_release_safety.sql` (release_locks, smoke_test_results, schema_compatible) |
| Test | `control-plane/tests/release-safety.test.ts` SC-06..SC-10 |
| CI | `.github/workflows/rollback.yml` |
| Actual output | vitest 52/52 pass; tsc --noEmit clean |
| Reproducible | `cd control-plane && npm test` |

### 4. Java Backend Workload
| Item | Evidence |
|------|----------|
| Source | `order-service/src/main/java/com/adaptiveops/orderservice/` (Entity, Repository, Service, Controller, Outbox, Idempotency) |
| Schema | `order-service/src/main/resources/db/migration/V1-V3.sql` |
| Test | `order-service/src/test/java/com/adaptiveops/orderservice/` (9 test files) |
| Build | `order-service/pom.xml`; `order-service/Dockerfile` (multi-stage, non-root) |
| Actual output | `./mvnw -B -q test` → EXIT_CODE=0 (verified Milestone 0) |
| Reproducible | `cd order-service && ./mvnw -B test` |

### 5. Bash Automation
| Item | Evidence |
|------|----------|
| Source | `scripts/deploy.sh`, `rollback.sh`, `health_check.sh`, `lib/common.sh`, `failure_injection.sh`, `measure.sh` |
| Exit codes | `scripts/lib/common.sh` (0/1/2/3/4/5/6/7) |
| Cost guard | `verify_cost_guard` (exit 7 for AWS/Azure unless opted in) |
| Quality | ShellCheck (verified EXIT_CODE=0) |
| Reproducible | `shellcheck scripts/*.sh scripts/lib/*.sh` |

### 6. CI/CD Workflows
| Item | Evidence |
|------|----------|
| CI | `.github/workflows/ci.yml` (mandatory PR gates) |
| Security | `.github/workflows/security.yml` (SAST, secret scan, image scan) |
| Release | `.github/workflows/release.yml` (Docker build + tag, GHCR, GitHub Release) |
| Deploy Cloudflare | `.github/workflows/deploy-cloudflare.yml` |
| Deploy AWS/Azure | `.github/workflows/deploy-aws.yml`, `deploy-azure.yml` (plan-only, OIDC) |
| Rollback | `.github/workflows/rollback.yml` |
| Alternatives | `deploy/Jenkinsfile`, `deploy/azure-pipelines.yml` |
| Status | Workflows created; not yet executed against live GitHub (no repo push in this session) |

### 7. Terraform / Cloud (plan-only, zero cost)
| Item | Evidence |
|------|----------|
| AWS | `deploy/terraform/aws/` (fmt+validate pass; plan-only) |
| Azure | `deploy/terraform/azure/` (fmt+validate pass; plan-only) |
| Guardrail | `scripts/lib/common.sh verify_cost_guard` (exit 7) |
| Status | Validated locally; never applied chargeable resources |

### 8. Dashboard (React + TypeScript)
| Item | Evidence |
|------|----------|
| Source | `dashboard/src/` (App.tsx, components, hooks, services, types) |
| Build | `npm run build` → EXIT_CODE=0 (verified Milestone 0) |
| Status | Build verified; not yet connected to live Control Plane URL |

## Verification Summary (this session)
| Check | Result |
|-------|--------|
| Java tests (`./mvnw test`) | EXIT_CODE=0 |
| Control Plane vitest | 8 files, 52 tests, EXIT_CODE=0 |
| TypeScript typecheck | `tsc --noEmit` clean |
| Dashboard build | EXIT_CODE=0 |
| ShellCheck all scripts | EXIT_CODE=0 |
| Terraform fmt+validate AWS | pass |
| Terraform fmt+validate Azure | pass |
| Cloudflare Workers production deploy | `https://adaptiveops-control-plane.tanmainguyenbinh.workers.dev` (Version ID: d7144242-0556-410c-a707-e9752a2116d4) |
| D1 production database | `adaptiveops-d1` (ID: 65a47b1a-5fb8-4913-9994-3dd21e0b5b3e), migrations 0001-0005 applied |
| Secrets | ADMIN_API_KEY, GITHUB_WEBHOOK_SECRET (encrypted via wrangler secret, not in repo) |
| Production API verified | GET /healthz, POST/GET /api/v1/events, SSRF block, unauthorized 401 |

## Not Yet Verified (labeled honestly)
- Live Cloudflare Workers production deployment (wrangler deploy not run).
- Real AWS/Azure deployment (plan-only; cost guard blocks apply).
- Failure injection SC-03/SC-04/SC-05 against controllable downstream (reported as SKIP in `scripts/failure_injection.sh`).
- Measurement harness `scripts/measure.sh` outputs SKIP until services are running.
- Baseline WITHOUT-gates vs WITH-gates comparison (experiment not yet executed).
- `docs/interview/` questions reference code/tests; answers distinguish implemented vs proposed.

## Evidence Locations
- Code: `control-plane/src/`, `order-service/src/main/`, `scripts/`, `deploy/`
- Tests: `control-plane/tests/`, `order-service/src/test/`, `tests/e2e/`
- Results: `tests/failure_injection_results/`, `tests/measurement_results/` (created when scripts run)
- Docs: `docs/audit/current-state.md`, `docs/product/problem-statement.md`, `docs/architecture/decisions.md`, `SPEC.md`, `tasks/plan.md`, `tasks/todo.md`, `docs/interview/*.md`, `docs/runbooks/`
