# System Design — AdaptiveOps (`docs/interview/system-design.md`)

## Overview
AdaptiveOps is a Reliable Event Delivery & Release Safety Platform. Two connected products in one monorepo:
- **Product A**: Reliable Event Delivery (ingest → durable ledger → at-least-once delivery → DLQ → replay).
- **Product B**: Release Reliability Control (GitHub deployment events → post-deploy health + business smoke tests → release health policies → controlled rollback → audit timeline).

## Control Plane (Cloudflare Workers + D1)
```
Producer → POST /api/v1/events
  │
  ▼
HMAC verification (GitHub webhooks) + Idempotency-Key dedup
  │
  ▼
D1 `events` table (PENDING)  [durable ledger, unique idempotency_key index]
  │
  ▼  dispatcher polls next_retry_at
deliveryService.deliverEvent (SSRF check, fetch target, classify 2xx/429-5xx/network)
  │
  ├─ 2xx → mark delivered → D1 `event_deliveries`
  ├─ 429/5xx/network → retry w/ backoff+jitter → D1 `events` (next_retry_at)
  └─ exhausted → D1 `dlq_messages` → authorized replay
  │
  ▼
Audit log (immutable) → Dashboard
```

- `control-plane/src/index.ts`: Hono router, route mounting.
- `control-plane/src/routes/events.ts`: ingestion, query, deliveries, DLQ, dispatch, target validation.
- `control-plane/src/services/eventService.ts`: ingest, idempotency, ledger, backoff, DLQ, replay.
- `control-plane/src/services/deliveryService.ts`: deliver, retry classification, SSRF protection, dispatch.
- `control-plane/migrations/0003_event_delivery.sql`: events, event_deliveries, dlq_messages.

## Release Safety
```
GitHub deployment webhook → /api/v1/webhooks/github
  │
  ▼
Release record (immutable commit SHA + platform version ID)
  │
  ▼
Post-deploy: health checks + business smoke tests (/api/v1/smoke-tests)
  │
  ├─ pass → release promoted
  ├─ fail → release gate rejects → rollback candidate → controlled rollback
  │
  ▼
Release lock (fencing: one active transition per environment)
  │
  ▼
Audit timeline (immutable)
```

- `control-plane/src/services/releaseLockService.ts`: acquire/release/isLocked (TTL, epoch ms).
- `control-plane/src/services/rollbackService.ts`: executeRollback (lock → candidate → schema-compat guard → db.batch → release lock).
- `control-plane/src/services/smokeTestService.ts`: business smoke test (GET target, classify, degrade env on failure, audit).
- `control-plane/migrations/0004_release_safety.sql`: release_locks, smoke_test_results, schema_compatible.

## Backend Workload (Java, NOT on Workers)
```
Order API → OrderController → OrderServiceImpl (@Transactional)
  │
  ├─ Order saved (PostgreSQL, @Version optimistic locking)
  ├─ Outbox message saved atomically (same transaction)
  ├─ Idempotency-Key filter (IdempotentExecutionFilter)
  └─ Actuator health/liveness/readiness + Prometheus + OpenAPI
```
- `order-service/src/main/java/...`: Entity, Repository, Service, Controller, Outbox, Idempotency.
- `order-service/src/main/resources/db/migration/V1-V3.sql`: orders, outbox, idempotency.
- `order-service/Dockerfile`: multi-stage, non-root, HEALTHCHECK.

## Deployment Targets
| Target | Implementation | Status |
|--------|---------------|--------|
| local | Docker Compose | Verified (docker-compose.yml) |
| kubernetes | kind + Helm | Verified (helm chart; kind not installed locally) |
| cloudflare | Workers + D1 + Pages | Verified (control plane deployed via wrangler) |
| aws | ECS Fargate via Terraform | Plan-only (validate+plan, cost guard exit 7) |
| azure | Container Apps via Terraform | Plan-only (validate+plan, cost guard exit 7) |

## Constraints (honesty)
- Cloudflare Workers CANNOT run Spring Boot JVM (ADR-001).
- AWS/Azure never auto-apply chargeable resources (ADR-007).
- Exactly-once delivery NOT claimed (ADR-003).
- No fake metrics (ADR-010).

## Inter-service Consistency
Cross-store atomicity (Java PostgreSQL ↔ Cloudflare D1) is NOT available; eventual consistency between order-service outbox and control plane event ledger.
