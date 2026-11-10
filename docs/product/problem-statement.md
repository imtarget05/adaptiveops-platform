# Problem Statement — AdaptiveOps (`docs/product/problem-statement.md`)

## Context
Small-to-mid engineering teams ship backend services (e.g. a Java Spring Boot order service) to production multiple times per day. They rely on GitHub Actions for CI, but CI correctness does not imply runtime/business correctness.

## Problem A — Unreliable asynchronous event delivery
Business events (order.created, payment.confirmed, inventory.updated) are produced by the backend and must reach external systems (inventory, CRM, accounting).

Failure modes observed in practice:
- Downstream HTTP 500 / 429 / timeouts / network interruptions
- Duplicate delivery (retry sends the same event twice)
- Lost events between database commit and message publication (dual-write failure)
- Poison messages that crash consumers
- Consumer crashes and temporary unavailability of external services

Requirement: reliable webhook/event delivery with ingestion, auth, schema validation, durable ledger, transactional outbox, at-least-once delivery, idempotency, bounded exponential backoff + jitter, DLQ, controlled manual replay, audit history, and operational metrics.

Design decision: exactly-once delivery across arbitrary HTTP consumers is impossible without consumer cooperation. We implement at-least-once delivery with idempotent processing, and document the boundary clearly.

## Problem B — Unsafe software releases
A CI pipeline can build, test, and package successfully while the deployed application is functionally broken on production (e.g. a business regression not covered by unit tests).

Requirement: a release reliability controller that:
- Receives authenticated GitHub deployment events
- Associates releases with immutable commit SHA + platform version IDs
- Runs post-deployment health checks AND business-level synthetic tests
- Evaluates release health using explicit policies
- Detects faulty deployments and performs controlled rollback
- Prevents conflicting deployments (release locking/fencing)
- Records audit events and incident timelines
- Generates verifiable release reports

Design decision: do not recreate GitHub Actions. Build the missing reliability controls around it.

## Why a dedicated platform (instead of just GitHub Actions)
- GitHub Actions knows whether the build/tests passed, not whether the business works after deploy.
- Rollback of Worker code does not reverse D1 schema changes — migrations must be backward-compatible (expand/contract).
- Event delivery needs durable retry/DLQ/replay that CI does not provide.
- Audit trail must be immutable and queryable for incident review.

## Constraints
- Zero recurring infrastructure cost for the public demo (Cloudflare Free + GitHub Actions).
- AWS/Azure remain optional and plan-only (cost guard exit code 7).
- Cloudflare Workers cannot host Spring Boot JVM.
- No fake metrics, no simulated verification, no chargeable resource auto-provisioning.
