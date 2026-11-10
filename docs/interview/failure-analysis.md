# Failure Analysis — AdaptiveOps (`docs/interview/failure-analysis.md`)

## Failure Modes & Handling

| Failure | Detection | Handling | Evidence |
|---------|-----------|----------|----------|
| Downstream HTTP 500 | deliveryService.classifyHttpStatus → retryable | Bounded exponential backoff + jitter; DLQ after budget | `deliveryService.ts`, `eventService.ts` |
| Downstream HTTP 429 | retryable | Backoff; DLQ if persistent | `classifyHttpStatus` |
| Network error / timeout | fetch throws / AbortController | retryable; AbortController timeout | `deliverEvent` |
| Other 4xx | permanent failure → DLQ | No retry; DLQ; manual replay | `markFailed` |
| Duplicate event | idempotency_key unique index | 2nd delivery → 202; one logical event | `ingestEvent`, SC-02 |
| Poison message | retry budget exhausted | DLQ; `replayDlq` authorized | `markFailed`, `replayDlq`, SC-04 |
| Outbox crash window | PENDING row persists | Dispatcher republishes on recovery | `eventService.ts` (SC-05 test) |
| Broken release | smoke test fails → env degraded | rollback to known-good version | `smokeTestService`, `rollbackService`, SC-06 |
| Concurrent deploy | release_locks unique index | 2nd attempt → 409 | `releaseLockService`, SC-07 |
| Incompatible schema | schema_compatible = 0 | Rollback refused unless forced | `rollbackService`, SC-08 |
| Unauthorized control-plane op | missing/invalid X-API-Key | 401 | `adminAuthMiddleware`, SC-09 |
| SSRF target | isAllowedTargetUrl | blocked; not fetched | `deliveryService.ts`, SC-10 |
| Invalid HMAC webhook | crypto verify fails | 401 | `cryptoService.ts`, SC-10 |

## What Is NOT Guaranteed (honesty)
- Exactly-once delivery without consumer cooperation (at-least-once + idempotency only).
- Rollback reverses D1 schema changes (expand/contract migrations required; incompatible schema → refuse).
- Production-scale load (Cloudflare Free quotas; not load-tested).
- AWS/Azure real deployment (plan-only, not executed).
- Rate-limit abuse protection (not implemented).

## Incident Drills (reproducible)
- `scripts/failure_injection.sh`: SC-01..SC-10 against live Control Plane + Order Service; SKIP (not fake) when services down.
- `tests/release-safety.test.ts`: SC-06..SC-10 verified via vitest (52 total tests pass across control plane).
- `tests/event-delivery.test.ts`: SC-01..SC-05 verified via vitest.

## Recovery Runbooks (planned)
- `docs/runbooks/`: rollback runbook, DLQ replay runbook, outbox recovery runbook, incompatible-schema remediation runbook. (Directory created; content to be completed.)
