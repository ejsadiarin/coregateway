-- ==============================================================================
-- coregateway - one-time bootstrap (NOT a goose migration)
-- ==============================================================================
--
-- Creates the runtime role and its grants. Run ONCE per environment
-- (dev / staging / prod, Neon branches inherit project roles) as
-- neondb_owner over the DIRECT (non-pooler) endpoint:
--
--   psql "$MIGRATION_URL" -f internal/db/bootstrap.sql
--
-- Why this is not in internal/db/migrations:
--   - Roles are cluster-level objects; goose version history is per-schema.
--   - Migrations run AS a role (chicken-and-egg: the chain cannot create
--     the identity it executes under, and re-running role DDL on every
--     branch/env is not idempotent-safe).
--   - Industry-standard split: bootstrap (roles/grants, run once by the
--     platform owner) vs. migrations (schema objects, run every deploy).
--
-- Steady state after bootstrap:
--   - MIGRATION_URL = direct host, neondb_owner, options=-c search_path=...
--     (goose CLI only: CI in prod, manual in dev)
--   - DATABASE_URL  = -pooler host, coregateway_role, no URL params
--     (search_path comes from the ALTER ROLE ... SET below, which is the
--     only scoping mechanism that survives PgBouncer transaction pooling:
--     the pooler strips per-connection `options`, but role-level defaults
--     are re-applied by the server via RESET ALL between checkouts)
-- ==============================================================================

-- Runtime role: DML-only on its own schema. Deliberately NOT the owner:
-- ownership implies DROP/ALTER, and the API must never hold DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'coregateway_role') THEN
    CREATE ROLE coregateway_role LOGIN PASSWORD 'REPLACE_ME';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA coregateway TO coregateway_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA coregateway TO coregateway_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA coregateway TO coregateway_role;

-- Future tables/sequences created by the migration owner (neondb_owner)
-- automatically grant DML to the runtime role. FOR ROLE matters: default
-- privileges apply per creating-role, and migrations run as neondb_owner.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA coregateway
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coregateway_role;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA coregateway
  GRANT USAGE, SELECT ON SEQUENCES TO coregateway_role;

-- Pooler-safe schema scoping for the runtime role. No search_path / options
-- params needed in DATABASE_URL.
ALTER ROLE coregateway_role SET search_path = coregateway;
