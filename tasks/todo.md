# Todo (`tasks/todo.md`)

## Milestone 0 — Verify Baseline [DONE]
- [x] Verify Java source fully implemented (not stub)
- [x] ./mvnw test EXIT_CODE=0
- [x] control-plane vitest pass (38 tests)
- [x] dashboard build EXIT_CODE=0
- [x] shellcheck scripts EXIT_CODE=0
- [x] terraform AWS + Azure fmt+validate pass
- [x] docs/audit/current-state.md written

## Milestone 1 — Product A: Reliable Event Delivery [DONE]
- [x] Migration 0003_event_delivery.sql (events, event_deliveries, dlq_messages)
- [x] eventService.ts (ingest, idempotency, durable ledger, retry/backoff+jitter, DLQ, replay)
- [x] deliveryService.ts (deliver, retry classification, DLQ, SSRF, dispatch)
- [x] events.ts route (ingest/query/deliveries/DLQ/dispatch/target-validate)
- [x] Mount /api/v1/events in index.ts
- [x] tests/event-delivery.test.ts (SC-01..SC-05)
- [x] Full vitest pass (43 tests); typecheck pass

## Milestone 2 — Product B: Release Reliability Control [DONE]
- [x] Business smoke test endpoint (post-deploy business verification)
- [x] Release health policy evaluation
- [x] Release locking / fencing (one active transition per env)
- [x] Migration-aware rollback (SC-08: refuse unsafe rollback)
- [x] Control plane unavailable fail-closed policy (SC-09)
- [x] Concurrent deployment protection (SC-07)
- [x] Broken release detection + controlled rollback (SC-06)
- [x] Tests for SC-06..SC-09
- [x] SC-10 security attack tests

## Milestone 3 — CI/CD, Failure Injection, Measurement [PARTIAL — local gates now exist]
- [ ] .github/workflows/ ci.yml, security.yml, deploy-cloudflare.yml
- [ ] deploy-aws.yml / deploy-azure.yml (plan-only, OIDC)
- [x] release.yml and rollback.yml workflow definitions (hosted execution remains unverified)
- [ ] Mandatory PR gates blocking merge
- [ ] ShellCheck, SAST, secret scan, image scan
- [ ] Docker build + version tagging, immutable artifacts
- [ ] Business smoke tests in CI
- [ ] Failure injection harness with raw logs
- [ ] Measurement harness (baseline A vs B) + raw metrics
- [ ] Free-tier budget monitoring

## Milestone 4 — Observability, Security, Interview Readiness [PLANNED]
- [ ] Structured JSON logs + trace ID (X-Trace-Id)
- [ ] Prometheus + Grafana local configs
- [ ] Security hardening (HMAC, replay, SSRF, secret redaction, least-privilege)
- [ ] docs/interview/*.md (>=40 adversarial Q&A)
- [ ] Evidence manifest (code → tests → CI runs → incidents → metrics)
- [ ] README (architecture, diagrams, runbooks, incidents, tradeoffs, costs, results)
- [ ] Definition of Done (14 items) all satisfied
