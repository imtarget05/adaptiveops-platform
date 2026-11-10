#!/usr/bin/env bash

# ==============================================================================
# AdaptiveOps Platform - E2E Test Suite Runner
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

export NODE_ENV="test"

echo "======================================================================"
echo "          Starting AdaptiveOps Opaque-Box E2E Test Suite              "
echo "======================================================================"

cd "${SCRIPT_DIR}"

if command -v node >/dev/null 2>&1; then
    node "${SCRIPT_DIR}/runner.mjs" "$@"
    exit_code=$?
    exit ${exit_code}
else
    echo "ERROR: Node.js (>= 18) is required to run the E2E test suite." >&2
    exit 1
fi
