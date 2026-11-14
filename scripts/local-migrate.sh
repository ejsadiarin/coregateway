#!/bin/sh
# scripts/local-migrate.sh — the `migrate` job of compose.local.yml.
#
# Runs INSIDE that container (POSIX sh, alpine): the repo is mounted read-only
# at /src, and PGHOST/PGUSER/PGPASSWORD/PGDATABASE point at the local Postgres
# as neondb_owner. Mirrors what scripts/e2e-up.sh does natively. Every step is
# idempotent, so this runs on each `up`.
#
# Role passwords are fixed dev values; compose.local.yml uses the same ones.
set -eu

OWNER="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:5432/$PGDATABASE?sslmode=disable"
scoped() { echo "$OWNER&options=-c%20search_path%3D$1"; }   # $1: comma-separated schemas
bootstrap() { sed "s/REPLACE_ME/$2/" "$1" | psql -q -v ON_ERROR_STOP=1; }
log() { echo "[local-migrate] $*"; }

for schema in coregateway coreban corefinance coredraw; do
  psql -qc "CREATE SCHEMA IF NOT EXISTS $schema"
done

log "coregateway"
goose -dir /src/internal/db/migrations postgres "$(scoped coregateway)" up
bootstrap /src/internal/db/bootstrap.sql gwpw

log "coreban"
goose -dir /src/services/coreban/internal/db/migrations postgres "$(scoped coreban)" up
bootstrap /src/services/coreban/internal/db/bootstrap.sql cbpw

# corefinance's baseline calls uuid_generate_v7(), which the gateway's first
# migration installed in the coregateway schema, so it needs that schema on
# its path. Its own version table keeps goose off the gateway's.
log "corefinance"
goose -table corefinance.goose_db_version -dir /src/services/corefinance/internal/db/migrations \
  postgres "$(scoped corefinance,coregateway)" up
bootstrap /src/services/corefinance/internal/db/bootstrap.sql cfpw

# coredraw ships no bootstrap.sql; this is the same shape as the others.
log "coredraw"
goose -dir /src/services/coredraw/internal/db/migrations postgres "$(scoped coredraw)" up
psql -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coredraw_role') THEN
    CREATE ROLE coredraw_role LOGIN PASSWORD 'cdpw';
  END IF;
END
$$;
GRANT USAGE ON SCHEMA coredraw TO coredraw_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA coredraw TO coredraw_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA coredraw TO coredraw_role;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA coredraw
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coredraw_role;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA coredraw
  GRANT USAGE, SELECT ON SEQUENCES TO coredraw_role;
ALTER ROLE coredraw_role SET search_path = coredraw;
SQL

log "done"
