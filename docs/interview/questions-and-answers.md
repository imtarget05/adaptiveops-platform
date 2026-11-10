# Interview Questions & Answers — AdaptiveOps (`docs/interview/questions-and-answers.md`)

**Purpose**: Adversarial technical interview preparation. Every answer links to repository code and actual test output — no fabricated claims.  
**Rule**: Implemented functionality is distinguished from proposed functionality. Where a scenario has not been executed against live services, it is labeled "proposed / not yet verified".

---

## 1. Reliable Event Delivery (Product A)

### Q1. Why use transactional outbox instead of writing to DB then publishing a message?
**Why asked**: Tests understanding of atomicity and dual-write failure.  
**Design decision**: Order creation and outbox insert happen in the same local transaction (`OrderServiceImpl.createOrder`, `order-service/src/main/java/.../service/OrderServiceImpl.java:100-112`). `OutboxService.saveEvent` runs with `Propagation.MANDATORY` inside the same transaction.  
**Evidence**: `order-service/src/main/java/com/adaptiveops/orderservice/outbox/OutboxService.java`; Flyway `V2__create_outbox_table.sql`. Test: `order-service/src/test/java/.../integration/TransactionalOutboxIntegrationTest.java` (verified via `./mvnw test`, EXIT_CODE=0).  
**Answer**: A dual-write (commit DB, then publish to queue) can lose events if the publish fails after the commit. The outbox makes the event durable atomically with the business state; a separate dispatcher republishes pending rows.  
**Tradeoffs**: Extra table, extra dispatcher process, eventual consistency (not immediate).  
**Cannot guarantee**: Exactly-once delivery without consumer cooperation; dispatcher crash between outbox write and publish leaves a PENDING row (recovered by outbox poller).

### Q2. If the consumer processes the message but crashes before ACK, what happens?
**Why asked**: Probes at-least-once vs exactly-once and idempotency.  
**Design decision**: Delivery is at-least-once. The consumer must be idempotent (idempotency key). Re-delivery after crash is expected; the consumer deduplicates by idempotency key.  
**Evidence**: `order-service/src/main/java/com/adaptiveops/orderservice/idempotency/IdempotentExecutionFilter.java` (Idempotency-Key header, request hash, COMPLETED/PROCESSING states). Test: `OrderControllerMockMvcTest.java`, `IdempotencyIntegrationTest.java`.  
**Answer**: The message is re-delivered (at-least-once). The idempotent consumer detects the duplicate idempotency key and returns the cached response without creating a duplicate logical event.  
**Tradeoffs**: Consumer must store idempotency records; memory/DB cost; retention window must be bounded.  
**Cannot guarantee**: Exactly-once across arbitrary HTTP consumers that do not implement idempotency.

### Q3. Won't continuous retry overload the downstream system?
**Why asked**: Probes backoff, jitter, rate limiting, circuit breakers.  
**Design decision**: Bounded exponential backoff with jitter (`computeBackoffMs` in `control-plane/src/services/eventService.ts:242`), max retries (default 5), then DLQ. 429/5xx/network = retryable; other 4xx = permanent failure → DLQ.  
**Evidence**: `control-plane/src/services/eventService.ts` (markFailed / computeBackoff), `control-plane/src/services/deliveryService.ts` (classifyHttpStatus).  
**Answer**: Retry budget is bounded; after max retries the event moves to DLQ instead of retrying forever. Jitter prevents thundering herd.  
**Tradeoffs**: Longer recovery time for transient failures; DLQ requires manual replay.  
**Cannot guarantee**: No temporary overload during the bounded retry window.

### Q4. What is the idempotency key scope and retention?
**Why asked**: Probes deduplication window design.  
**Design decision**: `deduplication_window_seconds` (default 86400 = 24h) per event; unique index `ux_events_idempotency_key` on D1 `events` table.  
**Evidence**: `control-plane/migrations/0003_event_delivery.sql` (events table + unique index); `eventService.ts` ingestEvent dedup check.  
**Answer**: Same idempotency key within the retention window → exactly one logical event. After the window expires, a new event with the same key is treated as new.  
**Tradeoffs**: Longer window = more dedup safety but larger index; shorter window = risk of duplicate logical events after expiry.  
**Cannot guarantee**: Cross-window duplicates (same key reused after retention expiry).

### Q5. How does DLQ replay work, and is it safe?
**Why asked**: Probes manual recovery and replay idempotency.  
**Design decision**: `replayDlq` sets event back to PENDING with retry_count=0 and marks dlq_messages.replayed=1. Replay is authorized (adminAuthMiddleware).  
**Evidence**: `control-plane/src/services/eventService.ts` (replayDlq, listDlq); route `POST /api/v1/events/dlq/:id/replay`.  
**Answer**: Operator replays a DLQ message; the event returns to PENDING and is redelivered. Idempotency key prevents duplicate logical events if the original was already delivered.  
**Tradeoffs**: Manual step; operator must verify the downstream can handle redelivery.  
**Cannot guarantee**: Safe replay if the downstream is not idempotent and the original delivery partially succeeded.

### Q6. Why not use Kafka instead of Cloudflare Queues / D1?
**Why asked**: Probes operational complexity vs workload requirements.  
**Design decision**: D1 is the durable ledger (long-term history). Cloudflare Queues (10k ops/day, 24h retention) is documented as an optional DLQ adapter but is NOT the verified implementation. Kafka would add operational overhead (cluster, ops, cost) unjustified for a low-volume demo.  
**Evidence**: `docs/architecture/decisions.md` ADR-002; `deploy/terraform/aws` & `azure` (plan-only, no Kafka).  
**Answer**: For this workload (low-volume, demo, zero recurring cost), D1 + optional Queues is simpler and cheaper than operating Kafka. Kafka is justified only at high throughput or when needing long log compaction.  
**Tradeoffs**: D1 has read/write quotas; Kafka scales higher but costs more to operate.  
**Cannot guarantee**: Kafka-level throughput or log compaction.

### Q7. How do you prevent SSRF through webhook target URLs?
**Why asked**: Probes input validation and server-side request forgery.  
**Design decision**: `isAllowedTargetUrl` blocks http/https only; blocks private/internal hosts (10/8, 172.16/12, 192.168/16, 169.254.169.254 metadata, fe80:/fc00: IPv6). localhost allowed for dev.  
**Evidence**: `control-plane/src/services/deliveryService.ts` (isAllowedTargetUrl); route `GET /api/v1/events/target/validate`. Test SC-10 SSRF in `tests/release-safety.test.ts` (verified).  
**Answer**: Target URL is parsed and validated before fetch; private/metadata hosts return "blocked (SSRF)".  
**Tradeoffs**: localhost allowed for local dev (acceptable, not production).  
**Cannot guarantee**: DNS rebinding attacks after validation (mitigated by short-lived validation + fetch immediately).

---

## 2. Release Reliability Control (Product B)

### Q8. Why isn't GitHub Actions enough to verify production correctness?
**Why asked**: Distinguishes CI correctness from runtime/business correctness.  
**Design decision**: GitHub Actions verifies build/test/package. AdaptiveOps adds post-deployment health checks + business-level synthetic smoke tests + release health policies.  
**Evidence**: `control-plane/src/routes/smoke-tests.ts` (POST /api/v1/smoke-tests); `control-plane/src/services/smokeTestService.ts`. Not yet wired into a live GitHub deployment (proposed).  
**Answer**: CI can be green while the deployed app is functionally broken (e.g., a business regression not covered by unit tests). AdaptiveOps runs real business verification after deploy and gates promotion.  
**Tradeoffs**: Adds deployment latency; requires test environment access.  
**Cannot guarantee**: Detection of regressions not covered by smoke tests.

### Q9. What happens if you roll back code but the database schema has already changed?
**Why asked**: Probes expand/contract migrations and rollback safety.  
**Design decision**: Rollback refused when `schema_compatible = 0` unless forced (`options.force`). Incompatible migration triggers an actionable incident.  
**Evidence**: `control-plane/src/services/rollbackService.ts` (schema-compatibility guard); migration `0004_release_safety.sql` (schema_compatible column). Test SC-08 (verified).  
**Answer**: Automatic rollback is refused when restoring old code would be unsafe over a migrated schema. Requires controlled remediation (expand/contract: deploy backward-compatible schema first).  
**Tradeoffs**: Slower recovery for incompatible changes; requires discipline in migration design.  
**Cannot guarantee**: Data safety if operator forces rollback over an incompatible schema.

### Q10. What if two deployments run concurrently / rollback at the same time?
**Why asked**: Probes release locking, concurrency, fencing.  
**Design decision**: `release_locks` table; one active lock per environment (unique index `ux_release_locks_environment`). Second lock attempt → 409. Rollback acquires lock before executing; releases in finally.  
**Evidence**: `control-plane/src/services/releaseLockService.ts`; `rollbackService.ts` (acquireLock before execute, releaseLock in finally). Test SC-07 (verified).  
**Answer**: Competing deployments are serialized or explicitly rejected; stale rollback decisions prevented.  
**Tradeoffs**: Lock TTL must balance crash recovery vs holding locks too long.  
**Cannot guarantee**: Lock safety if the operator bypasses the API and edits D1 directly.

### Q11. Can rollback create an infinite deployment loop?
**Why asked**: Probes safety of automated rollback.  
**Design decision**: Rollback targets a known-good immutable version (commit SHA + platform version ID). It does not re-trigger the same deployment pipeline; it records a rollback deployment event and audit log. No recursive rollback-of-rollback.  
**Evidence**: `rollbackService.ts` (target_version immutable, status 'initiated', audit log). Not yet exercised end-to-end against live Cloudflare (proposed).  
**Answer**: Rollback selects a verified compatible version and records it; it does not invoke itself.  
**Tradeoffs**: Operator must ensure the target version is genuinely known-good.  
**Cannot guarantee**: Prevents loops only if callers don't programmatically re-roll back to the same failing version.

---

## 3. Cloud & Multi-Cloud

### Q12. Can Cloudflare Workers run Spring Boot (JVM)?
**Why asked**: Tests whether the candidate falsely claims JVM on Workers.  
**Design decision**: NO. Cloudflare Workers is a V8 isolate, not a JVM host. Control plane = TypeScript (Workers + D1). Order-service (Java Spring Boot) runs in Docker / kind / cloud adapters only.  
**Evidence**: `docs/architecture/decisions.md` ADR-001; `control-plane/src/index.ts` (Hono/TypeScript); `order-service/Dockerfile` (multi-stage, non-root).  
**Answer**: Explicitly denied. Claiming Spring Boot on Workers would be false.  
**Tradecodes**: Separation of control plane (TS) and workload (Java) is intentional.  
**Cannot guarantee**: N/A (this is a correctness constraint).

### Q13. If moving to AWS or Azure, what must change?
**Why asked**: Probes cloud portability, adapters, IAM, networking.  
**Design decision**: Terraform modules for AWS ECS and Azure Container Apps exist but are plan-only (`enable_chargeable_resources=false`, cost guard exit code 7). OIDC auth used (no long-lived access keys).  
**Evidence**: `deploy/terraform/aws`, `deploy/terraform/azure` (plan-only, validate pass); `.github/workflows/deploy-aws.yml` / `deploy-azure.yml` (OIDC, plan-only).  
**Answer**: Change the deployment adapter (Terraform module + IAM role + networking). The Java workload (Docker image) is unchanged. Auth moves to OIDC. Observability adapters (CloudWatch / Azure Monitor) added.  
**Tradeoffs**: Each cloud has different IAM, networking, and service quotas; abstraction leaks.  
**Cannot guarantee**: Actual AWS/Azure deployment has NOT been executed (plan-only, zero cost).

### Q14. Why are AWS/Azure labeled plan-only?
**Why asked**: Probes cost discipline and honesty about unverified claims.  
**Design decision**: `verify_cost_guard` exits code 7 unless `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES=true`. Terraform runs `validate` + `plan` only, never `apply`.  
**Evidence**: `scripts/lib/common.sh` (verify_cost_guard); `deploy.sh` (aws/azure cases run plan only); workflows `deploy-aws.yml` / `deploy-azure.yml`.  
**Answer**: To avoid unintended chargeable resources in a public demo. Cloud capability is documented accurately as "plan-only / unverified".  
**Tradeoffs**: Cannot demonstrate real cloud runtime behavior without credentials and budget approval.  
**Cannot guarantee**: Real-world cloud deployment behavior.

---

## 4. Security

### Q15. How are GitHub webhooks verified?
**Why asked**: Probes HMAC verification and replay protection.  
**Design decision**: HMAC-SHA256 with constant-time Web Crypto verification; `X-GitHub-Delivery` deduplication rejects replays (202 already_processed). Invalid signature → 401.  
**Evidence**: `control-plane/src/services/cryptoService.ts` (verifyGitHubSignature); `webhookService.ts` (dedup). Test: `tests/adversarial.test.ts` (HMAC forgery, replay).  
**Answer**: Signature verified before processing; delivery ID deduplicated; replay returns 202.  
**Tradeoffs**: Requires secret management for the webhook secret.  
**Cannot guarantee**: Protection if the webhook secret is leaked.

### Q16. How are secrets managed (no long-lived cloud keys)?
**Why asked**: Probes least-privilege and secret exposure.  
**Design decision**: OIDC for cloud auth (GitHub Actions → cloud provider, no access keys in repo). Admin API key for control plane (dev value only; not committed with real secrets).  
**Evidence**: `.github/workflows/deploy-aws.yml` / `deploy-azure.yml` (OIDC); `wrangler.toml` has dev placeholder secrets (documented, not real).  
**Answer**: No long-lived cloud credentials in source. Short-lived OIDC tokens per run.  
**Tradeoffs**: OIDC requires IdP setup per cloud.  
**Cannot guarantee**: No secret leakage if repository settings are misconfigured.

### Q17. How is rate limiting / abuse handled on event ingestion?
**Why asked**: Probes protection against excessive event requests.  
**Design decision**: Rate limiting is documented as required but not yet implemented in code (proposed). HMAC + idempotency provide some protection.  
**Evidence**: `docs/architecture/decisions.md` ADR-010 (rate limiting listed as requirement); no rate-limit middleware in `control-plane/src/middleware/`.  
**Answer**: Not yet implemented; planned via middleware on `/api/v1/events`.  
**Tradeoffs**: Adds latency and state (e.g., Redis/KV counter).  
**Cannot guarantee**: Abuse protection until implemented.

---

## 5. Observability & Reliability Measurement

### Q18. How did you measure the product's effectiveness?
**Why asked**: Probes whether the candidate fabricated metrics.  
**Design decision**: Measurement harness (`scripts/measure.sh`) records raw JSONL: timestamps, scenario, mode, metric, value, unit. Baseline WITHOUT gates vs WITH gates planned; not yet executed against live services.  
**Evidence**: `scripts/measure.sh` (output format); `tests/measurement_results/` (empty until run).  
**Answer**: No metrics fabricated. All values are raw observed results; where services aren't running, the script reports SKIP.  
**Tradeoffs**: Measurement requires running services; adds experiment overhead.  
**Cannot guarantee**: Measured improvement without executing the controlled experiment.

### Q19. What are fault detection time and recovery time targets?
**Why asked**: Probes SLO/SLI thinking.  
**Design decision**: Targets proposed (detection < 2 min, recovery < 5 min) but not yet measured against live failure scenarios.  
**Evidence**: Original design doc (SC targets); not yet in code.  
**Answer**: Proposed targets; actual values pending experiment execution.  
**Tradeoffs**: Aggressive targets increase false-positive rollbacks.  
**Cannot guarantee**: Targets met without measurement.

### Q20. What cannot the system guarantee?
**Why asked**: Probes honesty about limitations.  
**Design decision**: Explicitly documented: exactly-once delivery (without consumer cooperation), real AWS/Azure production deployment, Kafka-level throughput, rate-limit abuse protection, automatic remediation of incompatible schema.  
**Evidence**: `docs/architecture/decisions.md` (constraints); `SPEC.md` (constraints 1-10).  
**Answer**: Listed above with reasoning for each.  
**Tradeoffs**: Honesty about limits builds credibility; overclaiming destroys it.  
**Cannot guarantee**: N/A (this is a limitations statement).

---

## 6. Architecture Deep-Dive

### Q21. Draw the architecture and explain data flow for one business event.
**Why asked**: Probes system-design communication.  
**Design decision**: Producer → POST /api/v1/events (HMAC, idempotency, schema validation) → D1 `events` (PENDING) → dispatcher polls `next_retry_at` → `deliveryService.deliverEvent` (fetch target, SSRF check, classify 2xx/429-5xx/network) → D1 `event_deliveries` + mark delivered/failed/DLQ → audit log.  
**Evidence**: `control-plane/src/routes/events.ts`; `eventService.ts`; `deliveryService.ts`; `0003_event_delivery.sql`.  
**Answer**: [Walk the diagram; link to files.]  
**Tradeoffs**: Polling-based dispatcher vs push-based queue; polling is simpler for D1.  
**Cannot guarantee**: Sub-second delivery latency (polling interval).

### Q22. How does the release state machine work?
**Why asked**: Probes release lifecycle modeling.  
**Design decision**: Release states: created → deployed → success/failure → rolled_back. Deployment statuses: pending, in_progress, success, failure, cancelled, rolled_back. Locking prevents two active transitions per environment.  
**Evidence**: `0001_initial_schema.sql` (deployments.status CHECK); `rollbackService.ts` (executeRollback transitions).  
**Answer**: [Describe transitions; link to schema and service.]  
**Tradeoffs**: State machine adds complexity but prevents invalid states.  
**Cannot guarantee**: Prevention of invalid states if DB constraints are bypassed.

### Q23. How is audit immutability enforced?
**Why asked**: Probes audit trail trustworthiness.  
**Design decision**: `audit_logs` table; API rejects PUT/PATCH/DELETE on audit (405). Records include actor, action, target_type, target_id, environment_id, details_json, created_at.  
**Evidence**: `0001_initial_schema.sql` (audit_logs); `control-plane/src/routes/audit.ts` (405 on mutating methods). Test: `tests/adversarial.test.ts` / `test-audit-logging.mjs`.  
**Answer**: Audit entries are insert-only; mutating HTTP methods rejected.  
**Tradeoffs**: No soft-delete; storage grows.  
**Cannot guarantee**: Immutability if DB admin bypasses the API.

### Q24. What are the atomicity boundaries?
**Why asked**: Probes transaction design.  
**Design decision**: Order + outbox in one DB transaction (Java/PostgreSQL). Event ingestion + dedup in one D1 statement (INSERT with unique index). Rollback batch via `db.batch` (D1 atomic batch).  
**Evidence**: `OrderServiceImpl.java` (@Transactional); `eventService.ts` (ingestEvent INSERT); `rollbackService.ts` (db.batch).  
**Answer**: [List boundaries per store.]  
**Tradeoffs**: Cross-store atomicity (Java DB ↔ D1) is not available; eventual consistency between them.  
**Cannot guarantee**: Cross-store atomicity.

### Q25. What is the retry classification logic?
**Why asked**: Probes HTTP semantics handling.  
**Design decision**: 2xx = delivered. 429 / 5xx / network = retryable. Other 4xx = permanent failure → DLQ (no retry).  
**Evidence**: `deliveryService.ts` (classifyHttpStatus); `eventService.ts` (markFailed → DLQ).  
**Answer**: [Classify each status family.]  
**Tradeoffs**: 429 retries may add load during rate-limit windows.  
**Cannot guarantee**: No load during 429 retry window.

---

## 7. Backend Deep-Dive

### Q26. How does optimistic locking work in Order Service?
**Why asked**: Probes concurrency control.  
**Design decision**: `@Version` on `Order.version`; manual guard in `updateOrderStatus` compares expectedVersion; conflict → `ObjectOptimisticLockingFailureException` → HTTP 409.  
**Evidence**: `domain/model/Order.java` (@Version); `OrderServiceImpl.java:155-159`; `OrderController.java:123-136` (If-Match). Test: `OrderConcurrencyIntegrationTest.java`.  
**Answer**: Client sends If-Match = version; server rejects if version changed → 409.  
**Tradeoffs**: Retry burden on client; version mismatch under high contention.  
**Cannot guarantee**: Lost-update prevention if client ignores 409.

### Q27. How does the order FSM enforce valid transitions?
**Why asked**: Probes business rule encapsulation.  
**Design decision**: `OrderStatus.validateTransition(nextStatus)`; illegal leap → `InvalidStateTransitionException` → 422.  
**Evidence**: `domain/model/OrderStatus.java`; `domain/model/Order.java:143-150`; test `OrderStatusTransitionTest.java`.  
**Answer**: State transitions validated in domain model; API returns 422 for illegal leaps.  
**Tradeoffs**: Business rules centralized in domain (good); API must expose valid transitions to clients.  
**Cannot guarantee**: Clients knowing valid transitions without documentation.

### Q28. How is idempotency implemented at the HTTP layer?
**Why asked**: Probes idempotent execution filter.  
**Design decision**: `IdempotentExecutionFilter` (OncePerRequestFilter) intercepts POST/PUT/PATCH, computes SHA-256 of method+path+body, stores IdempotencyRecord (PROCESSING→COMPLETED), returns cached response on duplicate key.  
**Evidence**: `idempotency/IdempotentExecutionFilter.java`; `V3__create_idempotency_table.sql`.  
**Answer**: [Describe filter flow.]  
**Tradeoffs**: Response body cached in memory (ContentCachingResponseWrapper); large payloads cost memory.  
**Cannot guarantee**: Idempotency for requests without Idempotency-Key header (skipped).

### Q29. How are health probes structured?
**Why asked**: Probes liveness/readiness separation.  
**Design decision**: Spring Boot Actuator with liveness/readiness probes enabled; `/actuator/health/liveness`, `/actuator/health/readiness`; DB and Rabbit health indicators.  
**Evidence**: `application.yml` (management.endpoint.health.probes); `ActuatorEndpointsIntegrationTest.java`.  
**Answer**: Liveness = process alive; Readiness = DB + RabbitMQ reachable.  
**Tradeoffs**: Readiness failure removes from service; may cause cascading failover.  
**Cannot guarantee**: Readiness reflects deep dependency health beyond configured indicators.

### Q30. How is the Docker image secured?
**Why asked**: Probes container hardening.  
**Design decision**: Multi-stage build; non-root user; HEALTHCHECK; no secrets in image.  
**Evidence**: `order-service/Dockerfile`; Trivy scan in `.github/workflows/security.yml`.  
**Answer**: Non-root user; healthcheck; scanned for vulnerabilities.  
**Tradeoffs**: Non-root may require port >1024 or capabilities config.  
**Cannot guarantee**: Image free of all vulnerabilities (scan reduces, not eliminates).

---

## 8. DevOps Deep-Dive

### Q31. What CI gates block a merge?
**Why asked**: Probes CI quality standards.  
**Design decision**: Mandatory PR checks: Java unit + integration tests, TypeScript unit + contract tests, ShellCheck, SAST, secret scan, image scan, Docker build + tag.  
**Evidence**: `.github/workflows/ci.yml`, `security.yml`.  
**Answer**: [List gates from workflow files.]  
**Tradeoffs**: Strict gates slow down merging; improve quality.  
**Cannot guarantee**: Production safety if CI passes but runtime is broken (Product B addresses).

### Q32. How is rollback orchestrated in CI/CD?
**Why asked**: Probes rollback workflow.  
**Design decision**: `.github/workflows/rollback.yml`: dispatch via workflow_dispatch, resolve candidate from Control Plane, execute `scripts/rollback.sh`, record audit.  
**Evidence**: `rollback.yml`; `scripts/rollback.sh`.  
**Answer**: [Describe rollback flow.]  
**Tradeoffs**: Manual trigger; operator must confirm.  
**Cannot guarantee**: Auto-rollback without business verification (planned, not implemented).

### Q33. How are Bash scripts verified?
**Why asked**: Probes shell scripting quality.  
**Design decision**: ShellCheck on all scripts; exit code conventions (0/1/2/3/4/5/6/7); `set -euo pipefail`; trap ERR.  
**Evidence**: `scripts/lib/common.sh` (exit codes); `shellcheck` in CI.  
**Answer**: [Describe conventions.]  
**Tradeoffs**: Strict error handling may abort on non-critical warnings.  
**Cannot guarantee**: Bug-free scripts (ShellCheck catches issues, not logic bugs).

### Q34. What is the zero-cost cloud guardrail?
**Why asked**: Probes cost discipline.  
**Design decision**: `verify_cost_guard` exits 7 for AWS/Azure unless `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES=true`. Terraform plan-only.  
**Evidence**: `common.sh`; `deploy.sh`; `deploy-aws.yml` / `deploy-azure.yml`.  
**Answer**: [Describe guardrail.]  
**Tradeoffs**: Blocks legitimate cloud deploy until opt-in.  
**Cannot guarantee**: No cost if credentials are misconfigured outside the script.

### Q35. How is deployment concurrency protected?
**Why asked**: Probes release locking.  
**Design decision**: `release_locks` table; `acquireLock` before deployment/rollback; `releaseLock` after; TTL-based stale lock cleanup.  
**Evidence**: `releaseLockService.ts`; route `/api/v1/release-locks`. Test SC-07.  
**Answer**: [Describe locking.]  
**Tradeoffs**: Lock TTL tuning.  
**Cannot guarantee**: Concurrency safety if API bypassed.

---

## 9. Cost & Operations

### Q36. What are the Cloudflare free-tier limits and how do you stay within them?
**Why asked**: Probes cost-aware design.  
**Design decision**: Workers Free 100k req/day; D1 5M rows read / 100k rows written per day; Queues Free 10k ops/day / 24h retention. Budget-aware traffic generation; minimal data collection.  
**Evidence**: Design doc (cost section); `config/targets.yaml` (cloudflare enabled, production).  
**Answer**: [List limits; describe budget-aware design.]  
**Tradeoffs**: Low-volume demo only; not production-scale.  
**Cannot guarantee**: Staying within limits under unexpected traffic spike.

### Q37. What is the cost of running this demo?
**Why asked**: Probes honesty about operational cost.  
**Design decision**: Zero recurring cost target (Cloudflare Free + GitHub Actions public runners). AWS/Azure plan-only (no apply).  
**Evidence**: `docs/architecture/decisions.md` ADR-007; `SPEC.md` cost restrictions.  
**Answer**: $0 recurring for the demo; cloud = plan-only.  
**Tradeoffs**: Free-tier limits constrain scale.  
**Cannot guarantee**: $0 if Cloudflare/GitHub change free-tier terms.

### Q38. How do you handle D1 quota exhaustion?
**Why asked**: Probes capacity planning and graceful degradation.  
**Design decision**: Capacity planning documented; graceful degradation not yet implemented (proposed). Monitoring against limits planned.  
**Evidence**: Design doc (capacity planning); no quota-mitigation code yet.  
**Answer**: Not yet implemented; planned via usage monitoring + write-throttling.  
**Tradeoffs**: Throttling delays events; rejection loses events (mitigated by durable ledger).  
**Cannot guarantee**: Operation beyond D1 quota without mitigation.

---

## 10. Tradeoffs & Honesty

### Q39. What did you deliberately NOT build, and why?
**Why asked**: Probes prioritization and scope discipline.  
**Design decision**: Did not build: Kafka (operational overhead), real AWS/Azure apply (cost), rate limiting (not yet), cross-store transactions (unavailable), exactly-once delivery (impossible without consumer cooperation).  
**Evidence**: `docs/architecture/decisions.md`; `SPEC.md` constraints.  
**Answer**: [List deliberate omissions with reasoning.]  
**Tradeoffs**: Scope limited to verifiable, demo-suitable features.  
**Cannot guarantee**: Production-scale features not built.

### Q40. What is the biggest risk in this design?
**Why asked**: Probes risk awareness.  
**Design decision**: Cross-store eventual consistency (Java PostgreSQL ↔ Cloudflare D1); untested cloud deployment (plan-only); unverified measurement claims (SKIP until run).  
**Evidence**: `docs/audit/current-state.md` (risks); `SPEC.md`.  
**Answer**: [Describe top risks and mitigations.]  
**Tradeoffs**: Accepting eventual consistency for simplicity.  
**Cannot guarantee**: Consistency across stores without distributed transactions.

### Q41. Would you recommend this for production today?
**Why asked**: Probes maturity judgment.  
**Design decision**: No — it is a verified portfolio case study with real code and tests, but cloud deployment and end-to-end measurement are not yet executed against live production services.  
**Evidence**: `docs/audit/current-state.md` (working vs incomplete); `SPEC.md` Definition of Done (14 items, partially satisfied).  
**Answer**: Suitable for demonstrating skills; not yet production-grade without completing Milestone 3-4.  
**Tradeoffs**: Transparency about maturity.  
**Cannot guarantee**: Production readiness.

---

**End of Q&A (41 questions).** Each answer distinguishes implemented/verified functionality from proposed/unverified work, per the Definition of Done.
