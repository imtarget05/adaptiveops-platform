# Architecture Decisions (`docs/architecture/decisions.md`)

## ADR-001: Control plane on Cloudflare Workers (TypeScript), NOT Spring Boot JVM
**Decision**: The AdaptiveOps control plane runs on Cloudflare Workers + D1. The Java Spring Boot order-service is a separate backend workload running in Docker / kind / local only — never on Workers.
**Rationale**: Cloudflare Workers is a V8 isolate, not a JVM host. Claiming Spring Boot runs on Workers would be false.
**Consequence**: Control plane API (webhook ingestion, release/rollback/audit, event delivery) is TypeScript. Order-service (Java) is deployed via Docker Compose / kind / cloud adapters.

## ADR-002: D1 as durable event ledger + DLQ (primary); Cloudflare Queues as optional adapter
**Decision**: Events, deliveries, and DLQ messages are stored in D1 tables (`events`, `event_deliveries`, `dlq_messages`). Cloudflare Queues Free (10k ops/day, 24h retention) is documented as an optional DLQ adapter but is not the verified implementation.
**Rationale**: Queues 24h retention cannot serve as long-term event history; D1 is the durable ledger. D1 DLQ is fully verifiable in vitest without Queue consumer complexity.
**Consequence**: DLQ/replay verified via D1. Queues integration left as future adapter.

## ADR-003: At-least-once delivery with idempotency (not exactly-once)
**Decision**: Event delivery is at-least-once; duplicates are collapsed by idempotency key within a retention window. Exactly-once across arbitrary HTTP consumers is not claimed.
**Rationale**: Exactly-once requires consumer cooperation (idempotent consumer + deduplication). We control the producer side (idempotency key, dedup window) and document the consumer contract.

## ADR-004: Retry classification (4xx vs 429 vs 5xx vs network)
**Decision**: 2xx = delivered. 429/5xx/network = retryable with bounded exponential backoff + jitter. Other 4xx = permanent failure → DLQ (no retry).
**Rationale**: Avoid overloading downstream with retries on client errors; retry only transient/server errors.

## ADR-005: Rollback only to verified-compatible version; schema expand/contract
**Decision**: Rollback candidate must be a previously successful release marked backward-compatible. Incompatible migrations trigger an incident, not an automatic rollback.
**Rationale**: Rolling back code does not reverse schema changes. Restoring old code over a migrated schema can destroy data.

## ADR-006: Release locking / fencing
**Decision**: One environment cannot have two active release transitions. Competing deployments are serialized or explicitly rejected.
**Rationale**: Prevent stale rollback decisions and conflicting release states.

## ADR-007: Zero-cost cloud guardrail
**Decision**: AWS/Azure Terraform is plan-only (`terraform validate` + `plan -var enable_chargeable_resources=false`). `deploy.sh`/`rollback.sh` exit code 7 unless `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES=true`.
**Rationale**: Never auto-provision chargeable resources in a public demo.

## ADR-008: HMAC-SHA256 webhook verification (constant-time)
**Decision**: GitHub webhooks and event ingestion use HMAC-SHA256 with constant-time Web Crypto verification; invalid/missing signatures rejected 401; replay protection via delivery id deduplication.
**Rationale**: Prevent forgery, tampering, and replay attacks.

## ADR-009: SSRF protection on webhook/event target URLs
**Decision**: Event `target_url` is validated: http/https only; private/internal hosts (10/8, 172.16/12, 192.168/16, 169.254.169.254 metadata, localhost allowed for dev) blocked.
**Rationale**: Prevent server-side request forgery via attacker-controlled webhook target URLs.

## ADR-010: No fake metrics / no simulated verification
**Decision**: All claims backed by raw logs, timestamps, tool versions, and actual test output. No fabricated customer numbers or business outcomes.
**Rationale**: Interview-deep credibility requires reproducible evidence, not decorative badges.
