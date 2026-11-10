# Implementation Plan (`tasks/plan.md`)

**Source**: `1794237800000-adaptiveops-reliability-platform.md` (in `.kilo/plans/`)  
**Repo**: `/Users/mainguyenbinhtan/Downloads/ADAPTIVEOPS-PLATFROM`

## Milestone 0 — Verify Baseline (DONE)
- Java source fully implemented (not stub): Entity, Repository, Service, Controller, Outbox, Idempotency, Flyway V1-V3.
- `./mvnw test` EXIT_CODE=0.
- control-plane vitest: 6 files, 38 tests, EXIT_CODE=0.
- dashboard build EXIT_CODE=0.
- shellcheck scripts EXIT_CODE=0.
- terraform AWS + Azure fmt+validate pass.
- `docs/audit/current-state.md` written.

## Milestone 1 — Product A: Reliable Event Delivery (DONE, verified)
- Migration `0003_event_delivery.sql`: `events`, `event_deliveries`, `dlq_messages` tables.
- `src/services/eventService.ts`: ingest, idempotency, durable ledger, retry/backoff+jitter, DLQ, replay.
- `src/services/deliveryService.ts`: deliver, retry classification, DLQ, SSRF protection, dispatch.
- `src/routes/events.ts`: POST/GET events, deliveries, DLQ list/replay, dispatch, target validation.
- Mounted in `src/index.ts` (`/api/v1/events`).
- Tests `tests/event-delivery.test.ts`: SC-01..SC-05 pass.
- Full control-plane vitest: 7 files, 43 tests pass.
- TypeScript typecheck pass.

## Milestone 2 — Product B: Release Reliability Control (IN PROGRESS)
- Business-level post-deployment smoke tests (call order-service real endpoints after deploy).
- Release health policy evaluation (3 consecutive failures → unhealthy → gate rejects).
- Release locking / fencing (one active transition per environment).
- Migration-aware rollback (SC-08): refuse rollback when schema incompatible; record incident.
- Control plane unavailable fail-closed policy (SC-09).
- Concurrent deployment protection (SC-07).
- Broken release detection + controlled rollback (SC-06).
- Rollback cannot create infinite deployment loop.

## Milestone 3 — CI/CD, Failure Injection, Measurement (PLANNED)
- `.github/workflows/`: ci.yml, security.yml, deploy-cloudflare.yml, deploy-aws.yml (plan-only), deploy-azure.yml (plan-only), release.yml, rollback.yml.
- Mandatory PR gates; ShellCheck; SAST/secret/image scans; Docker build + tag; immutable artifacts.
- Business smoke tests in CI; staging deploy; production approval.
- Failure injection harness (network loss, timeout, duplicate, concurrent deploy) with raw logs.
- Measurement harness: baseline WITHOUT gates vs WITH gates; raw metrics (detection time, recovery time, success rate, p50/p95/p99).
- Free-tier budget monitoring.

## Milestone 4 — Observability, Security, Interview Readiness (PLANNED)
- Structured JSON logs + trace ID (X-Trace-Id); Prometheus; Grafana (local).
- Security: HMAC, replay protection, SSRF, secret redaction, least-privilege auth, OIDC for cloud.
- `docs/interview/*.md`: system-design, backend-deep-dive, devops-deep-dive, security-deep-dive, failure-analysis, tradeoffs, questions-and-answers (>=40 adversarial Q&A).
- ADRs, SPEC.md, tasks/plan.md, tasks/todo.md.
- Evidence manifest linking code → tests → CI runs → incidents → metrics.
- README: architecture, diagrams, runbooks, incidents, tradeoffs, costs, measurable results. No unverified badges.

## Definition of Done (14 items)
See `1794237800000-adaptiveops-reliability-platform.md`.
