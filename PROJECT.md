# Project: AdaptiveOps Platform (`adaptiveops-platform`)

## Architecture
AdaptiveOps is a production-grade multi-cloud Release Reliability Platform and portfolio showcase. It collects GitHub deployment events, tracks release status across heterogeneous target environments, enforces deployment quality gates, monitors health probes, maintains an immutable audit ledger, and supports automated, controlled rollbacks.

```
                  +----------------------------------------------+
                  |              GitHub Actions CI/CD            |
                  |   (PR Gates, Tests, SAST, OIDC Workflows)    |
                  +----------------------+-----------------------+
                                         | Webhook (HMAC-SHA256)
                                         v
+-----------------------+     +----------------------------------+
|   React Dashboard     |<--->| Cloudflare Workers Control Plane |
| (Vite + Tailwind CSS) |     | (Hono REST API + D1 SQL Storage) |
+-----------------------+     +-----------------+----------------+
                                                |
                   +----------------------------+----------------------------+
                   |                            |                            |
                   v                            v                            v
      +------------------------+   +------------------------+   +------------------------+
      |      Local Target      |   |   Kubernetes Target    |   |  Cloud Targets (Dry)   |
      | (Docker Compose stack) |   | (kind + Helm Rollout)  |   | (AWS ECS / Azure ACA)  |
      |   Order Service (App)  |   |  Order Service (App)   |   | Zero-Cost Guardrails   |
      |   PostgreSQL + Rabbit  |   |  PostgreSQL + Rabbit   |   | Terraform Validation   |
      +------------------------+   +------------------------+   +------------------------+
```

### Module Boundaries
1. **Control Plane (`control-plane/`)**: Cloudflare Workers + Hono API + D1 SQLite database. Ingests GitHub webhooks, validates HMAC signatures, rejects duplicate deliveries, tracks releases, records health probes, executes rollback logic, and stores immutable audit logs.
2. **Dashboard (`dashboard/`)**: React + TypeScript + Vite + Tailwind CSS SPA. Displays live target status, release catalogs, health pulse metrics, deployment timeline, audit ledger, and manual rollback controls.
3. **Backend Workload (`order-service/`)**: Spring Boot 3 (Java 21) REST service. Manages order lifecycle, PostgreSQL persistence with Flyway migrations, optimistic locking (`@Version`), idempotency key verification, transactional outbox pattern with RabbitMQ, non-root Dockerfile, Actuator probes, and OpenAPI documentation.
4. **Target Configurations & Scripts (`config/`, `scripts/`)**: Unified `targets.yaml`, ShellCheck-clean Bash deployment/rollback/health-check scripts with explicit error trapping (`trap ERR/EXIT`) and standard exit codes.
5. **Infrastructure (`deploy/`)**: Helm chart for kind rolling deployments, zero-cost Terraform modules for AWS ECS and Azure Container Apps, Docker Compose stacks, Jenkinsfile, and Azure DevOps pipelines.
6. **Failure Injection & Reliability (`scripts/failure_injection.sh`)**: Automated end-to-end resilience scenario verifying v1 healthy -> v2 injected failure -> smoke test detection -> rollback -> recovery -> audit logging.
7. **Security, CI/CD & Observability (`.github/workflows/`, `deploy/observability/`, `docs/`)**: Multi-job GitHub Actions quality gates, Prometheus scrape configs, Grafana dashboards, ECS JSON logging, STRIDE threat model, runbooks, and portfolio README.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Control Plane Edge API | Cloudflare Workers runtime with Hono router, sub-millisecond overhead, REST endpoints | M1 | R1 |
| 2 | D1 Relational Schema | 7-table schema with FKs, checks, indexes, and sequential migrations (0001, 0002) | M1 | R1 |
| 3 | Webhook HMAC-SHA256 Verification | Constant-time Web Crypto verification of `X-Hub-Signature-256` signatures | M1 | R1 |
| 4 | Webhook Deduplication | Atomic replay rejection keyed on `X-GitHub-Delivery` returning HTTP 202 | M1 | R1 |
| 5 | Release & Deployment Tracking | Full lifecycle management across environments and targets | M1 | R1 |
| 6 | Health Metric Ingestion | Sliding-window evaluation of target probe results with health status transitions | M1 | R1 |
| 7 | Controlled Rollback API | Candidate discovery query and atomic D1 batch rollback execution | M1 | R1 |
| 8 | React + TypeScript Dashboard | High-density DevOps UI with live status, pulse cards, release catalog, rollback modal | M1 | R1 |
| 9 | Control Plane Local Test Suite | Vitest + `@cloudflare/vitest-pool-workers` executing Miniflare isolate tests | M1 | R1 |
| 10 | Order Service Build Setup | Spring Boot 3.3, Java 21, Maven Wrapper (`mvnw`), clean DDD module structure | M2 | R2 |
| 11 | Order Lifecycle FSM | Order entity with FSM transitions (CREATED -> PENDING -> APPROVED -> COMPLETED / CANCELLED) | M2 | R2 |
| 12 | PostgreSQL & Flyway Migrations | Additive Expand/Contract Flyway migrations (V1 Orders, V2 Outbox, V3 Idempotency) | M2 | R2 |
| 13 | Concurrency & Transactions | `@Version` optimistic locking, `@Transactional` boundaries, HTTP 409 Conflict handling | M2 | R2 |
| 14 | Idempotent Request Handling | `Idempotency-Key` header, payload SHA-256 hashing, caching, replay protection | M2 | R2 |
| 15 | Transactional Outbox Pattern | Atomic order + outbox write, `FOR UPDATE SKIP LOCKED` poller, RabbitMQ publisher-confirms | M2 | R2 |
| 16 | Non-Root Multi-Stage Dockerfile | Hardened container image (`appuser` UID 10001), container JVM tuning flags | M2 | R2 |
| 17 | Operational Probes & OpenAPI | Actuator `/actuator/health/{liveness,readiness}`, Prometheus metrics, Springdoc OpenAPI 3.0 | M2 | R2 |
| 18 | Backend Automated Test Suite | JUnit 5, Mockito, Testcontainers / MockMvc unit & integration test suites | M2 | R2 |
| 19 | Unified Target Configuration | `config/targets.yaml` declaring local, k8s, cloudflare, and zero-cost aws/azure profiles | M3 | R3 |
| 20 | ShellCheck-Clean Bash Automation | Modular scripts (`common.sh`, `deploy.sh`, `rollback.sh`, `health_check.sh`) with traps & retries | M3 | R3 |
| 21 | Kubernetes Helm Chart | Kind rolling update deployment with 3-tier probes, resource limits, atomic rollback | M3 | R3 |
| 22 | Zero-Cost Cloud Terraform | AWS ECS & Azure ACA modules passing `terraform fmt` & `validate` with zero-charge guards | M3 | R3 |
| 23 | Alternative CI Pipelines | Portable `Jenkinsfile` and `azure-pipelines.yml` with verification documentation | M3 | R3 |
| 24 | E2E Failure Injection Scenario | Automated 6-phase test: v1 healthy -> v2 fault -> smoke detection -> rollback -> recovery -> audit | M4 | R4 |
| 25 | DB Expand/Contract Compatibility | Verified non-breaking schema compatibility during rollback from v2 to v1 | M4 | R4 |
| 26 | Immutable Audit Log Reflection | Rollback event recorded in D1 and verified on the live dashboard | M4 | R4 |
| 27 | GitHub Actions Quality Gates | Multi-job workflows (`pr-quality-gate.yml`, `merge-main.yml`, `release.yml`) blocking on failure | M5 | R5 |
| 28 | Local Observability Stack | Prometheus scrape configuration & 4-tier Grafana dashboard JSON models | M5 | R5 |
| 29 | Structured JSON Logging | Logback ECS format with trace/correlation ID propagation (`X-Trace-Id`) & secret redaction | M5 | R5 |
| 30 | Engineering Documentation | Architecture guide, STRIDE Threat Model, Incident Runbooks, and portfolio README | M5 | R5 |
| 31 | E2E Test Suite Pass | 100% pass of requirement-derived E2E test suite (Tiers 1-4) | M6 | Acceptance |
| 32 | Adversarial Hardening | White-box coverage audit & adversarial stress test verification (Tier 5) | M6 | Acceptance |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Control Plane API & Dashboard | Cloudflare Workers API, D1 migrations, HMAC validation, deduplication, React dashboard, Miniflare tests | none | DONE |
| M2 | Backend Workload (`order-service`) | Java Spring Boot service, PostgreSQL, optimistic locking, idempotency, transactional outbox, Docker, Actuator, OpenAPI | none | DONE |
| M3 | Multi-Cloud Target Profiles & Infra | `targets.yaml`, ShellCheck Bash scripts, Helm chart for kind, zero-cost Terraform for AWS/Azure, alternative CI | M1, M2 | DONE |
| M4 | Failure Injection & Automated Rollback | Automated 6-phase resilience script, expand-contract validation, recovery verification, audit logging | M1, M2, M3 | PLANNED |
| M5 | Security, CI/CD & Observability | GitHub Actions quality gates, Prometheus & Grafana configs, ECS JSON logs, STRIDE threat model, runbooks, README | M1, M2, M3, M4 | PLANNED |
| M6 | Final Milestone: E2E Tests & Hardening | Pass 100% of requirement-driven E2E tests (Tiers 1-4) + Tier 5 adversarial coverage hardening | M1, M2, M3, M4, M5, TEST_READY.md | PLANNED |

---

## Interface Contracts

### 1. GitHub Webhook -> Control Plane API
- **Endpoint**: `POST /api/v1/webhooks/github`
- **Headers**:
  - `Content-Type: application/json`
  - `X-GitHub-Event: deployment_status | deployment`
  - `X-GitHub-Delivery: <uuid>`
  - `X-Hub-Signature-256: sha256=<hmac_hex>`
- **Expected Responses**:
  - `200 OK`: Valid signature, webhook processed and recorded.
  - `202 Accepted`: Duplicate delivery ID already processed (`{"status": "already_processed"}`).
  - `401 Unauthorized`: Invalid HMAC signature.
  - `400 Bad Request`: Missing headers or malformed payload.

### 2. Deployment Script -> Control Plane API
- **Health Submission**: `POST /api/v1/health`
  - Body: `{"environment": "kubernetes", "target_id": "k8s-local", "version": "v1.0.0", "status": "healthy|unhealthy", "latency_ms": 45, "probes": {"liveness": true, "readiness": true}}`
  - Response: `200 OK {"acknowledged": true, "environment_status": "healthy"}`
- **Rollback Invocation**: `POST /api/v1/environments/{env}/rollback`
  - Body: `{"reason": "Smoke test failure on v2.0.0", "triggered_by": "automated-health-monitor"}`
  - Response: `200 OK {"rollback_id": "...", "target_version": "v1.0.0", "status": "initiated"}`
- **Audit Event Ingestion**: `POST /api/v1/audit`
  - Body: `{"actor": "system", "action": "deployment.rollback", "environment": "kubernetes", "details": {...}}`
  - Response: `201 Created {"audit_id": "...", "recorded_at": "..."}`

### 3. Client -> Order Service API
- **Create Order**: `POST /api/v1/orders`
  - Header: `Idempotency-Key: <uuid>`
  - Body: `{"customerId": "cust-01", "items": [{"sku": "SKU-01", "quantity": 2, "unitPrice": 49.99}], "totalAmount": 99.98}`
  - Response: `201 Created {"id": "...", "status": "CREATED", "version": 0, ...}`
- **Update Order Status**: `PUT /api/v1/orders/{id}/status`
  - Header: `If-Match: "<version>"` or body `{"version": 0, "status": "PENDING"}`
  - Response: `200 OK` on success, `409 Conflict` on optimistic locking collision.
- **Operational Probes**:
  - `GET /actuator/health/liveness` -> `{"status": "UP"}`
  - `GET /actuator/health/readiness` -> `{"status": "UP"}`
  - `GET /actuator/prometheus` -> Prometheus text format metrics

---

## Code Layout
```
/Users/mainguyenbinhtan/Downloads/ADAPTIVEOPS-PLATFROM/
├── .github/
│   └── workflows/
│       ├── pr-quality-gate.yml
│       ├── merge-main.yml
│       └── release.yml
├── config/
│   └── targets.yaml
├── control-plane/
│   ├── package.json
│   ├── wrangler.toml
│   ├── vitest.config.ts
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   └── 0002_seed_data.sql
│   └── src/
│       ├── index.ts
│       ├── db/
│       ├── routes/
│       ├── services/
│       └── utils/
├── dashboard/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── hooks/
│       └── types/
├── order-service/
│   ├── pom.xml
│   ├── mvnw
│   ├── .mvn/
│   ├── Dockerfile
│   └── src/
│       ├── main/
│       │   ├── java/com/adaptiveops/orderservice/
│       │   └── resources/
│       │       ├── application.yml
│       │       └── db/migration/
│       └── test/
├── deploy/
│   ├── docker-compose/
│   │   └── docker-compose.yml
│   ├── helm/
│   │   └── adaptiveops-order-service/
│   ├── terraform/
│   │   ├── aws/
│   │   └── azure/
│   ├── observability/
│   │   ├── prometheus/
│   │   └── grafana/
│   ├── Jenkinsfile
│   └── azure-pipelines.yml
├── scripts/
│   ├── lib/
│   │   └── common.sh
│   ├── deploy.sh
│   ├── rollback.sh
│   ├── health_check.sh
│   └── failure_injection.sh
├── tests/
│   └── e2e/
└── docs/
    ├── architecture/
    ├── security/
    └── runbooks/
```
