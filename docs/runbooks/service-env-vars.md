# Runbook: `.env` for a new downstream service

Every downstream service (`corefinance`, `coredraw`, `coreban`, …) reads the
**same set of variables**. Only the values change. Start from
`services/corefinance/.env.example`, copy it to `services/<name>/.env.example`
and `services/<name>/.env`, then change the values listed below.

For the code and gateway side of adding a service, see
[`new-downstream-service.md`](new-downstream-service.md) and
[`../adding-a-service.md`](../adding-a-service.md).

## The shared variables

| Variable | What changes per service | Example (`coredraw`) |
|---|---|---|
| `DATABASE_URL` | Role name and password. **Pooler** host (`*-pooler`). No `search_path` param. | `postgresql://coredraw_role:<pw>@<pooler-host>/coredb?sslmode=require&channel_binding=require` |
| `MIGRATION_URL` | Only the schema in `options=-c search_path=<name>`. **Direct** host, owner role. | `postgresql://neondb_owner:<pw>@<direct-host>/coredb?sslmode=require&channel_binding=require&options=-c%20search_path%3Dcoredraw` |
| `ENV` | Same for every service. | `development` |
| `PORT` | Unique per service. Native runs add `1` in front so they can run next to compose. | compose `6971`, native `16971` |
| `JWT_ISSUER` | Same for every service. Must match the gateway's. | `https://gateway.internal` |
| `JWT_AUDIENCE` | The service's **own name only**. Never the gateway's comma-separated list. | `coredraw` |
| `JWT_JWKS_URL` | Same for every service. Compose overrides it with the gateway's service name. | native: `http://localhost:18080/.well-known/jwks.json` |

Current values:

| Service | Role | Schema | Port (compose / native) | Audience |
|---|---|---|---|---|
| corefinance | `corefinance_role` | `corefinance` | 6969 / — | `corefinance` |
| coredraw | `coredraw_role` | `coredraw` | 6971 / 16971 | `coredraw` |
| coreban | `coreban_role` | `coreban` | 6972 / — | `coreban` |

A service can add its own variables after these. coreban has `NTFY_*`,
`REMINDER_CAP`, `S3_*` and `ATTACHMENT_QUOTA`, for example. Put them in that
service's `.env.example` only.

## Steps

1. **Copy the example.** `cp services/corefinance/.env.example services/<name>/.env.example`,
   then change the values from the table above. Copy that to `services/<name>/.env`.
2. **Bootstrap the database (once per environment).** coredraw does steps
   2–4 in one go with `make db-setup` (`scripts/db-setup.sh`); copy that
   script for a new service. By hand: copy
   `internal/db/bootstrap.sql` from an existing service, replace the service
   name, and run it as the owner over the **direct** host:
   ```sh
   psql "$MIGRATION_URL" -f internal/db/bootstrap.sql
   psql "$MIGRATION_URL" -c "ALTER ROLE <name>_role PASSWORD '<generated>';"
   ```
   Put `<generated>` (`openssl rand -hex 24`) in `DATABASE_URL`.
3. **Migrate.** `goose -dir internal/db/migrations postgres "$MIGRATION_URL" up`.
4. **Check.** Connect with `DATABASE_URL`. `show search_path;` should print
   `<name>`, and the service's tables should be visible.
5. **Wire compose.** Add `env_file: ./services/<name>/.env`, and in
   `environment` override `PORT` and
   `JWT_JWKS_URL=http://coregateway-api:8080/.well-known/jwks.json`.

## Pitfalls

- **Don't paste another service's `.env` into this one.** Compose's
  `env_file` and `godotenv` both let a later line win. If you append another
  service's block, the service quietly connects as the other service's role,
  lands in the other service's schema, and rejects every gateway token
  because the audience doesn't match. This happened to coredraw on 2026-11-14.
- **The pooler drops `options`.** Never use the pooler host for
  `MIGRATION_URL`. Never rely on `search_path` in `DATABASE_URL`: the role's
  `ALTER ROLE ... SET search_path` does the scoping.
- **A bare `&search_path=` URL param doesn't work.** libpq rejects it, and the
  session lands in `public`. Use the `options=-c%20search_path%3D<name>` form.
- **Local Postgres has no TLS.** Drop `sslmode` and `channel_binding` from
  both URLs.
- **Never commit `.env`.** Each service repo's `.gitignore` already lists it.
