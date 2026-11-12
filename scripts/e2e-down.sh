#!/usr/bin/env bash
# scripts/e2e-down.sh — stop what scripts/e2e-up.sh started. Safe to rerun.
# Keeps .e2e/*.log for a look after a failed run.
set -uo pipefail

E2E="$(cd "$(dirname "$0")/.." && pwd)/.e2e"

if [ -f "$E2E/pids" ]; then
  while read -r name pid; do
    kill "$pid" 2>/dev/null && echo "[e2e] stopped $name ($pid)"
  done < "$E2E/pids"
  rm -f "$E2E/pids"
fi
for c in cb-e2e-pg cb-e2e-ntfy cb-e2e-s3; do
  [ -n "$(docker ps -aq --filter "name=^$c$")" ] && docker rm -f "$c" >/dev/null && echo "[e2e] removed $c"
done
exit 0
