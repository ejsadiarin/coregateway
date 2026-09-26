#!/usr/bin/env bash
# scripts/x-test-integration.sh — cross-service (x-) integration test.
#
# NOTE on the `x-` prefix: this script runs against the COMPOSED system
# (compose.yml: real gateway + corefinance containers, real DBs, real JWKS
# fetch over HTTP). It is deliberately NOT part of either Go module's
# `test-*` suites — those stay single-module (`go test ./...` never crosses
# the nested-module boundary, and neither module imports the other). For now
# only test-related cross-service automation exists (`x-test-*`); the prefix
# reserves room for future cross-service helpers.
#
# What it asserts (black-box over HTTP, cf. proposal in
# openspec/changes/x-test-e2e/):
#   X1  gateway health + JWKS serves this run's kid
#   X3  cookie session chain reaches downstream (remaining 200)
#   X4  anonymous budget access is 401 with the exact error body
#   X5  forged X-User-ID is ignored (byte-identical data)
#   X6  Pattern B: raw service key 401 at edge (+ service JWT 401 at edge:
#       internal JWTs are not edge credentials) -> exchange -> service JWT
#       200 direct-to-downstream on /internal/recurring/active, while a bare
#       cookie there is 401
#   X7  rotation overlap (2 kids, old session passes) + cut (1 kid)
#
# Guarantees / non-goals (see design.md):
#   - Needs: docker (compose v2), curl, jq, openssl, DATABASE_URL resolvable
#     (env or .env — compose interpolates the same way).
#   - Ephemeral Ed25519 keys + unique admin identity per run; seed-at-boot
#     creates the admin, so no DB shell is ever needed.
#   - Temp key material is shredded and secrets unset on exit (trap).
#   - Created users/keys are deleted via the public API. The ephemeral admin
#     row cannot self-delete (service rule) — one labeled e2e-admin-* row per
#     run remains in the shared dev DB by design.
#   - NEVER runs `compose down`: your dev stack is left running.
#   - Skips fail-closed boot + web UI (manual runbook covers those).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GW=http://localhost:8080
FIN=http://localhost:6969
TS=$(date +%s)
ADMIN_EMAIL="e2e-admin-$TS@example.com"
USER_EMAIL="e2e-user-$TS@example.com"
SVC_LABEL="e2e-svc-$TS"
PASS=0
FAIL=0

# --- ephemeral material (shredded on exit) ---------------------------------
TMPDIR_RUN=$(mktemp -d)
KEY_A="$TMPDIR_RUN/jwt-a.pem"
KEY_B="$TMPDIR_RUN/jwt-b.pem"
JAR="$TMPDIR_RUN/jar"
ADMIN_JAR="$TMPDIR_RUN/admin-jar"
cleanup() {
  shred -u "$KEY_A" "$KEY_B" 2>/dev/null || true
  rm -rf "$TMPDIR_RUN"
  unset ADMIN_PASSWORD USER_PASSWORD SVC_KEY SVC_JWT \
    JWT_PRIVATE_KEY_PEM JWT_PREV_PRIVATE_KEY_PEM 2>/dev/null || true
}
trap cleanup EXIT

# --- helpers ---------------------------------------------------------------
pass() { PASS=$((PASS + 1)); echo "  PASS $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1${2:+ — $2}"; }
# expect_eq <name> <expected> <actual>
expect_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "want [$2] got [$3]"; fi
}
# wait_for <name> <timeout_s> <command...>: polls until exit 0
wait_for() {
  local name="$1" timeout="$2"; shift 2
  local deadline=$((SECONDS + timeout))
  while ! "$@" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then fail "$name" "timed out after ${timeout}s"; return 1; fi
    sleep 2
  done
  pass "$name"
}
# jget <url> <jqexpr>: fetch JSON field, never fails (returns __fetch_failed__)
jget() {
  curl -s "$1" 2>/dev/null | jq -r "$2" 2>/dev/null || echo "__fetch_failed__"
}
# jwt_field <token> <jqexpr>: decode JWT payload field ("" when absent)
jwt_field() {
  local b64; b64=$(printf '%s' "$1" | cut -d. -f2)
  case $(( ${#b64} % 4 )) in
    2) b64="${b64}==" ;; 3) b64="${b64}=" ;;
  esac
  printf '%s' "$b64" | tr '_-' '/+' | base64 -d 2>/dev/null | jq -r "$2" 2>/dev/null || echo ""
}

echo "== x-test-integration (cross-service, compose stack) =="

# --- prereqs ---------------------------------------------------------------
for bin in docker curl jq openssl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing required tool: $bin"; exit 1; }
done
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 required"; exit 1; }
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # Extract without executing: .env values may contain unquoted & etc.
  for var in DATABASE_URL MIGRATION_URL; do
    val=$(grep -E "^${var}=" .env | cut -d= -f2- || true)
    [ -n "$val" ] && export "$var=$val"
  done
fi
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is empty (env or .env); compose cannot interpolate the gateway config"; exit 1; }
pass "prereqs (docker, curl, jq, openssl, DATABASE_URL)"

# --- ephemeral identity ----------------------------------------------------
ADMIN_PASSWORD=$(openssl rand -base64 24)
USER_PASSWORD=$(openssl rand -base64 24)
KID_A="e2e-a-$TS"
openssl genpkey -algorithm ed25519 -out "$KEY_A" 2>/dev/null
export JWT_KID="$KID_A" ADMIN_EMAIL ADMIN_PASSWORD
JWT_PRIVATE_KEY_PEM=$(cat "$KEY_A")
export JWT_PRIVATE_KEY_PEM
export JWT_PREV_PRIVATE_KEY_PEM= JWT_PREV_KID=
pass "ephemeral key + identities (kid=$KID_A admin=$ADMIN_EMAIL)"

# --- boot ------------------------------------------------------------------
echo "-- boot stack --"
docker compose up -d --build coregateway-api corefinance-api
wait_for "gateway healthy" 180 curl -sf "$GW/health"
# Boot race: finance fail-closes (by design) if the gateway is not serving
# JWKS yet when it starts. Re-running up starts it if it exited; a no-op if
# it is already healthy. (A compose healthcheck+depends_on would also fix
# this, but that belongs to the dev topology, not this script.)
docker compose up -d corefinance-api
wait_for "finance reachable" 120 curl -sf "$FIN/api/budget/priority-groups"
wait_for "jwks served" 60 curl -sf "$GW/.well-known/jwks.json"
expect_eq "X1 jwks serves run kid" "$KID_A" \
  "$(jget "$GW/.well-known/jwks.json" '.keys[0].kid')"

# --- X3 session chain ------------------------------------------------------
echo "-- X3 session chain --"
reg=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}")
expect_eq "register 201" "201" "$reg"
[ "$reg" = 201 ] || { echo "cannot continue without a user"; exit 1; }
USER_ID=$(curl -s -X POST "$GW/api/auth/login" -c "$JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}" | jq -r '.id' 2>/dev/null || echo "")
if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then fail "login" "no user id"; exit 1; fi
pass "login (user $USER_ID)"
# NOTE: me/remaining must send the cookie jar; jget has no jar support, so
# authed JSON reads below use curl directly (curl -s never fails the script
# on HTTP errors; jq failures fall back to __fetch_failed__).
expect_eq "me sees e2e user (authed)" "$USER_EMAIL" \
  "$(curl -s -b "$JAR" "$GW/api/auth/me" | jq -r '.email' 2>/dev/null || echo __fetch_failed__)"
BODY_REAL=$(curl -s -b "$JAR" "$GW/api/budget/remaining")
expect_eq "remaining 200 via edge->downstream" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$GW/api/budget/remaining")"

# --- X4 anonymous ----------------------------------------------------------
echo "-- X4 anonymous --"
code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/api/budget/remaining")
body=$(curl -s "$GW/api/budget/remaining")
expect_eq "anon status 401" "401" "$code"
expect_eq "anon exact body" '{"error":"Authentication required"}' "$body"

# --- X5 forged header ------------------------------------------------------
echo "-- X5 forged X-User-ID --"
BODY_FORGED=$(curl -s -b "$JAR" -H "X-User-ID: 00000000-0000-0000-0000-000000000000" \
  "$GW/api/budget/remaining")
expect_eq "forged header ignored (byte-identical)" "$BODY_REAL" "$BODY_FORGED"

# --- X6 Pattern B ----------------------------------------------------------
echo "-- X6 Pattern B service token --"
alogin=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$GW/api/auth/login" -c "$ADMIN_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
expect_eq "admin login 200 (seed-at-boot)" "200" "$alogin"
prov=$(curl -s -w '\n%{http_code}' -b "$ADMIN_JAR" -X POST "$GW/api/auth/keys/service" \
  -H 'Content-Type: application/json' \
  -d "{\"label\":\"$SVC_LABEL\",\"scopes\":[\"finance:read\"]}")
expect_eq "provision 201" "201" "$(printf '%s' "$prov" | tail -1)"
SVC_KEY=$(printf '%s' "$prov" | head -n -1 | jq -r '.key' 2>/dev/null || echo "")
SVC_ID=$(printf '%s' "$prov" | head -n -1 | jq -r '.id' 2>/dev/null || echo "")
[ -n "$SVC_KEY" ] && [ "$SVC_KEY" != "null" ] || { fail "provision" "no key"; exit 1; }
expect_eq "raw service key 401 at edge" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SVC_KEY" \
    "$GW/api/budget/remaining")"
SVC_JWT=$(curl -s -X POST "$GW/api/auth/token" \
  -H 'Content-Type: application/json' -d "{\"key\":\"$SVC_KEY\"}" | jq -r '.token' 2>/dev/null || echo "")
[ -n "$SVC_JWT" ] && [ "$SVC_JWT" != "null" ] || { fail "exchange" "no token"; exit 1; }
pass "exchange yields service JWT"
expect_eq "service token has no sub" "" "$(jwt_field "$SVC_JWT" '.sub // ""')"
expect_eq "service token azp = label" "$SVC_LABEL" "$(jwt_field "$SVC_JWT" '.azp')"
expect_eq "service JWT 401 at edge (internal JWTs are not edge credentials)" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SVC_JWT" \
    "$GW/api/budget/remaining")"
expect_eq "service JWT 200 direct-to-downstream" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SVC_JWT" \
    "$FIN/internal/recurring/active")"
expect_eq "bare cookie 401 direct-to-downstream" "401" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" \
    "$FIN/internal/recurring/active")"

# --- X7 rotation -----------------------------------------------------------
echo "-- X7 rotation overlap + cut --"
KID_B="e2e-b-$TS"
openssl genpkey -algorithm ed25519 -out "$KEY_B" 2>/dev/null
export JWT_PREV_PRIVATE_KEY_PEM="$JWT_PRIVATE_KEY_PEM" JWT_PREV_KID="$KID_A"
JWT_PRIVATE_KEY_PEM=$(cat "$KEY_B")
export JWT_PRIVATE_KEY_PEM JWT_KID="$KID_B"
docker compose up -d coregateway-api
wait_for "gateway healthy after overlap" 180 curl -sf "$GW/health"
sleep 3  # let JWKS settle post-recreate
expect_eq "overlap serves 2 kids" "2" \
  "$(jget "$GW/.well-known/jwks.json" '.keys | length')"
expect_eq "old session still 200 during overlap" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$GW/api/budget/remaining")"
export JWT_PREV_PRIVATE_KEY_PEM= JWT_PREV_KID=
docker compose up -d coregateway-api
wait_for "gateway healthy after cut" 180 curl -sf "$GW/health"
sleep 3
expect_eq "cut serves 1 kid" "1" \
  "$(jget "$GW/.well-known/jwks.json" '.keys | length')"
expect_eq "cut serves new kid" "$KID_B" \
  "$(jget "$GW/.well-known/jwks.json" '.keys[0].kid')"
expect_eq "session 200 after cut" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$GW/api/budget/remaining")"

# --- cleanup (best-effort, public API) -------------------------------------
echo "-- cleanup --"
expect_eq "revoke service key" "204" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$ADMIN_JAR" -X DELETE \
    "$GW/api/auth/keys/$SVC_ID")"
expect_eq "delete e2e user" "204" \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$ADMIN_JAR" -X DELETE \
    "$GW/api/users/$USER_ID")"
echo "NOTE: ephemeral admin $ADMIN_EMAIL cannot self-delete (service rule);"
echo "one labeled row per run remains in the shared dev DB by design."
echo "Stack left RUNNING (never 'compose down' from this script)."

echo "== x-test-integration: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" = 0 ]
