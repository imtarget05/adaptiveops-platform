-- migrations/0003_event_delivery.sql
-- AdaptiveOps Control Plane D1 Schema v3: Reliable Event Delivery
-- Adds: events (durable ledger), event_deliveries (attempt tracking), dlq_messages (dead-letter queue)

PRAGMA foreign_keys = ON;

-- 8. Events ledger: durable record of every accepted business event.
-- idempotency_key scope: unique within deduplication_retention_window.
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    subject TEXT,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    target_url TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'failed', 'dlq')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP,
    delivered_at TIMESTAMP,
    deduplication_window_seconds INTEGER NOT NULL DEFAULT 86400,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_events_idempotency_key ON events(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_events_status_next_retry ON events(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

-- 9. Event deliveries: per-attempt delivery record (at-least-once attempt log).
CREATE TABLE IF NOT EXISTS event_deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    target_url TEXT NOT NULL,
    http_status INTEGER,
    response_body_preview TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deliveries_event_id ON event_deliveries(event_id, created_at DESC);

-- 10. Dead-letter queue: messages that exhausted retry budget.
CREATE TABLE IF NOT EXISTS dlq_messages (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    last_http_status INTEGER,
    last_error_message TEXT,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    replayed INTEGER NOT NULL DEFAULT 0,
    replayed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON dlq_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_replayed ON dlq_messages(replayed, created_at DESC);
