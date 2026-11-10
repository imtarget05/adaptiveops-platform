# Backend Deep-Dive — AdaptiveOps (`docs/interview/backend-deep-dive.md`)

## Stack
- Java 21 (Temurin), Spring Boot 3.3, Jakarta Persistence (Hibernate), Flyway, JUnit 5 + Testcontainers.
- Build: Maven wrapper (`./mvnw`).
- Container: multi-stage Dockerfile, non-root user, HEALTHCHECK.

## Domain Model
- `Order` (`domain/model/Order.java`): UUID id, order_number (unique), customer_id/email, status (FSM), total_amount, currency, `@Version` optimistic locking, items (OneToMany cascade).
- `OrderStatus` FSM: CREATED → PENDING → APPROVED → COMPLETED; CANCELLED branch. Illegal leap → `InvalidStateTransitionException` (422).

## Transactions & Outbox
- `OrderServiceImpl.createOrder` (@Transactional, READ_COMMITTED, REQUIRED): saves Order + `outboxService.saveEvent(event)` in the SAME transaction.
- `OutboxService.saveEvent` (`Propagation.MANDATORY`): serializes DomainEvent to JSON, inserts `outbox_messages` row (status PENDING).
- `V2__create_outbox_table.sql`: outbox_messages (id, aggregate_type, aggregate_id, event_type, payload JSONB, status, retry_count, last_error, created_at, processed_at).
- Dispatcher (planned): polls PENDING outbox rows, republishes on failure. Not yet connected to a live message broker.

## Idempotency
- `IdempotentExecutionFilter` (OncePerRequestFilter, HIGHEST_PRECEDENCE+10): intercepts POST/PUT/PATCH.
- Computes SHA-256(method + path + body). Stores `IdempotencyRecord` (key, hash, path, status PROCESSING/COMPLETED, response, locked_until 60s).
- Duplicate key + same hash + COMPLETED → return cached response. Duplicate key + different hash → 422. In-flight (locked) → 409.
- `V3__create_idempotency_table.sql`: idempotency_records (idempotency_key PK, request_hash, request_path, status, response_status_code, response_body, created_at, locked_until).

## Concurrency
- `@Version` on Order; manual guard in `updateOrderStatus` compares `If-Match` / `expectedVersion`; mismatch → `ObjectOptimisticLockingFailureException` → HTTP 409.
- Test: `OrderConcurrencyIntegrationTest.java` (10 simultaneous clients, 1 wins, 9 get 409).

## Observability
- Micrometer counters: `orders.created.total`, `orders.transition.total`.
- Actuator: `/actuator/health/liveness`, `/actuator/health/readiness`, `/actuator/prometheus`.
- Springdoc OpenAPI: `/v3/api-docs`, `/swagger-ui`.

## Verification
- `./mvnw -B -q test` → EXIT_CODE=0 (verified Milestone 0).
- Tests: `OrderServiceImplTest`, `OrderControllerMockMvcTest`, `OrderServiceApplicationTests`, `OrderEntityTest`, `OrderStatusTransitionTest`, `ActuatorEndpointsIntegrationTest`, `IdempotencyIntegrationTest`, `OrderConcurrencyIntegrationTest`, `TransactionalOutboxIntegrationTest`.

## Limitations (honesty)
- Outbox dispatcher/publisher not yet wired to a live broker (RabbitMQ adapter planned).
- Cross-store consistency with Cloudflare D1 control plane is eventual, not atomic.
- No production-scale load test executed.
