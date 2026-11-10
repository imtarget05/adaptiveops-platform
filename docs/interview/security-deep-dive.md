# Security Deep-Dive — AdaptiveOps (`docs/interview/security-deep-dive.md`)

## Webhook Verification (GitHub)
- `control-plane/src/services/cryptoService.ts`: `verifyGitHubSignature` uses Web Crypto `crypto.subtle.digest('SHA-256')` + constant-time comparison (`timingSafeEqual`-equivalent).
- Headers required: `X-GitHub-Delivery`, `X-GitHub-Event`, `X-Hub-Signature-256`.
- Invalid/missing signature → HTTP 401.
- `X-GitHub-Delivery` deduplication: duplicate delivery returns HTTP 202 `already_processed`.
- Test: `tests/adversarial.test.ts` (HMAC forgery, replay, invalid lengths, large payload) — verified via vitest.

## Event Ingestion Security
- HMAC verification for GitHub webhooks (`webhookService.ts`).
- `Idempotency-Key` dedup on `/api/v1/events` (unique index `ux_events_idempotency_key`).
- `isAllowedTargetUrl` (`deliveryService.ts`): http/https only; blocks 10/8, 172.16/12, 192.168/16, 169.254.169.254 (metadata), fe80:/fc00: IPv6; localhost allowed for dev.
- SSRF test (SC-10): metadata IP → `allowed: false, reason: SSRF`; localhost → `allowed: true` (verified).

## Authorization
- `adminAuthMiddleware` (`control-plane/src/middleware/auth.ts`): requires `X-API-Key` header on rollback, health ingestion, DLQ, dispatch, release-locks, smoke-tests.
- Dev value `test-admin-key` in tests; real secret must be injected via env (never committed).
- Unauthorized → HTTP 401 (verified SC-09).

## Secrets Management
- No long-lived cloud credentials in source.
- GitHub Actions uses OIDC for AWS/Azure (`configure-aws-credentials`, `azure/login`).
- `wrangler.toml` contains placeholder dev secrets only (documented, not real values).
- Cost guard: `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES` default false; exit code 7 blocks chargeable targets.

## Audit & Non-repudiation
- `audit_logs` table: actor, action, target_type, target_id, environment_id, details_json, ip_address, user_agent, created_at.
- Mutating HTTP methods on audit (PUT/PATCH/DELETE) → 405.
- Rollback/deployment/smoke-test all write audit records.

## Secrets / Risks (honesty)
- Rate limiting on event ingestion NOT yet implemented (ADR-010; proposed).
- DNS rebinding after SSRF validation not mitigated (short validation-to-fetch window).
- Audit immutability enforceable only at API layer (DB admin bypass possible).
- Dev `ADMIN_API_KEY` placeholder must be rotated before any production exposure.
