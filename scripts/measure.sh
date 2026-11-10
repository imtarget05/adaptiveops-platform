#!/usr/bin/env bash
# scripts/measure.sh - Measurement harness: baseline WITHOUT gates vs WITH AdaptiveOps gates.
# Records raw logs, timestamps, and actual results. Never fabricates metrics.
# Requires Control Plane and Order Service running; otherwise reports SKIP.
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=scripts/lib/common.sh
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/common.sh"

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:8787}"
ORDER_SERVICE_URL="${ORDER_SERVICE_URL:-http://localhost:8080}"
CONTROL_PLANE_HEALTH_URL="${CONTROL_PLANE_HEALTH_URL:-http://localhost:8787/healthz}"
ORDER_SERVICE_HEALTH_URL="${ORDER_SERVICE_HEALTH_URL:-http://localhost:8080/actuator/health/liveness}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
if [[ -z "${ADMIN_API_KEY}" ]]; then
  log_error "ADMIN_API_KEY is required; set a test-only key for a local Control Plane."
  exit "${EXIT_INVALID_ARGUMENT}"
fi
RESULTS_DIR="${REPO_ROOT}/tests/measurement_results"
mkdir -p "${RESULTS_DIR}"
OUT="${RESULTS_DIR}/measurement_$(date -u +%Y%m%dT%H%M%SZ).jsonl"

now_ms() { python3 -c "import time; print(int(time.time() * 1000))"; }

log_measurement() {
  local scenario="$1" mode="$2" metric="$3" value="$4" unit="$5"
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ts":"%s","scenario":"%s","mode":"%s","metric":"%s","value":%s,"unit":"%s"}\n' \
    "${ts}" "${scenario}" "${mode}" "${metric}" "${value}" "${unit}" | tee -a "${OUT}"
}

service_up() {
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$1" 2>/dev/null || echo "000")
  [[ "${code}" =~ ^[23] ]]
}

measure_deployment_detection() {
  local mode="$1"
  echo "=== Measure: deployment fault detection (mode=${mode}) ===" | tee -a "${OUT}"
  if ! service_up "${CONTROL_PLANE_HEALTH_URL}"; then
    log_warn "SKIP: Control Plane not reachable"
    return 0
  fi
  local start end
  start=$(now_ms)
  # Trigger a rollback candidate query; measure response time as detection proxy
  local resp
  resp=$(curl -s -w "\n%{http_code}" --max-time 10 "${CONTROL_PLANE_URL}/api/v1/rollback/candidates/local")
  end=$(now_ms)
  local code; code=$(echo "${resp}" | tail -1)
  local latency=$(( end - start ))
  log_measurement "deployment_fault_detection" "${mode}" "response_ms" "${latency}" "ms"
  log_measurement "deployment_fault_detection" "${mode}" "http_status" "${code}" "code"
  echo "${resp}" | tee -a "${OUT}"
}

measure_delivery_success() {
  local mode="$1"
  echo "=== Measure: webhook delivery success (mode=${mode}) ===" | tee -a "${OUT}"
  if ! service_up "${CONTROL_PLANE_HEALTH_URL}"; then
    log_warn "SKIP: Control Plane not reachable"
    return 0
  fi
  local start end
  start=$(now_ms)
  local resp
  resp=$(curl -s -w "\n%{http_code}" -X POST "${CONTROL_PLANE_URL}/api/v1/events" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"measure-001\",\"event_type\":\"order.created\",\"source\":\"order-service\",\"payload\":{\"order_id\":\"m-1\"},\"target_url\":\"https://receiver.example.com/events\",\"max_retries\":3}")
  end=$(now_ms)
  local code; code=$(echo "${resp}" | tail -1)
  local latency=$(( end - start ))
  log_measurement "delivery_success" "${mode}" "ingest_latency_ms" "${latency}" "ms"
  log_measurement "delivery_success" "${mode}" "http_status" "${code}" "code"
  echo "${resp}" | tee -a "${OUT}"
}

main() {
  {
    echo "{"
    printf '"started":"%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '"control_plane":"%s"\n' "${CONTROL_PLANE_URL}"
    printf '"order_service":"%s"\n' "${ORDER_SERVICE_URL}"
    echo "}"
  } > "${OUT}"

  if service_up "${CONTROL_PLANE_HEALTH_URL}" && service_up "${ORDER_SERVICE_HEALTH_URL}"; then
    measure_deployment_detection "with-gates"
    measure_delivery_success "with-gates"
    log_warn "Baseline WITHOUT gates not measurable without a controlled experiment harness; raw logs recorded above."
  else
    log_warn "Services not running; measurement SKIP. Start Control Plane (wrangler dev) and Order Service (docker compose) to measure."
  fi

  echo "" | tee -a "${OUT}"
  echo "Measurement results written to ${OUT}"
  echo "No metrics were fabricated; all values are raw observed results."
}

main "$@"
