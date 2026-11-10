#!/usr/bin/env bash
# scripts/health_check.sh - Health and readiness probe verification runner
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common library
# shellcheck source=scripts/lib/common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

# Default configuration
TARGET="local"
ENDPOINT=""
TIMEOUT_SECONDS=60
INTERVAL_SECONDS=5
MAX_RETRIES=5
PROBE_TIERS=true

# shellcheck disable=SC2329
cleanup() {
  :
}

# shellcheck disable=SC2329
trap_err() {
  local exit_code="$?"
  local line_no="$1"
  local bash_cmd="$2"
  log_error "Health check probe failed unexpectedly at line ${line_no} (command: '${bash_cmd}', exit: ${exit_code})"
  cleanup
  exit "${EXIT_HEALTH_CHECK_FAILED}"
}

trap 'trap_err ${LINENO} "${BASH_COMMAND}"' ERR
trap 'cleanup' EXIT INT TERM

usage() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --target <profile>        Target environment profile (local | kubernetes | cloudflare | aws | azure) [default: local]
  --endpoint <url>          Explicit probe endpoint URL (overrides target defaults)
  --timeout <seconds>       Overall probe timeout in seconds [default: 60]
  --interval <seconds>      Interval between probe attempts [default: 5]
  --max-retries <count>     Maximum retry attempts before failing [default: 5]
  --no-probe-tiers          Only check the main endpoint; skip readiness/liveness drill-down
  -h, --help                Show this help message
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
    --endpoint=*)
      ENDPOINT="${1#*=}"
      shift
      ;;
    --endpoint)
      ENDPOINT="$2"
      shift 2
      ;;
    --timeout=*)
      TIMEOUT_SECONDS="${1#*=}"
      shift
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --interval=*)
      INTERVAL_SECONDS="${1#*=}"
      shift
      ;;
    --interval)
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --max-retries=*)
      MAX_RETRIES="${1#*=}"
      shift
      ;;
    --max-retries)
      MAX_RETRIES="$2"
      shift 2
      ;;
    --no-probe-tiers)
      PROBE_TIERS=false
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

# Resolve default endpoint by target profile if not explicitly set
if [[ -z "${ENDPOINT}" ]]; then
  case "${TARGET}" in
    local)
      ENDPOINT="http://localhost:8080/actuator/health"
      ;;
    kubernetes)
      ENDPOINT="http://localhost:30080/actuator/health"
      ;;
    cloudflare)
      ENDPOINT="http://localhost:8787/api/health"
      ;;
    aws|azure)
      ENDPOINT="http://localhost:8080/actuator/health"
      ;;
    *)
      log_error "Unsupported target profile: ${TARGET}"
      exit "${EXIT_INVALID_ARGUMENT}"
      ;;
  esac
fi

log_info "Executing health probes for target: '${TARGET}'"
log_info "Primary Endpoint: ${ENDPOINT} | Timeout: ${TIMEOUT_SECONDS}s | Retries: ${MAX_RETRIES}"

# Helper function to test a single URL with curl
probe_url() {
  local url="$1"
  local http_code

  if ! command -v curl &>/dev/null; then
    log_warn "curl not installed; skipping live HTTP probe."
    return 0
  fi

  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "${url}" 2>/dev/null || echo "000")
  if [[ "${http_code}" -ge 200 && "${http_code}" -lt 300 ]]; then
    return 0
  else
    return 1
  fi
}

start_time=$(date +%s)
attempt=1
success=false

while (( attempt <= MAX_RETRIES )); do
  current_time=$(date +%s)
  elapsed=$(( current_time - start_time ))
  if (( elapsed >= TIMEOUT_SECONDS )); then
    log_error "Health check exceeded timeout budget of ${TIMEOUT_SECONDS}s."
    break
  fi

  log_info "Probe attempt ${attempt}/${MAX_RETRIES} against ${ENDPOINT} (elapsed: ${elapsed}s)..."

  if probe_url "${ENDPOINT}"; then
    log_success "Primary health probe responded successfully."

    # Perform readiness and liveness drill-down if endpoint is Spring Actuator
    if [[ "${PROBE_TIERS}" == "true" && "${ENDPOINT}" =~ /actuator/health ]]; then
      base_actuator="${ENDPOINT%/health}"
      readiness_url="${base_actuator}/health/readiness"
      liveness_url="${base_actuator}/health/liveness"

      log_info "Checking 3-tier probe: readiness at ${readiness_url}..."
      if ! probe_url "${readiness_url}"; then
        log_warn "Readiness probe failed at ${readiness_url}."
      fi

      log_info "Checking 3-tier probe: liveness at ${liveness_url}..."
      if ! probe_url "${liveness_url}"; then
        log_warn "Liveness probe failed at ${liveness_url}."
      fi
    fi

    success=true
    break
  else
    log_warn "Probe failed (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${INTERVAL_SECONDS}s..."
    sleep "${INTERVAL_SECONDS}"
    attempt=$(( attempt + 1 ))
  fi
done

if [[ "${success}" == "true" ]]; then
  log_success "Health check succeeded for target '${TARGET}'. Service is healthy and operational."
  exit "${EXIT_SUCCESS}"
else
  log_error "Health check failed after ${MAX_RETRIES} attempts or timeout. Target '${TARGET}' is UNHEALTHY."
  exit "${EXIT_HEALTH_CHECK_FAILED}"
fi
