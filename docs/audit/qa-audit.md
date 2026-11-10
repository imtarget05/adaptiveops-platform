# AdaptiveOps QA and Architecture Audit

**Audit date:** 2026-11-09  
**Scope:** repository source, specifications, migrations, tests, scripts, CI workflows and preview configuration. No hosted deployment, hosted CI, SonarQube scan, Cloudflare account access, or production environment was exercised.

## Executive assessment

The repository contains substantive control-plane, order-service, dashboard, and infrastructure code. Local regression evidence is available for core webhook delivery/security and a PostgreSQL-backed order concurrency integration test. This does **not** establish production deployment or production readiness: hosted quality gates are unrun; Cloudflare preview resources/secrets and repository branch protections are unavailable; the rollback API records an in-progress request but does not call a platform actuator; and the production delivery scheduler/operational behavior remain unverified.

## Acceptance matrix

| Requirement | Evidence / result | Status |
|---|---|---|
| SC-01 event accepted, delivered, audited | `control-plane/tests/event-delivery.test.ts`; full Vitest suite | Pass locally |
| SC-02 idempotency / duplicate handling | event delivery and dedup tests; adversarial concurrent duplicate test | Pass locally |
| SC-03 retry then recovery | controlled receiver test in event-delivery suite | Pass locally |
| SC-04 retry exhaustion to DLQ | poison event scenario in event-delivery suite | Pass locally |
| SC-05 recoverable outbox window | crash-before-ack scenario in event-delivery suite | Pass locally |
| SC-06 rollback to known-good | `rollbackService.ts`, `rollback.test.ts`, `release-safety.test.ts` | Request state is recorded safely as `in_progress`; no platform actuator, so rollback execution is not end-to-end verified |
| SC-07 concurrent release lock | `release-safety.test.ts` | Pass locally |
| SC-08 schema-incompatible rollback guard | `release-safety.test.ts` | Pass locally |
| SC-09 unauthorized operations | API and release-safety suites | Pass locally |
| SC-10 SSRF and HMAC attacks | `delivery-security.test.ts`, `hmac.test.ts`, adversarial tests | Pass locally |
| CI / quality / security gates | `.github/workflows/ci.yml`, `security.yml`, `release.yml`; shell and Terraform checks locally | Definitions and local checks exist; no hosted run or branch protection evidence |
| Cloudflare preview | preview configuration dry-run with placeholder binding | Config dry-run only; preview not deployed. The renderer validates the preview D1 UUID and refuses to generate the file if it matches the configured production D1 identifier |
| Production deployment | no deployment performed | Not deployed |

## Architecture, flow, and trade-offs

The Worker API (Hono/TypeScript) stores event, delivery, release and audit state in D1. Event dispatch sends HTTP requests to registered receivers, classifies outcomes for retry/dead-letter handling, and records delivery state. HMAC signing and idempotency protect the receiver boundary. URL validation rejects local/private targets and credentials in target URLs, limits plain HTTP to local development, disables redirects, and avoids persisting response bodies. Admin authorization protects event reads and control operations.

A separate Spring Boot order service uses PostgreSQL and transactional outbox patterns. PostgreSQL integration tests use Testcontainers. The React dashboard reads the control plane. Terraform/Helm/Compose files are infrastructure examples; they do not prove infrastructure was provisioned.

The principal trade-off is split persistence: D1 control-plane state and PostgreSQL business state cannot share one transaction. Delivery is retry-oriented and therefore at-least-once; downstream consumers must deduplicate. Release records provide a control-plane view but do not themselves actuate Cloudflare/Kubernetes/AWS/Azure. Rollback has this same boundary: it creates an `in_progress` deployment and audit event, but does not execute a target-specific deployment or verify business health.

## Findings by severity

### High

1. **Hosted gates are not evidenced.** SonarQube Server is configured to require `SONAR_HOST_URL` and `SONAR_TOKEN`, but neither a Sonar server scan nor remote GitHub Actions run was performed. Branch protection is unknown. Evidence: `.github/workflows/ci.yml`; required CI variables are absent in this workspace.
2. **Rollback is an intent record, not a platform rollback.** `control-plane/src/services/rollbackService.ts` stores the target and marks the deployment `in_progress`; no platform actuator is called. The API response is `initiated`. This is not end-to-end rollback capability.
3. **Dependency security gate remains blocked by known npm advisories.** After `npm ci`, `npm audit --json` reported 15 findings in the control-plane dependency tree (3 critical, 9 high, 3 moderate). Available broad fixes require major upgrades of the Cloudflare Workers test pool/Wrangler toolchain; a Vitest 2.1.9 update alone did not remove the findings. No findings were suppressed. Evidence: `/tmp/adaptiveops-npm-audit3.json` (local raw output; not a repository artifact).
4. **Preview is not hosted.** Cloudflare preview config can be rendered and dry-run validated, but account-specific preview D1, credentials, secrets and URL are unavailable; no preview smoke check was made.

### Medium

1. **Operational state remains unproven.** No sustained service run, alerting/SLO, live webhook receiver, replay drill against hosted resources, or reconciliation exercise is attached.
2. **Infrastructure examples remain unverified against cloud accounts.** Terraform format/init/validate are local checks, not plans/applies or cloud evidence.
3. **Coverage/quality-gate evidence is incomplete.** Local tests pass, but hosted SonarQube coverage import and quality-gate result cannot be asserted.

## Security and failure behavior

Local tests cover forged/invalid HMAC, replay/idempotency, duplicate concurrency, SSRF target classes, retry/recovery, DLQ, and outbox crash-before-ack. The implementation rejects missing webhook secrets instead of using a built-in fallback, protects event read routes with admin auth, and uses manual redirect handling to prevent an allowed public URL from redirecting toward a private target. CI configuration fails closed when SonarQube settings are absent and configures Trivy scans as blocking gates.

Remaining security/operations work includes hosted scan review, live tenant/operator configuration review, monitoring and alert validation, and proving service-level rollback/recovery on isolated preview infrastructure. No secret values are included in this report. The current npm audit findings are a blocking security remediation item; run supported coordinated major upgrades and revalidate tests/dry-runs before treating dependency security as passing.

## Verification record

Commands run from repository/component directories on 2026-11-09:

| Command | Result |
|---|---|
| `cd control-plane && npm test -- --run` | PASS — 9 test files, 65 tests |
| `cd control-plane && npm run typecheck` | PASS — `tsc --noEmit` |
| `cd dashboard && npm run build` | PASS — TypeScript compile + Vite production build |
| `cd order-service && DOCKER_HOST=unix:///Users/mainguyenbinhtan/.colima/default/docker.sock TESTCONTAINERS_RYUK_DISABLED=true ./mvnw -B -ntp -Dtest=OrderConcurrencyIntegrationTest test` | PASS — 1 integration test; PostgreSQL container started through Colima |
| `shellcheck scripts/*.sh scripts/lib/*.sh` | PASS |
| `bash -n scripts/*.sh scripts/lib/*.sh` | PASS |
| `terraform fmt -check -recursive` | PASS |
| `terraform -chdir=deploy/terraform/aws init -backend=false -input=false && ... validate` | PASS |
| `terraform -chdir=deploy/terraform/azure init -backend=false -input=false && ... validate` | PASS |
| Wrangler preview dry-run with placeholder D1 UUID | PASS — configuration parse/bundle only; no hosted deployment |
| `cd control-plane && npm audit --json` | FAIL — 15 findings: 3 critical, 9 high, 3 moderate; proposed broad fix requires major toolchain upgrades |
| SonarQube scan / GitHub Actions hosted run / Trivy hosted report | NOT RUN — no configured hosted URL/token or remote CI evidence |
| Cloudflare preview deployment and smoke | NOT RUN — isolated account resources and new preview credentials not configured |

An initial Testcontainers attempt failed to discover the Colima daemon and then encountered a Docker API compatibility issue; setting `DOCKER_HOST` to the Colima socket and `TESTCONTAINERS_RYUK_DISABLED=true` allowed the focused PostgreSQL integration test to pass. The test required a project-scoped `order-service/src/test/resources/docker-java.properties` API setting. The focused PostgreSQL integration passed, but the complete Java suite remains blocked by the flash-sale end-to-end scenario, which left orders in `PENDING` before the relay serialization fix. A rerun after the fix is still in progress and must pass before completion.

## Production readiness

**Production-ready:** not established. Local regression checks pass for the tested paths, but hosted quality/security gates, operational evidence and end-to-end rollback are missing.  
**Production-deployed:** no; no production deployment was attempted or evidenced.

## Next work

1. Configure a SonarQube Server project and `SONAR_HOST_URL`/`SONAR_TOKEN` as repository variable/secret, then run CI and review gate findings.
2. Revoke and replace credentials exposed in the conversation before using any hosted service; use only new secret-manager/CI variables.
3. Provision isolated preview D1 and new Cloudflare preview secrets, render configuration, deploy only to preview, and run health plus business smoke checks.
4. Implement and test a target-specific rollback actuator, terminal status callback, lock ownership/fencing and post-rollback business verification before describing rollback as automated.
5. Coordinate supported major upgrades for the vulnerable npm test/deploy toolchain; rerun `npm audit`, the complete test suite and preview dry-run before closing the dependency finding.
7. Run the full Java verify suite with PostgreSQL Testcontainers and retain its reports; run security scanners and review actual findings.
8. Establish branch protection and required checks before relying on CI gates.

### C1–C8 constraint coverage

- **C1 Database:** PostgreSQL Testcontainers is implemented and exercised. Oracle XE production compatibility is **not met**; Oracle driver, service-specific Oracle profiles/migrations, and Oracle execution-plan/index verification are absent.
- **C2 Kafka:** integration tests use a real Kafka Testcontainer. The flash-sale path initially exposed an outbox serializer/consumer contract issue; typed event publishing was corrected and the targeted scenario is being rerun. Full outage, redelivery, DLQ, and reconciliation evidence is incomplete.
- **C3 Durable invariants:** durable idempotency and database conditional stock reservation are present; test evidence is reported above. Full cross-service invariant matrix remains incomplete.
- **C4 Unit and integration tests:** identity and selected PostgreSQL/Kafka service tests pass. The full reactor verification and 1,000-request flash-sale run must be green before this constraint can be marked complete.
- **C5 Secrets:** committed RSA private-key fixtures were removed; Kubernetes staging templates reference Secret objects. Compose now expects key and database variables. Existing local profile defaults and legacy combined deployment templates require careful environment separation; no secret is claimed verified by scanner.
- **C6 Performance:** no throughput, p95, or error-rate benchmark claim is made. The 1,000-request flash-sale test is a correctness scenario, not a benchmark.
- **C7 Password hashing:** Argon2id is configured in identity service; identity tests pass.
- **C8 JWT:** RS256 public/private key flow is configured with external key variables; ephemeral-key service tests pass. Key rotation operations have not been demonstrated.

The scan/deploy pipeline definitions parse locally but hosted Sonar, dependency, Gitleaks, Trivy, registry, cluster rollout, and smoke jobs have not run. This makes CI readiness configured-but-unverified and leaves Oracle as a hard architecture gap.
