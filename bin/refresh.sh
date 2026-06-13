#!/usr/bin/env bash
# HQ refresh — rebuild all Layer-1 data + re-render the dashboard.
# Cheap + deterministic (zero LLM tokens). Safe to run on a cron.
#
# Usage:
#   bin/refresh.sh           # index + kpi (git only) + descriptions + dashboard
#   bin/refresh.sh --ci      # also pull CI status (network)
set -euo pipefail

HQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HQ_DIR"

CI_FLAG=""
[ "${1:-}" = "--ci" ] && CI_FLAG="--ci"

echo "[$(date '+%Y-%m-%d %H:%M')] HQ refresh starting…"
node bin/index.js build
node bin/kpi.js collect $CI_FLAG
node bin/enrich.js auto
node bin/dashboard.js
echo "[$(date '+%Y-%m-%d %H:%M')] HQ refresh done."
