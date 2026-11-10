# DevOps Deep-Dive — AdaptiveOps (`docs/interview/devops-deep-dive.md`)

## CI/CD (GitHub Actions primary)
- `.github/workflows/ci.yml`: push/PR to main. Matrix: java-backend (`./mvnw test`), control-plane-ts (npm ci + tsc + vitest), dashboard-ts (npm ci + tsc + build), bash-automation (shellcheck), terraform-plan (AWS + Azure fmt+validate).
- `.github/workflows/security.yml`: dependency-check (CVSS≥7 fail), Trivy image scan (CRITICAL/HIGH), trufflehog secret scan, harden-runner audit.
- `.github/workflows/release.yml`: tag `v*` → Docker build (multi-stage, non-root), push to GHCR, GitHub Release.
- `.github/workflows/rollback.yml`: workflow_dispatch → resolve candidate from Control Plane → `scripts/rollback.sh` → audit record.
- `.github/workflows/deploy-cloudflare.yml`: wrangler deploy Workers (dry-run in workflow), Pages deploy dashboard.
- `.github/workflows/deploy-aws.yml` / `deploy-azure.yml`: OIDC auth, Terraform fmt+validate+plan ONLY (plan-only, `-var enable_chargeable_resources=false`), guard exits 7 if `ADAPTIVEOPS_ALLOW_CLOUD_CHARGES=true` is not set.

## Bash Automation
- `scripts/lib/common.sh`: exit codes (0/1/2/3/4/5/6/7), color logging, `retry_command` (exponential backoff + jitter), `verify_cost_guard`.
- `scripts/deploy.sh`: unified entry (local/kubernetes/cloudflare/aws/azure), audit event dispatch, cost guard, terraform plan-only for cloud.
- `scripts/rollback.sh`: controlled rollback (target, version, reason), control-plane candidate resolution, post-rollback health check, audit record.
- `scripts/health_check.sh`: retry probes, 3-tier (main/readiness/liveness), timeout budget.
- `scripts/failure_injection.sh`: SC-01..SC-10 scenarios against live services; SKIP (not fake) when services down.
- `scripts/measure.sh`: raw JSONL measurement (ts, scenario, mode, metric, value, unit); no fabricated metrics.

## Shell Quality
- `set -euo pipefail`, `IFS=$'\n\t'`, `trap 'trap_err' ERR`, `trap 'cleanup' EXIT INT TERM`.
- ShellCheck on all scripts (verified EXIT_CODE=0 in CI matrix).

## Kubernetes
- `deploy/helm/adaptiveops-order-service/`: Chart.yaml, values.yaml, templates/. Rolling update via Helm `--atomic --wait`.
- kind target configured in `config/targets.yaml`; `kind` binary not installed locally (plan-only for local kind apply).

## Cloud (plan-only, zero cost)
- AWS ECS Fargate: `deploy/terraform/aws/` (main.tf, oidc.tf, variables.tf, outputs.tf, versions.tf; fmt+validate pass).
- Azure Container Apps: `deploy/terraform/azure/` (same files; fmt+validate pass).
- OIDC auth (no long-lived access keys).
- `verify_cost_guard` blocks apply unless explicitly opted in.

## Jenkins / Azure DevOps (alternatives)
- `deploy/Jenkinsfile`, `deploy/azure-pipelines.yml`: portable CI alternatives (documented, not verified against live instances).

## Limitations (honesty)
- AWS/Azure production deployment NOT executed (plan-only).
- kind local apply not executed (kind binary missing).
- Failure injection SC-03/SC-04/SC-05 require controllable downstream; reported as SKIP until manual run.
- Measurement harness outputs SKIP until services are running.
