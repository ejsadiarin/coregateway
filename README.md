# CoreGateway

API gateway and service monitor for a homelab dashboard. Built with Go, chi, pgx, and sqlc.

It is one of four repos that run together:

| Repo | Path | What it is |
|---|---|---|
| coregateway | `.` | The gateway (`cmd/coregateway`) and the dashboard web app (`web/`) |
| corefinance | `services/corefinance` (submodule) | Budget: expenses, incomes, recurring rules |
| coreban | `services/coreban` (submodule) | Kanban boards, reminders, and the Feed |
| coredraw | `services/coredraw` (submodule) | Whiteboards |

Pick the path that fits:

- **Try everything on your machine:** [Quick start](#quick-start-the-whole-stack-locally). Docker only, no accounts, no `.env`.
- **Run the stack against your real databases:** [Running against your own databases](#running-against-your-own-databases).
- **Deploy to production:** [Production prerequisites](#production-prerequisites).
- **Work on the gateway's Go code:** [Native development](#native-development).

## Quick start: the whole stack locally

You need Docker with the compose plugin, git with SSH access to the
submodule repos, `openssl` and `curl`.

```bash
git clone --recurse-submodules git@github.com:ejsadiarin/coregateway.git
cd coregateway
make local-up
```

The first run builds every image, which takes a few minutes. `make local-up`
checks out any missing submodule, generates a dev signing key in `.local/`,
starts Postgres and an S3 server in containers, runs every migration, and
waits for the web to answer. Then open:

| What | Where |
|---|---|
| Dashboard | http://localhost:23000 |
| Sign in | `admin@local.dev` / `local-admin-pass-123` |
| Gateway | http://localhost:28080 |
| Postgres | `postgresql://neondb_owner:owner@localhost:25432/coredb` |
| S3 (versitygw) | http://localhost:27070, bucket `coreban-attachments` |

Nothing here reads `.env` or reaches Neon, R2 or ntfy. Reminders are saved
but not sent, since there is no ntfy server. Every port binds to
`127.0.0.1`, and each can be changed with `LOCAL_*_PORT` (see the top of
`compose.local.yml`).

| Command | What it does |
|---|---|
| `make local-up` | Build and start everything (`S=<service>` for one) |
| `make local-down` | Stop, keeping the database and the bucket |
| `make local-reset` | Stop and **delete** the local data |
| `make local-logs` | Follow logs (`S=coreban-api` for one service) |
| `make local-ps` | List the containers |
| `make local-migrate` | Rerun the schemas, roles and migrations |
| `make local-check` | Only check submodules, Dockerfiles and the compose file |
| `make local-smoke` | Smoke-test the corefinance worker end to end (stack must be up) |

## Running against your own databases

`compose.yml` runs the same services on the databases in your `.env` files,
for example to try a change on production data. It binds the web and the
gateway to `localhost` and to this machine's Tailscale IP, so other tailnet
devices can reach it.

1. Fill in `.env` here and in each `services/*/.env` ([which values](#the-env-files)).
2. Give the gateway its signing key: [`docs/deploy/gateway-signing-key.md`](docs/deploy/gateway-signing-key.md), "Compose: once per machine".
3. Start it:

```bash
make stack-up      # build and start; prints the web address
make stack-logs    # S=<service> for one
make stack-ps
make stack-down
```

The web is at `http://<tailscale-ip>:3000` and `http://localhost:3000`.
Everything you do there is real: it writes to the databases in `.env`. The
corefinance worker runs here too, which is safe next to production's,
because only one pass at a time writes a user's rule entries (corefinance
ADR-0001). coreban sends reminders only if its `.env` sets `NTFY_URL`; leave
it empty so that production stays the only sender.

## Production prerequisites

Everything the deployed stack needs. The optional rows can be added later;
the stack starts without them.

| # | What | Needed for | How |
|---|---|---|---|
| 1 | Neon Postgres: database `coredb`, one schema and one role per repo | Everything | [Setting up Neon](#setting-up-neon) below |
| 2 | An Ed25519 signing key for the gateway | Every request to a downstream | [`docs/deploy/gateway-signing-key.md`](docs/deploy/gateway-signing-key.md); rotation: [`docs/runbooks/jwt-key-rotation.md`](docs/runbooks/jwt-key-rotation.md) |
| 3 | A `.env` (or a Secret) per repo | Everything | [The `.env` files](#the-env-files) below |
| 4 | Cloudflare R2 bucket, API token and CORS rule | Images and videos in the Feed (optional) | [`docs/deploy/coreban-attachments.md`](docs/deploy/coreban-attachments.md) |
| 5 | An ntfy server and a token for coreban | Sending reminders (optional) | [`services/coreban/README.md`](services/coreban/README.md#ntfy-server) |
| 6 | A domain, Cloudflare Tunnel and Tailscale | Reaching the dashboard | [`docs/deploy/homelab-k3s.md`](docs/deploy/homelab-k3s.md), sections 13 and 14 |
| 7 | Images and a cluster to run them | Running it | [`docs/deploy/homelab-k3s.md`](docs/deploy/homelab-k3s.md), section 15 |

Tools on the machine you deploy from: Go 1.26+, `psql`, `openssl`, and
`goose` (`go install github.com/pressly/goose/v3/cmd/goose@latest`).

### Setting up Neon

Do this once per environment. Nothing migrates when a service starts.

1. **Create the project.** In Neon, create a project and a database named
   `coredb`. Note two connection hosts: the **direct** one, and the
   **pooled** one (its name contains `-pooler`). The owner role is
   `neondb_owner`.
2. **Write each repo's `.env`** from its `.env.example`
   ([which values](#the-env-files)). `MIGRATION_URL` uses the direct host and
   `neondb_owner`. `DATABASE_URL` uses the pooled host and the repo's own
   role, whose password you choose in step 5.
3. **Create the four schemas**, from this repo:

   ```bash
   MIGRATION_URL=$(grep -m1 '^MIGRATION_URL=' .env | cut -d= -f2-)
   psql "$MIGRATION_URL" -c 'CREATE SCHEMA IF NOT EXISTS coregateway; CREATE SCHEMA IF NOT EXISTS corefinance; CREATE SCHEMA IF NOT EXISTS coreban; CREATE SCHEMA IF NOT EXISTS coredraw;'
   ```

4. **Migrate the gateway first.** corefinance's first migration uses a
   function the gateway's migrations install.

   ```bash
   make migrate-up
   ```

5. **Create the gateway's role.** Neon refuses weak passwords, so generate
   one and put it into `internal/db/bootstrap.sql` as you run it:

   ```bash
   PW=$(openssl rand -base64 24 | tr -d '/+=')
   sed "s/REPLACE_ME/$PW/" internal/db/bootstrap.sql | psql "$MIGRATION_URL" -v ON_ERROR_STOP=1
   echo "$PW"   # put this into DATABASE_URL as coregateway_role's password
   ```

6. **Repeat steps 4 and 5 in each service**, from its directory with its own
   `.env` (read its `MIGRATION_URL` the same way first): `services/corefinance`,
   then `services/coreban`. For coredraw,
   its `db-setup` target does both steps and writes the password into its `.env`.
   On a brand-new database, give corefinance's first migration the gateway's
   schema too: end its `MIGRATION_URL` with
   `options=-c%20search_path%3Dcorefinance%2Ccoregateway`, and change it back
   to `search_path%3Dcorefinance` afterwards.
7. **Check.** `make migrate-status` in each repo lists every migration as
   applied.

Later releases need only `make migrate-up` in the repo being released, before
its new image goes out ([`homelab-k3s.md` section 15.6](docs/deploy/homelab-k3s.md#156-database-migrations)).

### The `.env` files

Copy each `.env.example` to `.env`; the comments in each explain every value.

| File | Must set | Optional |
|---|---|---|
| `.env` (gateway) | `DATABASE_URL`, `MIGRATION_URL`, `JWT_PRIVATE_KEY_FILE`, `JWT_KID`, `ALLOWED_ORIGINS`, `ENV` | `ADMIN_EMAIL` / `ADMIN_PASSWORD` (creates the first admin on start), `CORE*_URL` |
| `services/corefinance/.env` | `DATABASE_URL`, `MIGRATION_URL`, `JWT_JWKS_URL` | |
| `services/coreban/.env` | `DATABASE_URL`, `MIGRATION_URL`, `JWT_JWKS_URL` | `NTFY_URL` / `NTFY_TOKEN` (reminders), `S3_*` (attachments) |
| `services/coredraw/.env` | `DATABASE_URL`, `MIGRATION_URL`, `JWT_JWKS_URL` | |

`JWT_JWKS_URL` is the gateway's JWKS endpoint as each service reaches it,
such as `http://coregateway-api:8080/.well-known/jwks.json`. A downstream refuses to start if it can't fetch it (ADR-0002), so
start the gateway first. Every variable shared by the services is explained in
[`docs/runbooks/service-env-vars.md`](docs/runbooks/service-env-vars.md).

## Native development

To run the gateway's Go code directly (Go 1.26+):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
cp .env.example .env    # point it at a database; drop sslmode for a local one
make migrate-up
make run                # or `make dev` for live reload (needs air)
```

After editing SQL in `internal/db/queries/`, run `make sqlc`. The web app has
its own instructions in [`web/README.md`](web/README.md). `make help` lists
every target.

## Project Structure

```
coregateway/
├── cmd/coregateway/          # Entry point
│   └── main.go
├── internal/
│   ├── auth/                 # Authentication (register, login, sessions)
│   ├── user/                 # User management (CRUD)
│   ├── monitor/              # Service monitoring (CRUD, health checks, stats)
│   ├── services/             # Downstream clients + streaming proxy (corefinance, coredraw, coreban)
│   ├── token/                # Internal JWT minting (Ed25519) + JWKS
│   ├── server/               # HTTP server, routes, middleware wiring
│   ├── middleware/           # Request ID, slog logging, edge identity, forward headers
│   ├── helper/               # JSON responses, UUID parsing, query helpers
│   ├── logger/               # ENV-based slog setup
│   ├── config/               # Environment variable loading
│   ├── crypto/               # Password hashing (argon2id), session tokens
│   ├── session/              # Cookie management
│   └── db/
│       ├── migrations/       # Goose SQL migrations
│       ├── queries/          # sqlc SQL query files
│       └── sqlc/             # sqlc-generated Go code (DO NOT EDIT)
├── services/
│   ├── corefinance/          # Corefinance microservice (separate repo/deployment)
│   ├── coredraw/             # Coredraw whiteboard microservice (git submodule, own Go module)
│   └── coreban/              # Coreban kanban + reminders downstream service (git submodule, own Go module)
├── proto/                    # Protobuf definitions (buf-managed)
├── compose.yml               # Stack on the .env databases (stack-* targets)
├── compose.local.yml         # Self-contained local stack (local-* targets)
├── coregateway-api.http      # HTTP client file (VS Code REST Client)
└── go.mod
```

## API Endpoints

### Health & System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login (sets session cookie) |
| POST | `/api/auth/logout` | Logout (clears session) |
| POST | `/api/auth/demo` | Login as demo user |
| GET | `/api/auth/me` | Get current user |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user |
| GET | `/api/users/{id}` | Get user by ID |
| PUT | `/api/users/{id}` | Update user |
| DELETE | `/api/users/{id}` | Delete user |

### Services

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/services` | Create service |
| GET | `/api/services/list` | List all services |
| GET | `/api/services/{id}` | Get service |
| PUT | `/api/services/{id}` | Update service |
| DELETE | `/api/services/{id}` | Delete service |

## Architecture

```
Request → chi router
  → RequestID (generates UUID)
  → RequestIDResponseHeader (sets X-Request-ID on response)
  → SlogMiddleware (logs method/path/status/duration)
  → AuthMiddleware (extracts session, loads user into context)
  → CORS
  → Handler → Service → sqlc → PostgreSQL

Budget API flow:
  → EdgeIdentity (mints internal JWT; strips X-User-ID/Cookie)
  → ForwardHeaders (sets Authorization, X-Request-ID on request)
  → httputil.ReverseProxy (streams the body to the downstream api, no buffering)
```

### Key patterns

- **Helper package**: `helper.RespondJSON`, `helper.RespondErrorJSON`, `helper.ParseUUID` for consistent HTTP responses
- **Structured logging**: `slog.Debug/Info/Error` with contextual fields, ENV-based format (text in dev, JSON in prod)
- **Request IDs**: Generated per request via chi, returned in `X-Request-ID` response header, propagated on outbound calls
- **Outbound propagation**: `middleware.PropagateHeaders(req)` sets `X-Request-ID` on downstream HTTP calls (`X-User-ID` is never sent — the edge strips it and mints an internal JWT instead)
- **Streaming proxy**: `httputil.ReverseProxy` streams request/response bodies via `io.Copy` — no memory buffering for large payloads

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://core:core@localhost:5432/core?sslmode=disable` | PostgreSQL connection string |
| `PORT` | `8080` | Server port |
| `ENV` | `development` | `development` (text+debug) or `production` (JSON+info) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `COREFINANCE_URL` | `http://localhost:6969` | Corefinance-api base URL (internal service) |
| `COREDRAW_URL` | `http://localhost:6971` | Coredraw-api base URL (internal service) |
| `COREBAN_URL` | `http://localhost:6972` | Coreban-api base URL (internal service) |
| `JWT_PRIVATE_KEY_FILE` | - | Path to the Ed25519 signing key, PKCS8 PEM (preferred; required unless `JWT_PRIVATE_KEY_PEM` is set) |
| `JWT_PRIVATE_KEY_PEM` | - | Inline signing key, PEM with literal `\n` (fallback; visible via `docker inspect`) |
| `JWT_KID` | - | Signing key ID published in JWKS (required) |
| `JWT_PREV_PRIVATE_KEY_PEM` / `JWT_PREV_KID` | - | Previous key pair, rotation overlap only |
| `JWT_ISSUER` | `https://gateway.internal` | Internal JWT issuer |
| `JWT_AUDIENCE` | `corefinance,coredraw,coreban` | Allow-list of downstreams the gateway may mint for; each token carries exactly one |
| `JWT_TTL_SECONDS` | `300` | Internal JWT lifetime in seconds |

| `ADMIN_EMAIL` | - | Admin user email (for seeding) |
| `ADMIN_PASSWORD` | - | Admin user password (for seeding) |

See `docs/auth-flow.md` and `.env.example` for the full auth picture.

## Development

### Add a new SQL query

1. Edit files in `internal/db/queries/`
2. Run `sqlc generate`
3. Use the generated method in your service

### Add a new domain

1. Create `internal/{domain}/types.go` — request/response DTOs
2. Create `internal/{domain}/service.go` — business logic (`NewService(queries)`)
3. Create `internal/{domain}/handler.go` — HTTP handlers (`NewHandler(service)`)
4. Register routes in `internal/server/routes.go`

### Running tests

```bash
make test             # everything (unit + integration, needs Docker)
make test-unit        # unit only, no Docker needed
make test-integration # Docker-backed integration only (testcontainers)
make test-race        # unit tests with race detector
make check-refs       # verify README/Makefile references
```

Integration tests spin ephemeral Postgres via testcontainers
(`internal/auth/keys_integration_test.go`). Each repo's Makefile covers its
own Go module — corefinance has its own (`services/corefinance/Makefile`)
with the same `test` / `test-unit` / `test-integration` targets. Coredraw is
also its own Go module (`services/coredraw/`); run its suites from that
directory (`go test ./...`), since the root module never crosses the nested
module boundary. Coreban (`services/coreban/`) is likewise its own module,
with `make test` (Docker-backed) and `make test-unit` in that directory.

### Browser e2e (Kanban)

A Playwright suite (`web/e2e/`) drives the dashboard's Kanban section through
the real gateway and coreban. It runs against a disposable stack, never the
databases in `.env`:

```bash
scripts/e2e-up.sh     # throwaway Postgres + ntfy in Docker; gateway, coreban, web run natively
cd web && pnpm e2e    # headless Chromium; report in web/playwright-report/
scripts/e2e-down.sh   # stop it all (logs stay in .e2e/)
```

The stack uses the native-run ports (web `:3001`, gateway `:18080`, coreban
`:16972`), so it can run next to `compose.yml`. It seeds `admin@e2e.local` /
`e2e-admin-pass-123`, and ntfy user `owner` / `ownerpw` can read `coreban-e2e`
to check deliveries by hand. Any console error other than an expected
non-2xx response fails a test, which catches CORS blocks and React warnings.
Slow reminder timing (late, skipped, quiet while Done) stays in coreban's Go
tests, which use an injected clock.

## Downstream Microservices

Coregateway acts as a **Backend-for-Frontend (BFF)** gateway. All traffic flows through it — the edge proxy (nginx/Traefik) only knows about coregateway, never the internal microservices.

```
Browser → Edge Proxy (nginx:3000) → coregateway-api:8080
  ├── /api/auth/*    → coregateway handlers (auth, users, services)
  ├── /api/services/* → coregateway handlers (monitoring)
  ├── /api/budget/*  → ForwardHeaders → httputil.ReverseProxy → corefinance-api:6969
  ├── /api/coredraw/* → ForwardHeaders + key-scope gate (coredraw:read|write) → httputil.ReverseProxy → coredraw-api:6971
  └── /api/coreban/*  → ForwardHeaders + key-scope gate (coreban:read|write) → httputil.ReverseProxy → coreban-api:6972
```

### Current services

| Service | URL | Routes | Description |
|---------|-----|--------|-------------|
| corefinance-api | `http://corefinance-api:6969` | `/api/budget/*` | Budget/finance tracking |
| coredraw-api | `http://coredraw-api:6971` | `/api/coredraw/*` | Whiteboard boards (snapshots + docs) |
| coreban-api | `http://coreban-api:6972` | `/api/coreban/*` | Kanban boards (columns, cards, dues, labels, archive) and one-off/recurring reminders pushed through ntfy — see [services/coreban/README.md](services/coreban/README.md) |

### Adding a new microservice (Runbook)

Full procedure, with the code to copy: **[docs/adding-a-service.md](docs/adding-a-service.md)**.

Every new downstream needs:

1. Submodule at `services/<name>` plus `use ./services/<name>` in `go.work`.
2. A `CORE*_URL` env var (e.g. `COREBAN_URL`) in `internal/config/config.go`, `.env.example`, and `compose.yml`.
3. A proxy client in `internal/services/<name>/` wired into `internal/server/server.go`.
4. A route in `internal/server/routes.go` gated by `EdgeIdentity` + `RequireServiceKeyScope("<name>")`.
5. `<name>` appended to `JWT_AUDIENCE` — the downstream accepts only its own name, not the comma list.
6. A `*_scope_test.go` copy of `coredraw_scope_test.go`.
7. README service/env tables, `docs/auth-flow.md`, `coregateway-api.http`, and the `compose.yml` service block.

### Adding aggregation endpoints

For endpoints that combine data from multiple microservices, create typed HTTP clients instead of using the streaming proxy:

1. Add response types to `internal/{service}/types.go`
2. Add client methods that call multiple endpoints and aggregate
3. Register specific routes in `routes.go` that call these methods instead of the proxy

### Security: Network isolation

In production, internal microservices should only be reachable from coregateway-api. Configure your infrastructure (Docker network policies, Cilium NetworkPolicy, security groups) to block direct access to microservices from outside the gateway.
