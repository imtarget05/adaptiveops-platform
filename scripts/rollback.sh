#!/usr/bin/env bash
# scripts/rollback.sh - Automated and controlled rollback orchestrator
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source common library
# shellcheck source=scripts/lib/common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

# Default parameters
TARGET="local"
TO_VERSION=""
REASON="Automated rollback triggered: Health check or deployment verification failure"
CONTROL_PLANE_URL="${CONTROL_PLANE_API_URL:-http://localhost:8787}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
AUDIT_ENDPOINT="${CONTROL_PLANE_URL}/api/v1/audit"
SKIP_HEALTH_CHECK=false
CLEANUP_FILES=()

# shellcheck disable=SC2329
cleanup() {
  if [[ ${#CLEANUP_FILES[@]} -gt 0 ]]; then
    for f in "${CLEANUP_FILES[@]}"; do
      if [[ -f "${f}" ]]; then
        rm -f "${f}"
      fi
    done
  fi
}

# shellcheck disable=SC2329
trap_err() {
  local exit_code="$?"
  local line_no="$1"
  local bash_cmd="$2"
  log_error "Rollback failed at line ${line_no} (command: '${bash_cmd}', exit: ${exit_code})"
  cleanup
  exit "${exit_code}"
}

trap 'trap_err ${LINENO} "${BASH_COMMAND}"' ERR
trap 'cleanup' EXIT INT TERM

usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --target <profile>          Target environment profile (local | kubernetes | cloudflare-preview | aws | azure) [default: local]
  --to-version <version>      Target semantic version to rollback to (auto-resolved from Control Plane if omitted)
  --reason <reason>           Human-readable or automated explanation for rollback
  --control-plane-url <url>   Base URL of the AdaptiveOps Control Plane [default: http://localhost:8787]
  --skip-health-check         Skip post-rollback health verification probe
  -h, --help                  Show this help message
EOF
  exit "${EXIT_INVALID_ARGUMENT}"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target=*)
      TARGET="${1#*=}"
      shift
      ;;
    --target)
      TARGET="$2"
      shift 2
      ;;
    --to-version=*)
      TO_VERSION="${1#*=}"
      shift
      ;;
    --to-version)
      TO_VERSION="$2"
      shift 2
      ;;
    --reason=*)
      REASON="${1#*=}"
      shift
      ;;
    --reason)
      REASON="$2"
      shift 2
      ;;
    --control-plane-url=*)
      CONTROL_PLANE_URL="${1#*=}"
      AUDIT_ENDPOINT="${CONTROL_PLANE_URL}/api/v1/audit"
      shift
      ;;
    --control-plane-url)
      CONTROL_PLANE_URL="$2"
      AUDIT_ENDPOINT="${CONTROL_PLANE_URL}/api/v1/audit"
      shift 2
      ;;
    --skip-health-check)
      SKIP_HEALTH_CHECK=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      log_error "Unknown option: $1"
      usage
      ;;
  esac
done

case "${TARGET}" in
  local|kubernetes|cloudflare-preview|aws|azure)
    ;;
  *)
    log_error "Unsupported target profile: ${TARGET}"
    exit "${EXIT_INVALID_ARGUMENT}"
    ;;
esac

if [[ -z "${ADMIN_API_KEY}" ]]; then
  log_error "ADMIN_API_KEY is required; refusing to use a built-in fallback credential."
  exit "${EXIT_INVALID_ARGUMENT}"
fi

log_info "=================================================================="
log_info "INITIATING CONTROLLED ROLLBACK"
log_info "Target: ${TARGET} | Requested Version: ${TO_VERSION:-auto-resolve} | Reason: ${REASON}"
log_info "=================================================================="

# Resolve rollback candidate version from Control Plane API if not provided
if [[ -z "${TO_VERSION}" ]]; then
  log_info "Querying Control Plane API for rollback candidate on environment '${TARGET}'..."
  candidate_url="${CONTROL_PLANE_URL}/api/v1/environments/${TARGET}/rollback-candidates"

  candidate_json=$(curl -s --max-time 3 "${candidate_url}" 2>/dev/null || true)
  if [[ -n "${candidate_json}" ]] && command -v grep &>/dev/null; then
    # Extract candidate version if response is valid JSON
    extracted_version=$(echo "${candidate_json}" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
    if [[ -n "${extracted_version}" ]]; then
      TO_VERSION="${extracted_version}"
      log_info "Resolved rollback candidate from Control Plane: '${TO_VERSION}'"
    fi
  fi

  if [[ -z "${TO_VERSION}" ]]; then
    log_error "Could not resolve rollback candidate from Control Plane for environment '${TARGET}'. Aborting rollback to avoid fake version fallback."
    exit "${EXIT_ROLLBACK_FAILED}"
  fi
fi

start_time=$(date +%s)

# Execute real controlled rollback via Control Plane API (records D1 deployment + audit ledger).
log_info "Executing controlled rollback via Control Plane API on environment '${TARGET}' to version '${TO_VERSION}'..."
rollback_api_response=$(curl -s --max-time 10 -w "\n%{http_code}" -X POST \
  "${CONTROL_PLANE_URL}/api/v1/environments/${TARGET}/rollback" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${ADMIN_API_KEY}" \
  -d "{\"environment\":\"${TARGET}\",\"target_version\":\"${TO_VERSION}\",\"reason\":\"${REASON}\",\"triggered_by\":\"rollback-script\"}" 2>/dev/null || true)

rollback_http_code=$(echo "${rollback_api_response}" | tail -1)
rollback_body=$(echo "${rollback_api_response}" | sed '$d')

if [[ "${rollback_http_code}" != "200" ]]; then
  log_error "Control Plane rollback API returned HTTP ${rollback_http_code} for environment '${TARGET}'."
  log_error "Response: ${rollback_body}"
  exit "${EXIT_ROLLBACK_FAILED}"
fi

rollback_id=$(echo "${rollback_body}" | grep -o '"rollback_id":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
log_info "Control Plane recorded rollback ${rollback_id:-unknown} for environment '${TARGET}' to version '${TO_VERSION}'."

# Execute target-specific rollback routine
case "${TARGET}" in
  local)
    log_info "Executing local rollback via Docker Compose to version '${TO_VERSION}'..."
    COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose/docker-compose.yml"
    if command -v docker &>/dev/null; then
      APP_VERSION="${TO_VERSION}" docker compose -f "${COMPOSE_FILE}" up -d --no-build 2>&1 || {
        log_error "Docker Compose rollback failed for target version ${TO_VERSION}."
        exit "${EXIT_ROLLBACK_FAILED}"
      }
    else
      log_error "Docker CLI not installed; cannot perform local rollback."
      exit "${EXIT_ROLLBACK_FAILED}"
    fi
    log_success "Local Docker Compose rollback to version ${TO_VERSION} completed."
    ;;

  kubernetes)
    log_info "Executing Kubernetes rollback via Helm to version '${TO_VERSION}'..."
    HELM_DIR="${REPO_ROOT}/deploy/helm/adaptiveops-order-service"
    if command -v helm &>/dev/null; then
      # Attempt native helm rollback first; if no revision history, deploy target version
      helm rollback order-service 2>/dev/null || \
      helm upgrade --install order-service "${HELM_DIR}" \
        --namespace adaptiveops \
        --set image.tag="${TO_VERSION}" \
        --atomic \
        --timeout 120s \
        --wait 2>&1 || {
          log_error "Kubernetes Helm rollback failed for target version ${TO_VERSION}."
          exit "${EXIT_ROLLBACK_FAILED}"
        }
    else
      log_error "Helm CLI not installed; cannot perform Kubernetes rollback."
      exit "${EXIT_ROLLBACK_FAILED}"
    fi
    log_success "Kubernetes Helm rollback to version ${TO_VERSION} completed."
    ;;

  cloudflare-preview)
    log_info "Executing Cloudflare preview Worker rollback to previous deployment..."
    if command -v wrangler &>/dev/null; then
      wrangler rollback --env preview --config "${REPO_ROOT}/control-plane/wrangler.preview.generated.toml" 2>&1 || {
        log_error "Cloudflare wrangler rollback failed for target version ${TO_VERSION}."
        exit "${EXIT_ROLLBACK_FAILED}"
      }
      log_success "Cloudflare preview Worker rolled back to the previous deployment (target version ${TO_VERSION})."
    else
      log_error "wrangler CLI not installed; cannot perform real Cloudflare rollback."
      exit "${EXIT_ROLLBACK_FAILED}"
    fi
    ;;

  aws|azure)
    log_info "Processing cloud rollback verification for target '${TARGET}' (Zero-Cost Guardrail)..."
    verify_cost_guard "${TARGET}"
    log_success "Cloud target rollback verified (plan-only revert)."
    ;;
esac

duration=$(( $(date +%s) - start_time ))

# Verify system health post-rollback unless explicitly skipped
if [[ "${SKIP_HEALTH_CHECK}" != "true" ]]; then
  log_info "Verifying post-rollback health on target '${TARGET}'..."
  if ! "${SCRIPT_DIR}/health_check.sh" --target "${TARGET}" --timeout 30; then
    log_error "Post-rollback health check failed on target '${TARGET}'!"
    exit "${EXIT_HEALTH_CHECK_FAILED}"
  fi
  log_success "Target '${TARGET}' verified healthy after rollback."
fi

# Record signed audit log on Control Plane
log_info "Recording immutable rollback audit log on Control Plane..."
audit_payload=$(cat << EOF
{
  "actor": "rollback-watchdog",
  "action": "ROLLBACK_COMPLETED",
  "environment": "${TARGET}",
  "target_type": "${TARGET}",
  "target_id": "${TARGET}-target",
  "details": {
    "target_version": "${TO_VERSION}",
    "reason": "${REASON}",
    "duration_seconds": ${duration},
    "status": "RECOVERED",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  }
}
EOF
)

curl -s --max-time 3 -X POST \
  -H "Content-Type: application/json" \
  -d "${audit_payload}" \
  "${AUDIT_ENDPOINT}" >/dev/null 2>&1 || {
    log_warn "Could not record audit log to ${AUDIT_ENDPOINT}; continuing."
  }

log_success "=================================================================="
log_success "AUTOMATED ROLLBACK TO ${TO_VERSION} SUCCEEDED (Duration: ${duration}s)"
log_success "=================================================================="

exit "${EXIT_SUCCESS}"
