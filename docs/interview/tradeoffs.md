# Tradeoffs — AdaptiveOps (`docs/interview/tradeoffs.md`)

## Deliberate Tradeoffs

| Decision | Chosen | Alternative Rejected | Reasoning |
|----------|--------|----------------------|-----------|
| Control plane runtime | Cloudflare Workers (TypeScript) | Spring Boot on Workers | Workers is V8 isolate, not JVM. ADR-001. |
| Event ledger | Cloudflare D1 | Cloudflare Queues | Queues 24h retention can't be long-term history. ADR-002. |
| Delivery guarantee | At-least-once + idempotency | Exactly-once | Exactly-once impossible without consumer cooperation. ADR-003. |
| Cloud AWS/Azure | Terraform plan-only | terraform apply | Zero-cost guardrail; no chargeable resources in demo. ADR-007. |
| DLQ implementation | D1 `dlq_messages` (verified) | Cloudflare Queues (optional) | D1 fully verifiable in vitest; Queues 24h retention. ADR-002. |
| Dispatch mechanism | Polling D1 `next_retry_at` | Push-based queue | Simpler on D1; acceptable latency for demo. |
| Rollback scope | Known-good immutable version | Auto rollback-of-rollback | Prevents infinite loops; operator confirms target. |
| Backend messaging | Outbox → publisher (planned) | Direct RabbitMQ publish | Dual-write risk avoided; publisher not yet live. |
| Metrics | Raw observed results (measure.sh) | Fabricated nice numbers | Credibility over appearance. SPEC.md constraint 6. |

## Scope Limitations (documented)
- Rate limiting on ingestion: NOT implemented (proposed).
- Cross-store atomicity (Java PG ↔ Cloudflare D1): NOT available (eventual consistency).
- Real AWS/Azure production deployment: NOT executed (plan-only).
- Load/performance testing: NOT executed (free-tier demo scale only).
- Docker Compose / kind live apply: not executed in this session (docker/kind availability varies).

## Honesty Statement
All claims in this repository are backed by code, tests, or explicit "proposed / not yet verified" labels. No decorative badges claim unverified capabilities. No fake metrics, test results, or cloud runtime experience are present.
