#!/usr/bin/env bash
# scripts/lib/common.sh - Reusable library for AdaptiveOps deployment automation
set -euo pipefail

# Standard exit codes (exported for consumers of this library)
# shellcheck disable=SC2034
readonly EXIT_SUCCESS=0
# shellcheck disable=SC2034
readonly EXIT_GENERAL_ERROR=1
# shellcheck disable=SC2034
readonly EXIT_INVALID_ARGUMENT=2
# shellcheck disable=SC2034
readonly EXIT_CONFIG_ERROR=3
# shellcheck disable=SC2034
readonly EXIT_DEPENDENCY_MISSING=4
# shellcheck disable=SC2034
readonly EXIT_HEALTH_CHECK_FAILED=5
# shellcheck disable=SC2034
readonly EXIT_ROLLBACK_TRIGGERED=6
# shellcheck disable=SC2034
readonly EXIT_ROLLBACK_FAILED=8
readonly EXIT_CHARGE_GUARDRAIL_VIOLATION=7

# Explicit constants for compatibility with all test specifications
# shellcheck disable=SC2034
readonly EXIT_CODE_SUCCESS=0
# shellcheck disable=SC2034
readonly EXIT_CODE_GENERAL_ERROR=1
# shellcheck disable=SC2034
readonly EXIT_CODE_INVALID_ARGUMENT=2
# shellcheck disable=SC2034
readonly EXIT_CODE_CONFIG_ERROR=3
# shellcheck disable=SC2034
readonly EXIT_CODE_DEPENDENCY_MISSING=4
# shellcheck disable=SC2034
readonly EXIT_CODE_HEALTH_CHECK_FAILED=5
# shellcheck disable=SC2034
readonly EXIT_CODE_ROLLBACK_TRIGGERED=6
# shellcheck disable=SC2034
readonly EXIT_CODE_COST_GUARD=7
# shellcheck disable=SC2034
readonly EXIT_USAGE_ERROR=2
# shellcheck disable=SC2034
readonly EXIT_PREREQ_FAILED=4
# shellcheck disable=SC2034
readonly EXIT_TIMEOUT=4
# shellcheck disable=SC2034
readonly EXIT_HEALTH_FAILED=5
# shellcheck disable=SC2034
readonly EXIT_ROLLBACK_DONE=6
# shellcheck disable=SC2034
readonly EXIT_COST_GUARD_BLOCK=7

# Terminal Color Codes (disabled if not interactive)
if [[ -t 1 ]]; then
  readonly CLR_RESET='\033[0m'
  readonly CLR_RED='\033[0;31m'
  readonly CLR_GREEN='\033[0;32m'
  readonly CLR_YELLOW='\033[0;33m'
  readonly CLR_BLUE='\033[0;34m'
  # shellcheck disable=SC2034
  readonly CLR_CYAN='\033[0;36m'
else
  readonly CLR_RESET=''
  readonly CLR_RED=''
  readonly CLR_GREEN=''
  readonly CLR_YELLOW=''
  readonly CLR_BLUE=''
  # shellcheck disable=SC2034
  readonly CLR_CYAN=''
fi

log_info() {
  printf "%b[INFO]  %s %s%b\n" "${CLR_BLUE}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" "${CLR_RESET}" >&2
}

log_success() {
  printf "%b[OK]    %s %s%b\n" "${CLR_GREEN}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" "${CLR_RESET}" >&2
}

log_warn() {
  printf "%b[WARN]  %s %s%b\n" "${CLR_YELLOW}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" "${CLR_RESET}" >&2
}

log_error() {
  printf "%b[ERROR] %s %s%b\n" "${CLR_RED}" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" "${CLR_RESET}" >&2
}

# Verifies that required commands are installed and accessible in PATH
require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" &>/dev/null; then
    log_error "Required CLI dependency '${cmd}' is not installed or not in PATH."
    exit "${EXIT_DEPENDENCY_MISSING}"
  fi
}

# Retry function with exponential backoff: retry_command <max_attempts> <delay_seconds> <command...>
retry_command() {
  local max_attempts="$1"
  local delay="$2"
  shift 2
  local attempt=1
  local exit_code=0

  while (( attempt <= max_attempts )); do
    log_info "Attempt ${attempt}/${max_attempts}: Running '$*'"
    if "$@"; then
      return 0
    fi
    exit_code=$?
    if (( attempt == max_attempts )); then
      log_error "Command failed after ${max_attempts} attempts: $*"
      return "${exit_code}"
    fi
    local jitter=$(( RANDOM % 2 ))
    local sleep_duration=$(( delay + jitter ))
    log_warn "Command failed (exit ${exit_code}). Retrying in ${sleep_duration}s..."
    sleep "${sleep_duration}"
    delay=$(( delay * 2 ))
    attempt=$(( attempt + 1 ))
  done

  return "${exit_code}"
}

# Alias for retry_command
retry_with_backoff() {
  retry_command "$@"
}

# Enforce strict zero-cost cloud guardrail
verify_cost_guard() {
  local target="$1"
  if [[ "${target}" == "aws" || "${target}" == "azure" ]]; then
    local allow_charges="${ADAPTIVEOPS_ALLOW_CLOUD_CHARGES:-false}"
    if [[ "${allow_charges}" != "true" ]]; then
      log_error "Charge guardrail violation: Target '${target}' is cloud-chargeable."
      log_error "ADAPTIVEOPS_ALLOW_CLOUD_CHARGES is '${allow_charges}', required: 'true'."
      log_error "Execution halted to prevent unintended cloud expenditures."
      exit "${EXIT_CHARGE_GUARDRAIL_VIOLATION}"
    else
      log_warn "ADAPTIVEOPS_ALLOW_CLOUD_CHARGES=true detected. Proceeding with cloud target '${target}'."
    fi
  fi
}

# Default error and exit trapping
common_trap_err() {
  local exit_code="$?"
  local line_no="${1:-${LINENO}}"
  local bash_cmd="${2:-${BASH_COMMAND}}"
  log_error "Failure at line ${line_no} (command: '${bash_cmd}', exit code: ${exit_code})"
}

common_cleanup() {
  :
}

trap 'common_trap_err ${LINENO} "${BASH_COMMAND}"' ERR
trap 'common_cleanup' EXIT
