#!/usr/bin/env bash
# scripts/e2e-up.sh — start a disposable local stack for browser e2e runs.
#
# Never touches the databases in .env: Postgres and ntfy run as throwaway
# Docker containers, and the gateway, coreban, and the web dev server run
# natively against them with fixed test credentials. Every run starts from
# an empty database. Stop it with scripts/e2e-down.sh.
#
#   Postgres  127.0.0.1:55432   (ghcr.io/fboulnois/pg_uuidv7: the gateway's
#                                first migration creates that extension)
#   ntfy      127.0.0.1:18090   deny-all; coreban writes coreban-* only,
#                                user "owner" reads coreban-e2e
#   gateway   127.0.0.1:18080   COREBAN_URL -> :16972
#   coreban   127.0.0.1:16972   REMINDER_CAP=5 (low, so the cap is testable)
#   web       http://localhost:3001  (VITE_API_URL -> :18080)
#
# These are the native-run offsets, so the stack can coexist with
# compose.yml (:3000/:8080/:6972). State, logs and PIDs live in .e2e/.
#
# Then: cd web && pnpm e2e
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
E2E="$ROOT/.e2e"
PG=cb-e2e-pg
NTFY=cb-e2e-ntfy

ADMIN_EMAIL=admin@e2e.local
ADMIN_PASSWORD=e2e-admin-pass-123
OWNER_URL="postgresql://neondb_owner:owner@localhost:55432/coredb?sslmode=disable"

log() { printf '\033[0;36m[e2e]\033[0m %s\n' "$*"; }
die() { printf '\033[0;31m[e2e]\033[0m %s\n' "$*" >&2; exit 1; }

# wait_for <description> <seconds> <command...>
wait_for() {
  local what=$1 secs=$2; shift 2
  for _ in $(seq "$secs"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  die "timed out waiting for $what (logs: $E2E/*.log)"
}

for cmd in docker psql goose go pnpm curl openssl; do
  command -v "$cmd" >/dev/null || die "missing $cmd"
done
[ -f "$E2E/pids" ] && die "a stack is already up; run scripts/e2e-down.sh first"
for port in 55432 18090 18080 16972 3001; do
  ss -ltn "sport = :$port" | grep -q LISTEN && die "port $port is in use"
done

mkdir -p "$E2E/bin"
: > "$E2E/pids"

log "building gateway and coreban"
(cd "$ROOT" && go build -o "$E2E/bin/coregateway" ./cmd/coregateway)
(cd "$ROOT/services/coreban" && go build -o "$E2E/bin/coreban" ./cmd/coreban)

log "starting Postgres and ntfy"
docker rm -f "$PG" "$NTFY" >/dev/null 2>&1 || true
docker run -d --name "$PG" -e POSTGRES_USER=neondb_owner -e POSTGRES_PASSWORD=owner \
  -e POSTGRES_DB=coredb -p 127.0.0.1:55432:5432 ghcr.io/fboulnois/pg_uuidv7:1.6.0 >/dev/null
cat > "$E2E/ntfy.yml" <<'YAML'
base-url: http://localhost:18090
listen-http: ":80"
auth-file: /var/lib/ntfy/user.db
auth-default-access: deny-all
YAML
docker run -d --name "$NTFY" -v "$E2E/ntfy.yml:/etc/ntfy/server.yml:ro" --tmpfs /var/lib/ntfy \
  -p 127.0.0.1:18090:80 binwiederhier/ntfy serve >/dev/null

wait_for Postgres 60 psql "$OWNER_URL" -c 'select 1'
log "migrating"
psql "$OWNER_URL" -qc 'CREATE SCHEMA IF NOT EXISTS coregateway'
goose -dir "$ROOT/internal/db/migrations" postgres "$OWNER_URL&options=-c%20search_path%3Dcoregateway" up >/dev/null
sed 's/REPLACE_ME/gwpw/' "$ROOT/internal/db/bootstrap.sql" | psql "$OWNER_URL" -q
sed 's/REPLACE_ME/cbpw/' "$ROOT/services/coreban/internal/db/bootstrap.sql" | psql "$OWNER_URL" -q
MIGRATION_URL="$OWNER_URL&options=-c%20search_path%3Dcoreban" DATABASE_URL=unused JWT_JWKS_URL=unused \
  "$E2E/bin/coreban" migrate >/dev/null

wait_for ntfy 30 curl -sf http://localhost:18090/v1/health
docker exec -e NTFY_PASSWORD=corebanpw "$NTFY" ntfy user add coreban >/dev/null
docker exec "$NTFY" ntfy access coreban 'coreban-*' write-only >/dev/null
docker exec -e NTFY_PASSWORD=ownerpw "$NTFY" ntfy user add owner >/dev/null
docker exec "$NTFY" ntfy access owner coreban-e2e read-only >/dev/null
NTFY_TOKEN=$(docker exec "$NTFY" ntfy token add coreban | awk '{print $2}')

[ -f "$E2E/jwt.pem" ] || openssl genpkey -algorithm ed25519 -out "$E2E/jwt.pem"

log "starting gateway :18080"
env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL="postgresql://coregateway_role:gwpw@localhost:55432/coredb?sslmode=disable" \
  PORT=18080 ENV=development ALLOWED_ORIGINS=http://localhost:3001 \
  COREBAN_URL=http://localhost:16972 COREFINANCE_URL=http://localhost:16969 COREDRAW_URL=http://localhost:16971 \
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  JWT_KID=e2e JWT_ISSUER=https://gateway.internal JWT_AUDIENCE=corefinance,coredraw,coreban \
  JWT_TTL_SECONDS=300 JWT_PRIVATE_KEY_FILE="$E2E/jwt.pem" \
  "$E2E/bin/coregateway" > "$E2E/gateway.log" 2>&1 &
echo "gateway $!" >> "$E2E/pids"
wait_for gateway 30 curl -sf http://localhost:18080/.well-known/jwks.json

log "starting coreban :16972"
cat > "$E2E/coreban.env" <<ENV
PORT=16972
DATABASE_URL=postgresql://coreban_role:cbpw@localhost:55432/coredb?sslmode=disable
JWT_ISSUER=https://gateway.internal
JWT_AUDIENCE=coreban
JWT_JWKS_URL=http://localhost:18080/.well-known/jwks.json
NTFY_URL=http://localhost:18090
NTFY_TOKEN=$NTFY_TOKEN
REMINDER_CAP=5
ENV
env -i PATH="$PATH" HOME="$HOME" $(cat "$E2E/coreban.env") "$E2E/bin/coreban" > "$E2E/coreban.log" 2>&1 &
echo "coreban $!" >> "$E2E/pids"
wait_for coreban 30 curl -sf http://localhost:16972/health

log "starting web :3001"
(cd "$ROOT/web" && VITE_API_URL=http://localhost:18080 exec node_modules/.bin/vite --port 3001 --strictPort) \
  > "$E2E/web.log" 2>&1 &
echo "web $!" >> "$E2E/pids"
wait_for web 60 curl -sf http://localhost:3001/

log "up. admin: $ADMIN_EMAIL / $ADMIN_PASSWORD; ntfy subscriber: owner / ownerpw on coreban-e2e"
log "run the browser suite: cd web && pnpm e2e    stop: scripts/e2e-down.sh"
