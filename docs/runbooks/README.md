# Runbooks (`docs/runbooks/` placeholder index)

## Runbook: Controlled Rollback
**Trigger**: Post-deployment smoke test failure or business regression detected.
**Steps**:
1. Query Control Plane rollback candidates: `GET /api/v1/rollback/candidates/{environment}`.
2. Confirm target version is known-good and schema_compatible = 1.
3. Execute rollback: `POST /api/v1/rollback` with `environment`, `reason`, `triggered_by`. (Use `force: true` ONLY after incident review for schema-incompatible targets.)
4. Verify post-rollback health: `scripts/health_check.sh --target {environment}`.
5. Confirm audit record: `GET /api/v1/audit` filtered by environment.
**Guardrails**: Release lock prevents concurrent deployment/rollback (409 if locked). Rollback never re-triggers itself.

## Runbook: DLQ Replay
**Trigger**: Event in `dlq_messages` after exhausting retry budget.
**Steps**:
1. List DLQ: `GET /api/v1/events/dlq`.
2. Inspect failure reason: `last_error_message`, `last_http_status`, `total_attempts`.
3. Confirm downstream is healthy.
4. Replay: `POST /api/v1/events/dlq/{id}/replay` (admin auth required).
5. Verify delivery: poll `GET /api/v1/events/{event_id}` until status `delivered`.
**Safety**: Idempotency key prevents duplicate logical events if original already delivered.

## Runbook: Outbox Recovery (Java backend)
**Trigger**: Outbox PENDING rows older than threshold.
**Steps**:
1. Query `outbox_messages` where status='PENDING'.
2. Confirm database transaction committed (order exists).
3. Dispatcher republishes pending rows (planned; not yet live).
4. Monitor `processed_at` and `retry_count`.
**Note**: Outbox publisher/dispatcher not yet connected to a live broker (Milestone 4 planned).

## Runbook: Incompatible Schema Migration
**Trigger**: Rollback refused with "schema-compatible" error (SC-08).
**Steps**:
1. Do NOT force rollback over migrated schema.
2. Design expand/contract migration: deploy backward-compatible schema first.
3. Verify old + new code both work with new schema.
4. Then perform controlled rollback or forward fix.
5. Record incident in audit log.

## Status
Runbooks directory created; full procedural content to be completed in Milestone 4.
