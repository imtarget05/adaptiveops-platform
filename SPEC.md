# SPEC.md — AdaptiveOps Reliable Event Delivery & Release Safety

**Project**: adaptiveops-platform  
**Status**: Milestones 0–2 implemented and verified; Milestones 3–4 artifacts created.  
**Repo**: `/Users/mainguyenbinhtan/Downloads/ADAPTIVEOPS-PLATFROM`

## 1. Problem Statement
See `docs/product/problem-statement.md`.

**Problem A — Unreliable asynchronous event delivery**: business events must reach external systems reliably (idempotency, retry/backoff+jitter, DLQ, replay, audit). Exactly-once is NOT claimed; at-least-once with idempotent processing.

**Problem B — Unsafe software releases**: CI can be green while production is broken. A release reliability controller runs post-deploy health + business smoke tests, detects faulty releases, performs controlled rollback, prevents conflicting deployments, and records an immutable audit timeline.

## 2. Mandatory Architecture
- Cloudflare Workers + TypeScript + Hono (control plane, production on free tier).
- Cloudflare D1 (durable ledger: events, deliveries, DLQ, releases, deployments, health, audit).
- Cloudflare Queues: optional DLQ adapter (NOT verified; D1 dlq_messages is verified).
- React + TypeScript dashboard.
- GitHub Actions as CI/CD engine.
- Java Spring Boot 21 + PostgreSQL + Flyway (order-service workload; runs in Docker/kind, NOT on Workers).
- RabbitMQ adapter (planned, not yet live).
- Terraform AWS ECS + Azure Container Apps (plan-only, cost guard exit code 7).
- Jenkinsfile + azure-pipelines.yml (CI alternatives, documented).

## 3. Critical Constraints
1. Free-tier limits respected (Workers/D1/Queues/GitHub Actions public runners).
2. Never auto-provision chargeable AWS/Azure (plan-only; verify_cost_guard exit 7).
3. Cloudflare Workers CANNOT host Spring Boot JVM.
4. Least-privilege auth, verified HMAC webhooks, idempotent processing.
5. Real health checks, rollback safeguards, tests, audit trails.
6. Every feature has reproducible verification evidence.
7. No fake deployment success, monitoring data, test results, or cloud runtime experience.
8. Do not compromise test gates to make CI green.
9. AWS/Azure labeled verified or unverified.
10. No secrets, fake metrics, or misleading claims.

## 4. Business Acceptance Scenarios (SC-01..SC-10)
Implemented & verified via vitest:
- SC-01 Happy path (event ingested → delivered → audit).
- SC-02 Duplicate idempotency key → one logical event.
- SC-03 Downstream unavailable → retry → recovery (test SKIP without controllable receiver).
- SC-04 Poison message → DLQ (test SKIP without controllable receiver).
- SC-05 Outbox crash window → durable recovery (test SKIP without fault injection).
- SC-06 Broken release → rollback to known-good.
- SC-07 Concurrent deploy → lock conflict (409).
- SC-08 Incompatible schema → rollback refused unless forced.
- SC-09 Unauthorized control-plane ops → 401.
- SC-10 Security attacks (SSRF, invalid HMAC) → rejected.

## 5. CI/CD Requirements
- Mandatory PR quality gates (`.github/workflows/ci.yml`, `security.yml`).
- Java unit + integration tests (Testcontainers).
- TypeScript unit + contract tests.
- ShellCheck for Bash scripts.
- Dependency + image vulnerability scans.
- Docker build + version tagging; immutable artifacts.
- Staging deploy; business smoke tests.
- Production deployment approval/policy.
- Controlled rollback workflow (`.github/workflows/rollback.yml`).
- Deployment concurrency protection (release locking/fencing).
- Audit evidence.
- Pinned actions; least-privilege permissions.
- Rollback cannot create infinite loop.
- Never auto-provision paid cloud.

## 6. Reliability Design Requirements
- State machines for events and releases.
- Idempotency key scope & retention (86400s default).
- Retry classification: 4xx (except 429) vs 429 vs 5xx vs network.
- Exponential backoff + jitter; bounded retries; DLQ.
- Atomicity boundaries; outbox recovery; DLQ handling; retention/cleanup.
- Webhook signing (HMAC-SHA256 constant-time); replay protection.
- Indexes, query plans, pagination, rate limiting (planned), timeouts.
- Observability (structured logs, trace ID, Prometheus).
- Migration compatibility (expand/contract); release locking/fencing.
- Explicit invariants (release only to verified-compatible version; one active transition per env; durably accepted event recoverable until retention; duplicate message ≠ duplicate logical event).

## 7. Measurement & Evidence
- `scripts/measure.sh`: raw JSONL (ts, scenario, mode, metric, value, unit); no fabricated metrics.
- Baseline WITHOUT gates vs WITH gates planned; not yet executed against live services.
- Records experiment config, workload size, repetitions, raw logs, timestamps, tool versions, actual results, limitations, interpretation.

## 8. Definition of Done (14 items)
See `tasks/todo.md` and `1794237800000-adaptiveops-reliability-platform.md` (`.kilo/plans/`). Summary:
1. Genuine business event end to end.
2. Duplicate events handled.
3. Downstream failures recovered or to DLQ.
4. Outbox failure recovery demonstrated.
5. CI/CD deploys real Cloudflare workload.
6. Post-release business verification works.
7. Broken release detected and safely reverted.
8. GitHub Actions gates enforced.
9. Production usage within free-tier budgets.
10. All critical failure scenarios have reproducible evidence.
11. Java backend tests and local container deployment work.
12. AWS/Azure labeled verified/unverified.
13. Interview docs answer deep questions using code and evidence.
14. No secrets, fake metrics, or misleading claims.

## 9. Infrastructure & Cost
- Zero recurring cost target (Cloudflare Free + public GitHub Actions).
- AWS/Azure optional, plan-only.
- Usage monitoring + budget-aware traffic generation (planned).
- Minimal production data collection.

## 10. Execution Instructions
Work in vertical slices. Start with audit (Milestone 0), then Product A (Milestone 1), Product B (Milestone 2), CI/CD + failure injection + measurement (Milestone 3), observability + security + interview docs + evidence (Milestone 4). After each milestone: report what implemented, tests passed, what failed, evidence links, risks, remaining, next priority. Do not mark complete based only on code generation; require actual test/build/run verification. Do not simulate verification results.
