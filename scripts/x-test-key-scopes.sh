#!/usr/bin/env bash
# scripts/x-test-key-scopes.sh — e2e for service-scope enforcement
# (openspec change enforce-key-scopes).
#
# Black-box over HTTP against a RUNNING stack (does not boot or rebuild
# anything — cf. x-test-integration.sh for the full compose flow).
#
# --- FILL IN (or export before running) ------------------------------------
ADMIN_EMAIL="${ADMIN_EMAIL:-you-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-fill-me-in}"
# Optional: path to a curl cookie-jar file holding a live ADMIN session
# (created by any earlier `curl -c jar .../api/auth/login`). When set and
# valid, login is skipped. Otherwise the script logs in with the above.
ADMIN_JAR_IN="${ADMIN_JAR:-}"
GW="${GW:-http://localhost:8080}"
# --- end of config ----------------------------------------------------------
#
# What it asserts (K = key shapes minted by the script, all admin-owned):
#   S1  write-only key → 403 on GET /api/users + GET /api/auth/keys (no leak)
#   S2  admin key → 200 on both lists
#   S3  admin-owned read key → 403 on other-profile read, 200 on self-read
#   S4  write-only key → 200 on self-read; read key → 403 on user creation
#   S5  budget gate: write GET → 403, read GET → 200, read POST → 403,
#       write POST passes the gate (2xx/4xx from downstream, never 403),
#       admin session GET → 200 (sessions exempt)
#   S6  targeting unchanged: admin key + ?user_id=<other> → 200,
#       read key + ?user_id=<other> → 403
#
# Cleanup (trap): revokes all minted keys + deletes the helper user via the
# admin session. Your admin row is never touched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TS=$(date +%s)
PASS=0
FAIL=0

TMPDIR_RUN=$(mktemp -d)
JAR="$TMPDIR_RUN/jar"
: > "$JAR"
MINTED_IDS=""
HELPER_ID=""

cleanup() {
  if [ -s "$JAR" ]; then
    for id in $MINTED_IDS; do
      curl -s -o /dev/null -b "$JAR" -X DELETE "$GW/api/auth/keys/$id" || true
    done
    if [ -n "$HELPER_ID" ]; then
      curl -s -o /dev/null -b "$JAR" -X DELETE "$GW/api/users/$HELPER_ID" || true
    fi
  fi
  rm -rf "$TMPDIR_RUN"
  unset ADMIN_PASSWORD K_ADMIN K_SVCADMIN K_READ K_WRITE 2>/dev/null || true
}
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1${2:+ — $2}"; }
expect_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "want [$2] got [$3]"; fi
}
expect_ne() {
  if [ "$2" != "$3" ]; then pass "$1"; else fail "$1" "want anything but [$3]"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
mint() { # mint <label> <scopes-json-array> -> sets MINT_KEY/MINT_ID
  local out http
  out=$(curl -s -w '\n%{http_code}' -b "$JAR" -X POST "$GW/api/auth/keys" \
    -H 'Content-Type: application/json' \
    -d "{\"label\":\"$1\",\"scopes\":$2}")
  http=$(printf '%s' "$out" | tail -1)
  [ "$http" = 201 ] || { fail "mint $1" "want 201 got $http"; return 1; }
  MINT_KEY=$(printf '%s' "$out" | head -n -1 | jq -r '.key')
  MINT_ID=$(printf '%s' "$out" | head -n -1 | jq -r '.id')
  MINTED_IDS="$MINTED_IDS $MINT_ID"
}

echo "== x-test-key-scopes (live stack at $GW) =="
for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing required tool: $bin"; exit 1; }
done
curl -sf "$GW/health" >/dev/null || { echo "stack not reachable at $GW"; exit 1; }
pass "prereqs (curl, jq, gateway healthy)"

# --- admin session ---------------------------------------------------------
if [ -n "$ADMIN_JAR_IN" ] && [ -f "$ADMIN_JAR_IN" ] && \
   [ "$(curl -s -b "$ADMIN_JAR_IN" "$GW/api/auth/me" | jq -r '.role' 2>/dev/null)" = "admin" ]; then
  cp "$ADMIN_JAR_IN" "$JAR"
  pass "reused admin session from ADMIN_JAR"
else
  [ "$ADMIN_PASSWORD" != "fill-me-in" ] || { echo "set ADMIN_EMAIL/ADMIN_PASSWORD (or ADMIN_JAR) at the top of this script"; exit 1; }
  alogin=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/auth/login" -c "$JAR" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
  expect_eq "admin login 200" "200" "$alogin"
  [ "$alogin" = 200 ] || exit 1
fi
ADMIN_ID=$(curl -s -b "$JAR" "$GW/api/auth/me" | jq -r '.id')
[ -n "$ADMIN_ID" ] && [ "$ADMIN_ID" != "null" ] || { fail "me" "no admin id"; exit 1; }

# --- helper (non-admin) user as targeting victim ----------------------------
HELPER_EMAIL="e2e-scope-helper-$TS@example.com"
hout=$(curl -s -w '\n%{http_code}' -b "$JAR" -X POST "$GW/api/users" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$HELPER_EMAIL\",\"password\":\"password123\",\"role\":\"user\"}")
expect_eq "helper user 201" "201" "$(printf '%s' "$hout" | tail -1)"
HELPER_ID=$(printf '%s' "$hout" | head -n -1 | jq -r '.id')

# --- mint the four shapes --------------------------------------------------
echo "-- mint keys --"
mint "scope-e2e-admin-$TS" '["admin"]'             && K_ADMIN=$MINT_KEY
mint "scope-e2e-svcadmin-$TS" '["corefinance:admin"]' && K_SVCADMIN=$MINT_KEY
mint "scope-e2e-read-$TS" '["corefinance:read"]'  && K_READ=$MINT_KEY
mint "scope-e2e-write-$TS" '["corefinance:write"]' && K_WRITE=$MINT_KEY
[ -n "${K_ADMIN:-}" ] && [ -n "${K_SVCADMIN:-}" ] && [ -n "${K_READ:-}" ] && [ -n "${K_WRITE:-}" ] \
  || { fail "mint" "a key shape failed"; exit 1; }
pass "minted admin/svc-admin/read/write keys"

# --- S1 lists need admin scope ---------------------------------------------
echo "-- S1 lists --"
expect_eq "write key list users 403" "403" \
  "$(code -H "Authorization: Bearer $K_WRITE" "$GW/api/users")"
body=$(curl -s -H "Authorization: Bearer $K_WRITE" "$GW/api/users")
case "$body" in
  *"$ADMIN_EMAIL"*|*"@example.com"*) fail "list rejection leaks users" "$body" ;;
  *) pass "list rejection leaks nothing" ;;
esac
expect_eq "write key list keys 403" "403" \
  "$(code -H "Authorization: Bearer $K_WRITE" "$GW/api/auth/keys")"

# --- S2 admin key lists ------------------------------------------------------
echo "-- S2 admin lists --"
expect_eq "admin key list users 200" "200" \
  "$(code -H "Authorization: Bearer $K_ADMIN" "$GW/api/users")"
expect_eq "admin key list keys 200" "200" \
  "$(code -H "Authorization: Bearer $K_ADMIN" "$GW/api/auth/keys")"

# --- S3/S4 profile reads -----------------------------------------------------
echo "-- S3/S4 profile reads --"
expect_eq "admin-owned read key other-read 403" "403" \
  "$(code -H "Authorization: Bearer $K_READ" "$GW/api/users/$HELPER_ID")"
expect_eq "admin-owned read key self-read 200" "200" \
  "$(code -H "Authorization: Bearer $K_READ" "$GW/api/users/$ADMIN_ID")"
expect_eq "write key self-read 200" "200" \
  "$(code -H "Authorization: Bearer $K_WRITE" "$GW/api/users/$ADMIN_ID")"
expect_eq "read key cannot create users 403" "403" \
  "$(code -H "Authorization: Bearer $K_READ" -X POST "$GW/api/users" \
    -H 'Content-Type: application/json' \
    -d '{"email":"scope-nope@example.com","password":"password123","role":"user"}')"

# --- S5 budget gate ------------------------------------------------------------
echo "-- S5 budget gate --"
expect_eq "write key budget GET 403" "403" \
  "$(code -H "Authorization: Bearer $K_WRITE" "$GW/api/budget/remaining")"
expect_eq "read key budget GET 200" "200" \
  "$(code -H "Authorization: Bearer $K_READ" "$GW/api/budget/remaining")"
expect_eq "read key budget POST 403" "403" \
  "$(code -H "Authorization: Bearer $K_READ" -X POST "$GW/api/budget/expenses" \
    -H 'Content-Type: application/json' -d '{"amount":1}')"
expect_ne "write key budget POST passes gate (never 403)" "403" \
  "$(code -H "Authorization: Bearer $K_WRITE" -X POST "$GW/api/budget/expenses" \
    -H 'Content-Type: application/json' -d '{"amount":1}')"
expect_eq "svc-admin key budget GET 200" "200" \
  "$(code -H "Authorization: Bearer $K_SVCADMIN" "$GW/api/budget/remaining")"
expect_ne "svc-admin key budget POST passes gate" "403" \
  "$(code -H "Authorization: Bearer $K_SVCADMIN" -X POST "$GW/api/budget/expenses" \
    -H 'Content-Type: application/json' -d '{"amount":1}')"
expect_eq "admin session budget GET 200 (exempt)" "200" \
  "$(code -b "$JAR" "$GW/api/budget/remaining")"

# --- S6 targeting unchanged ----------------------------------------------------
echo "-- S6 targeting unchanged --"
expect_eq "admin key targeted read 200" "200" \
  "$(code -H "Authorization: Bearer $K_ADMIN" "$GW/api/budget/remaining?user_id=$HELPER_ID")"
expect_eq "read key targeted read 403" "403" \
  "$(code -H "Authorization: Bearer $K_READ" "$GW/api/budget/remaining?user_id=$HELPER_ID")"
expect_eq "admin key malformed target 400" "400" \
  "$(code -H "Authorization: Bearer $K_ADMIN" "$GW/api/budget/remaining?user_id=zzz")"

echo "== x-test-key-scopes: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" = 0 ]
