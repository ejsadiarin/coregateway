#!/usr/bin/env bash
# scripts/local-smoke.sh — smoke-test the corefinance cron worker on the local
# stack (compose.local.yml), end to end through the gateway.
#
#   scripts/local.sh smoke      (or: make local-smoke)
#
# Needs the stack up (scripts/local.sh up), plus curl, jq and GNU date. Never
# touches compose.yml or Neon. Every run registers its own throwaway user, so
# runs don't see each other's data. What it checks, with the worker run as a
# one-shot container (`/app/worker --once`, the same pass the daemon runs):
#
#   one writer (#14) saving a daily rule started 6 days ago fills all 7 days
#                    straight away, through the same pass the worker runs
#   catch-up (#7)    a rule the worker missed (inserted straight into the local
#                    database, as if it was down) is filled by one worker run
#   idempotent       a second run inserts nothing for the rule
#   deletes stick    an entry the user deleted is not recreated
#   timezone (#9)    entries are dated in the user's zone (Asia/Manila here)
#   review list (#8) created_since returns exactly what the worker back-filled
#   end in past (#5) moving end_date back skips the later entries
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
GW="http://localhost:${LOCAL_GATEWAY_PORT:-28080}"
TZNAME=Asia/Manila
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

failures=0
pass() { printf '\033[0;32m  ok\033[0m   %s\n' "$*"; }
fail() { printf '\033[0;31m  FAIL\033[0m %s\n' "$*"; failures=$((failures + 1)); }
die() { printf '\033[0;31m[smoke]\033[0m %s\n' "$*" >&2; exit 1; }
expect() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1: expected '$2', got '$3'"; fi
}

for bin in docker curl jq; do command -v "$bin" >/dev/null || die "missing $bin"; done
date -d '2026-01-01 -1 day' +%F >/dev/null 2>&1 || die "needs GNU date"
curl -sf -o /dev/null "$GW/health" || die "gateway not answering at $GW (run: scripts/local.sh up)"

api() { # method path [json]
  curl -s -b "$JAR" -c "$JAR" -X "$1" -H 'Content-Type: application/json' "$GW$2" ${3:+-d "$3"}
}
psql_local() {
  docker compose -f "$ROOT/compose.local.yml" --project-directory "$ROOT" \
    exec -T postgres psql -U neondb_owner -d coredb -X -tAq -v ON_ERROR_STOP=1 -c "$1"
}
worker_once() {
  docker compose -f "$ROOT/compose.local.yml" --project-directory "$ROOT" \
    run --rm --no-deps corefinance-cron-worker --once >/dev/null 2>&1 \
    || die "worker --once failed (see: docker compose -f compose.local.yml run --rm corefinance-cron-worker --once)"
}
day() { TZ=$TZNAME date -d "$TODAY $1 days" +%F; } # day -6 = six days before today

# --- a throwaway user on Manila time -----------------------------------------
EMAIL="smoke-$(date +%s)-$RANDOM@local.dev"
PASSWORD="smoke-pass-$RANDOM-$RANDOM"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/auth/register" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
[ "$code" = 201 ] || die "register returned $code"
USER_ID=$(api POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r .id)
# The gateway owns the timezone (ADR-0005). corefinance dates a request's
# entries with the token's tz claim, and keeps that zone for the worker's
# passes, which have no token (so the worker runs below come after the user's
# first budget request).
expect "timezone saved at the gateway" "$TZNAME" \
  "$(api PUT "/api/users/$USER_ID/timezone" "{\"timezone\":\"$TZNAME\"}" | jq -r .timezone)"

TODAY=$(TZ=$TZNAME date +%F)
printf '[smoke] user %s, today in %s is %s (UTC: %s)\n' "$EMAIL" "$TZNAME" "$TODAY" "$(date -u +%F)"

entries() { # rule_id [extra query] -> sorted "date status" lines
  api GET "/api/budget/rule-entries?rule_id=$1&page_size=500${2:+&$2}" | jq -r '.[] | "\(.date) \(.status)"' | sort
}
dates() { entries "$@" | awk '{print $1}' | paste -sd' '; }
expected_dates() { # from to (offsets from today)
  local out="" i
  for i in $(seq "$1" "$2"); do out="$out $(day "$i")"; done
  echo "${out# }"
}

# --- one writer ----------------------------------------------------------------
RULE=$(api POST /api/budget/recurring-expenses \
  "{\"amount\":10,\"currency\":\"PHP\",\"description\":\"smoke daily\",\"recurring_type\":\"daily\",\"start_date\":\"$(day -6)\",\"priority\":\"want\"}" | jq -r .id)
[ -n "$RULE" ] && [ "$RULE" != null ] || die "could not create the rule"
expect "saving a rule fills every day up to today (user's date)" "$(expected_dates -6 0)" "$(dates "$RULE")"

# --- catch-up ------------------------------------------------------------------
MISSED=$(psql_local "INSERT INTO corefinance.rules (kind, user_id, description, amount, recurring_type, start_date)
  VALUES ('income', '$USER_ID', 'smoke missed', 5, 'daily', '$(day -6)') RETURNING id" | head -1)
[ -n "$MISSED" ] || die "could not insert the missed rule"
SINCE=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
sleep 1
worker_once
expect "worker fills a rule it missed" "$(expected_dates -6 0)" "$(dates "$MISSED")"
expect "created_since lists what the worker filled" "$(expected_dates -6 0)" \
  "$(dates "$MISSED" "created_since=$SINCE")"

# --- idempotent, deletes stick -----------------------------------------------
worker_once
expect "second run inserts nothing" "7 7" "$(entries "$RULE" | wc -l | tr -d ' ') $(entries "$MISSED" | wc -l | tr -d ' ')"

GONE=$(day -5)
GONE_ID=$(api GET "/api/budget/rule-entries?rule_id=$RULE&start_date=$GONE&end_date=$GONE" | jq -r '.[0].id')
api DELETE "/api/budget/expenses/$GONE_ID" >/dev/null
worker_once
if dates "$RULE" | grep -q "$GONE"; then fail "deleted entry was recreated"; else pass "deleted entry stays deleted"; fi

# --- end date in the past ----------------------------------------------------
RESP=$(api PUT "/api/budget/recurring-expenses/$RULE" \
  "{\"amount\":10,\"currency\":\"PHP\",\"description\":\"smoke daily\",\"recurring_type\":\"daily\",\"start_date\":\"$(day -6)\",\"end_date\":\"$(day -3)\",\"priority\":\"want\"}")
expect "end in past reports the later entries" "$(expected_dates -2 0)" \
  "$(echo "$RESP" | jq -r '.stale_entries[].date' | paste -sd' ')"
expect "and skips them" "skipped skipped skipped" \
  "$(entries "$RULE" "start_date=$(day -2)" | awk '{print $2}' | paste -sd' ')"
expect "entries before the end stay posted" "posted posted posted" \
  "$(entries "$RULE" "end_date=$(day -3)" | awk '{print $2}' | paste -sd' ')"

if [ "$failures" -gt 0 ]; then
  printf '\033[0;31m[smoke] %d check(s) failed\033[0m\n' "$failures"
  exit 1
fi
printf '\033[0;32m[smoke] all checks passed\033[0m\n'
