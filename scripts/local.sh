#!/usr/bin/env bash
# scripts/local.sh — run the whole stack locally with compose.local.yml.
#
#   scripts/local.sh up [service...]    check, build, start, wait for the web
#   scripts/local.sh down               stop (keeps the database and bucket)
#   scripts/local.sh reset              stop and DELETE the local volumes
#   scripts/local.sh logs [service...]  follow logs
#   scripts/local.sh ps                 list containers
#   scripts/local.sh build [service...] rebuild images
#   scripts/local.sh migrate            rerun schemas, roles and migrations
#   scripts/local.sh check              only run the preflight checks
#   scripts/local.sh smoke              smoke-test the cron worker end to end
#                                       (scripts/local-smoke.sh; stack must be up)
#   scripts/local.sh compose <args...>  any other docker compose command
#
# Preflight (up, build, check): every submodule in .gitmodules is checked out
# (an empty one is initialised with `git submodule update --init`) and has a
# Dockerfile at its root, and the dev signing key exists in .local/.
#
# Ports and the seeded admin come from compose.local.yml and can be
# overridden with LOCAL_*_PORT, LOCAL_ADMIN_EMAIL and LOCAL_ADMIN_PASSWORD.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE_FILE="$ROOT/compose.local.yml"

log() { printf '\033[0;36m[local]\033[0m %s\n' "$*"; }
die() { printf '\033[0;31m[local]\033[0m %s\n' "$*" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" --project-directory "$ROOT" "$@"; }

check_tools() {
  command -v docker >/dev/null || die "missing docker"
  docker compose version >/dev/null 2>&1 || die "missing the docker compose plugin"
  docker info >/dev/null 2>&1 || die "cannot reach the Docker daemon"
  command -v git >/dev/null || die "missing git"
}

check_submodules() {
  local paths path missing=0
  paths=$(git -C "$ROOT" config -f .gitmodules --get-regexp '\.path$' | awk '{print $2}')
  [ -n "$paths" ] || die "no submodules listed in .gitmodules"

  for path in $paths; do
    if [ ! -e "$ROOT/$path/.git" ]; then
      log "$path is not checked out; initialising it"
      git -C "$ROOT" submodule update --init --recursive -- "$path" \
        || die "could not initialise $path (check your access to its remote)"
    fi
  done

  for path in $paths; do
    if compgen -G "$ROOT/$path/Dockerfile*" >/dev/null; then
      log "ok  $path ($(cd "$ROOT/$path" && echo Dockerfile*))"
    else
      printf '\033[0;31m[local]\033[0m no Dockerfile at the root of %s\n' "$path" >&2
      missing=1
    fi
  done
  [ "$missing" = 0 ] || die "every service repo needs a Dockerfile at its root"
}

ensure_key() {
  local key="$ROOT/.local/jwt.pem"
  [ -f "$key" ] && return 0
  command -v openssl >/dev/null || die "missing openssl (needed once, to generate $key)"
  mkdir -p "$ROOT/.local"
  openssl genpkey -algorithm ed25519 -out "$key" 2>/dev/null
  # The gateway runs as a non-root user in its image and reads this through a
  # bind-mounted secret, so it must be world-readable. Local dev key only.
  chmod 644 "$key"
  log "generated the dev signing key at .local/jwt.pem"
}

preflight() {
  check_tools
  check_submodules
  ensure_key
}

wait_for_web() {
  local url="http://localhost:${LOCAL_WEB_PORT:-23000}/"
  for _ in $(seq 60); do
    curl -sf -o /dev/null "$url" && return 0
    sleep 1
  done
  die "the web did not answer at $url; see: scripts/local.sh logs"
}

cmd=${1:-up}
[ $# -gt 0 ] && shift

case "$cmd" in
  up)
    preflight
    log "building and starting (first build takes a few minutes)"
    compose up -d --build --remove-orphans "$@"
    command -v curl >/dev/null && wait_for_web
    log "up:"
    log "  web      http://localhost:${LOCAL_WEB_PORT:-23000}"
    log "  gateway  http://localhost:${LOCAL_GATEWAY_PORT:-28080}"
    log "  admin    ${LOCAL_ADMIN_EMAIL:-admin@local.dev} / ${LOCAL_ADMIN_PASSWORD:-local-admin-pass-123}"
    log "  postgres postgresql://neondb_owner:owner@localhost:${LOCAL_PG_PORT:-25432}/coredb"
    log "logs: scripts/local.sh logs    stop: scripts/local.sh down"
    ;;
  down)    compose down --remove-orphans ;;
  reset)   compose down --remove-orphans --volumes && log "local volumes removed" ;;
  logs)    compose logs -f --tail=100 "$@" ;;
  ps)      compose ps -a ;;
  build)   preflight; compose build "$@" ;;
  migrate) compose run --rm --build migrate ;;
  check)   preflight; compose config --quiet && log "compose.local.yml is valid" ;;
  smoke)   exec "$ROOT/scripts/local-smoke.sh" ;;
  compose) compose "$@" ;;
  -h|--help|help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "unknown command '$cmd' (try: scripts/local.sh help)" ;;
esac
