# Runbook: new downstream microservice (e.g. `corereminder` next to `corefinance`)

Copy-paste guide for adding a second downstream service behind the gateway's
internal JWT identity. Reference implementation is `services/corefinance`
(a git submodule). Identity architecture: `openspec/changes/gateway-internal-jwt-identity/proposal.md`,
`design.md`. Rules recap: `docs/runbooks/internal-jwt-identity.md`.

Convention: service name = `<name>` (e.g. `corereminder`), module
`github.com/ejsadiarin/<name>`, schema `<name>`, port e.g. `6970`,
scope prefix e.g. `reminder:`.

## 0. Scaffold

```bash
mkdir -p services/corereminder/{cmd/api,internal/{server,auth,helper,db/{migrations,queries,sqlc},reminder,service},}
cp services/corefinance/sqlc.yaml services/corereminder/sqlc.yaml
cp services/corefinance/.env.example services/corereminder/.env.example  # then edit (see §6)
cp services/corefinance/Dockerfile.* services/corereminder/               # api + worker targets
go mod init github.com/ejsadiarin/corereminder
go get github.com/golang-jwt/jwt/v5 github.com/go-chi/chi/v5 github.com/jackc/pgx/v5 github.com/google/uuid
```

Copy verbatim (only rename the import path): `internal/auth/verifier.go`,
`internal/auth/context.go`, `internal/auth/scope.go`,
`internal/helper/helpers.go` (`RespondJSON`, `RespondErrorJSON`, `ParseUUID`,
`GetUserID`). Copy-then-trim: `internal/server/server.go`,
`internal/server/routes.go`, `cmd/api/main.go`.

## 1. Identity/auth approach (do not invent your own)

- **Gateway-created internal JWT only.** The gateway is the sole signer
  (Ed25519). The service holds public material only (JWKS). No shared
  secrets, no API keys validated downstream, no env bearer tokens.
- **Verification** (`internal/auth/verifier.go`, copied): fetch JWKS at
  startup, cache 5 min (`CacheTTL`), refresh once on unknown `kid`
  (rotation-safe). Validate: EdDSA signature, `iss=https://gateway.internal`,
  `aud=<service-name>`, `exp` required, ±60s leeway
  (`jwt.WithLeeway(60*time.Second)`). **Fail closed**: `NewVerifier` error
  (or JWKS unreachable at boot) → `os.Exit(1)`, never serve degraded.
- **Strip `X-User-ID` on every request** — first line of the middleware,
  before the public-path check:
  ```go
  r.Header.Del("X-User-ID")
  ```
  Never read it, never re-emit it (see §2).
- **Two token shapes, two domains that never cross:**
  | token | claims | context | opens |
  |---|---|---|---|
  | user (browser / human API key) | `sub` = user UUID, `azp` = `session` or `api-key:<id>` | `auth.WithUserID` (+ `WithScopes`) | `/api/*` user routes via `helper.GetUserID` |
  | service (cron / worker / sibling service) | no `sub`, `azp` = service name, `scope` = space-delimited | `auth.WithService` (label + scopes) | `/internal/*` scope-gated routes only |
- **Gate service routes** with `auth.RequireServiceScope("<scope>")`
  (`internal/auth/scope.go`, copied):
  ```go
  r.Route("/internal", func(r chi.Router) {
      r.Use(s.Verifier.Middleware)
      r.Route("/reminders", func(r chi.Router) {
          r.Use(auth.RequireServiceScope("reminder:read"))
          r.Get("/due", s.ServiceHandler.DueReminders)
      })
  })
  ```
  A service token carries no user, so `helper.GetUserID` on it returns 401
  by design; a user token on `/internal/*` fails the scope gate by design.
- **401 vs 403** (exact bodies from the copied code):
  - `401 {"error":"valid internal credentials are required"}` — from the
    verifier middleware (missing/malformed `Authorization`, bad signature,
    wrong `iss`/`aud`, expired beyond leeway, unparsable `sub`) and from
    `helper.GetUserID` when no user is in context (e.g. service token on a
    user route). Identity was never established.
  - `403 {"error":"service credentials required"}` / `{"error":"insufficient scope"}`
    — from `RequireServiceScope`. Identity verified, privilege missing.
    Rule of thumb: 401 = who are you, 403 = you may not.

## 2. Headers contract

Gateway sends on every proxied call:

```http
Authorization: Bearer <internal-JWT>   # minted at the edge per request, TTL 300s
X-Request-ID: <id>                     # propagated end to end
```

Service rules:

1. **Trust**: `Authorization` only. Everything else identity-adjacent is untrusted.
2. **Never trust `X-User-ID`** from the wire — strip it in middleware (§1).
   There is no mismatch-tolerance mode; a second wire identity is the bug.
3. **Never emit `X-User-ID`** either. Propagate identity service→service by
   forwarding the inbound JWT unchanged (`req.Header.Set("Authorization",
   r.Header.Get("Authorization"))`). Go context cannot cross the network;
   the JWT is the network carrier. External SaaS that cannot verify JWTs gets
   no user identity (use a purpose-built integration credential instead).
4. **Request-ID**: keep `requestIDMiddleware` + `slogMiddleware` from
   `services/corefinance/internal/server/routes.go` verbatim — accept
   `X-Request-ID` (fallback `X-Correlation-ID`), generate UUID if absent,
   stash under `middleware.RequestIDKey`, log it on every request.
   Forward it on outbound calls the same way as the JWT.

## 3. Route layout conventions

Mirror `services/corefinance/internal/server/routes.go`:

```go
r := chi.NewRouter()
r.Use(requestIDMiddleware)
r.Use(slogMiddleware)
r.Use(middleware.Recoverer)

r.Get("/", s.HelloWorldHandler)
r.Get("/health", s.healthHandler)       // no auth; pgxpool ping + pool stats
r.Get("/websocket", s.websocketHandler) // only if you need it; otherwise delete

r.Route("/api/<domain>", func(r chi.Router) {
    r.Use(s.Verifier.Middleware)
    r.Get("/priority-groups", ...)      // ONE public path max, see below
    r.Route("/reminders", func(r chi.Router) {
        r.Post("/", h.Create)           // every handler starts helper.GetUserID
        r.Get("/", h.List)
        r.Get("/{id}", h.Get)
        r.Put("/{id}", h.Update)
        r.Delete("/{id}", h.Delete)
    })
})

r.Route("/internal", func(r chi.Router) {
    r.Use(s.Verifier.Middleware)
    r.Route("/reminders", func(r chi.Router) {
        r.Use(auth.RequireServiceScope("reminder:read"))
        r.Get("/due", s.ServiceHandler.DueReminders)
    })
})
```

- `/health`: unauthenticated, same body as corefinance (`status`, pool stats).
- `/api/<domain>/*`: user routes. Every handler resolves identity via
  `helper.GetUserID(w, r)` (context-backed, 401 when absent) and scopes every
  query by that `user_id`:
  ```go
  userID, ok := helper.GetUserID(w, r)
  if !ok { return } // 401 already written
  ```
- `/internal/*`: service routes. No `GetUserID`, no user filter in SQL
  (cross-user reads); authorization is the scope middleware. Keep the
  response shape a plain aggregate (`{"expense_rules":…, "income_rules":…}`
  pattern in `internal/service/handler.go`).
- **Public paths**: keep to one reference-data path only if justified
  (corefinance: `GET /api/budget/priority-groups`, hardcoded need/want/savings,
  no user scope). Register the exact path string in both `routes.go` and
  `main.go`'s `PublicPaths`. Note the gateway edge-gates everything it proxies,
  so downstream-public serves direct callers; anonymous-via-gateway is 401 by
  design (see runbook §"Verified live").

## 4. DB conventions

- **Migrations**: goose, `internal/db/migrations/NNNNN_<name>.sql`, same envelope:
  ```sql
  -- +goose Up
  ALTER TABLE reminders ADD COLUMN IF NOT EXISTS ...;
  -- +goose Down
  ALTER TABLE reminders DROP COLUMN IF EXISTS ...;
  ```
  Use `TIMESTAMPTZ`, never bare `TIMESTAMP` (see §9).
- **sqlc**: same `sqlc.yaml` (engine `postgresql`, queries
  `internal/db/queries`, schema `internal/db/migrations`, package `db`,
  `pgx/v5`, uuid→`uuid.UUID`, numeric→`decimal.Decimal`). After editing
  `internal/db/queries/*.sql`, run `sqlc generate` and commit the regenerated
  `internal/db/sqlc/`.
- **Query scoping**: user queries always filter `WHERE user_id = $N`
  (corefinance pattern, `internal/db/queries/expenses.sql`):
  ```sql
  -- name: GetReminder :one
  SELECT * FROM reminders WHERE id = $1 AND user_id = $2;
  -- name: ListReminders :many
  SELECT * FROM reminders WHERE user_id = @user_id ORDER BY due_at ASC
  LIMIT @page_limit OFFSET @page_offset;
  ```
  Service queries (`internal/db/queries/service.sql`) intentionally carry no
  user filter and live in a separate file:
  ```sql
  -- name: ListDueRemindersAllUsers :many
  SELECT id, user_id, body, due_at FROM reminders
  WHERE is_active = true AND due_at <= now() ORDER BY due_at ASC;
  ```
  Unqualified table names are fine: schema scoping comes from the role, not SQL.
- **Role scoping** (corefinance pattern — do not use `search_path` URL params
  or schema-qualified queries): one-time `internal/db/bootstrap.sql` run as
  owner over the direct endpoint creates `<name>_role`, grants DML on schema
  `<name>`, sets `ALTER ROLE <name>_role SET search_path = <name>`. This is the
  only scoping that survives PgBouncer (the pooler strips `options`).
- **URLs**:
  - `DATABASE_URL` — pooler host, `<name>_role`, no extra params
    (`postgresql://<name>_role:pass@<pooler-host>/coredb?sslmode=require`).
  - `MIGRATION_URL` — direct host, owner role, options form only
    (`...?sslmode=require&channel_binding=require&options=-c%20search_path%3D<name>`).
    Never point goose at the pooler with `options=` — it hangs.
- **pgx pool**: copy `buildPool()` from `services/corefinance/cmd/api/main.go`
  (parse `DATABASE_URL`, MaxConns 20 / MinConns 2, ping, panic on failure).
  No `search_path` handling in code, by design.

## 5. Wiring checklist

- [ ] `internal/server/server.go`: `Server` holds `Verifier *auth.Verifier`;
  `New(port, pool, queries, verifier)` panics on nil verifier:
  ```go
  if verifier == nil { panic("server: auth verifier is required") }
  ```
- [ ] `cmd/api/main.go`: build pool → `db.New(pool)` → `auth.NewVerifier`
  → `server.New(...)`. Env with fail-closed exit:
  ```go
  verifier, err := auth.NewVerifier(auth.Config{
      Issuer:   getenv("JWT_ISSUER", "https://gateway.internal"),
      Audience: getenv("JWT_AUDIENCE", "corereminder"), // YOUR service name
      JWKSURL:  getenv("JWT_JWKS_URL", "https://gateway.internal/.well-known/jwks.json"),
      PublicPaths: []string{ /* exact public path(s), or omit */ },
  })
  if err != nil {
      slog.Error("failed to establish JWT verification", "error", err)
      os.Exit(1)
  }
  ```
  `JWT_ISSUER`/`JWT_AUDIENCE` must match what the gateway mints; `aud` mismatch
  is a silent 401 on every request.
- [ ] `services/corereminder/.env.example` (mirror corefinance's, new values):
  ```bash
  DATABASE_URL=postgresql://corereminder_role:pass@<pooler-host>/coredb?sslmode=require
  MIGRATION_URL=postgresql://neondb_owner:pass@<direct-host>/coredb?sslmode=require&channel_binding=require&options=-c%20search_path%3Dcorereminder
  ENV=development
  PORT=6970
  JWT_ISSUER=https://gateway.internal
  JWT_AUDIENCE=corereminder
  JWT_JWKS_URL=https://gateway.internal/.well-known/jwks.json
  ```
- [ ] Root `compose.yml`: add the service block with the dev JWKS override
  (plain HTTP via compose DNS — the default `https://gateway.internal` is
  unreachable from inside compose):
  ```yaml
  corereminder-api:
    build:
      context: ./services/corereminder
      dockerfile: Dockerfile.corereminder-api
      target: api
    ports:
      - "6970:6970"
    env_file:
      - ./services/corereminder/.env
    environment:
      - PORT=6970
      - GODEBUG=netdns=go
      - JWT_JWKS_URL=http://coregateway-api:8080/.well-known/jwks.json
  ```
- [ ] Gateway proxy config: add `COREREMINDER_URL=http://corereminder-api:6970`
  to the `coregateway-api` block (mirrors `COREFINANCE_URL`) and wire the
  route prefix in the gateway (gateway mints JWTs for all proxied routes;
  no per-service auth code needed).
- [ ] `services/corereminder/<domain>-api.http`: `@jwt=` placeholder + happy
  path + the four identity cases from `budget-api.http` tail (copy, swap
  paths/audience):
  ```http
  ### Spoof attempt: bare X-User-ID, no JWT (expect 401)
  GET {{baseUrl}}/api/reminders/
  X-User-ID: 00000000-0000-0000-0000-000000000000

  ### Service JWT on a user route (expect 401, no user established)
  GET {{baseUrl}}/api/reminders/
  Authorization: Bearer {{service_jwt}}

  ### Service endpoint with service JWT (expect 200)
  GET {{baseUrl}}/internal/reminders/due
  Authorization: Bearer {{service_jwt}}

  ### Service endpoint with user JWT (expect 403, domains do not cross)
  GET {{baseUrl}}/internal/reminders/due
  Authorization: Bearer {{jwt}}
  ```

## 6. Onboarding a service identity (cron/worker calls)

Services never present API keys downstream — they exchange them at the gateway
for a short-lived service JWT, then call `/internal/*` directly (never via the
gateway proxy).

1. **Gateway admin creates an ownerless `api_keys` row** (label = service name,
   scopes = what it may call):
   ```http
   POST {{gateway}}/api/auth/keys
   Content-Type: application/json
   Cookie: session_token={{admin_session}}

   { "label": "corereminder", "scopes": ["finance:read"], "expires_at": "2027-01-01T00:00:00Z" }
   ```
   Response returns the plaintext key once (`cgw_live_…`) — store it as the
   worker's secret, never log it. Human keys and service keys share the
   `coregateway.api_keys` table, distinguished by label/scopes/owner.
2. **Worker exchanges it** (client-credentials, `POST /api/auth/token`):
   ```http
   POST {{gateway}}/api/auth/token
   Content-Type: application/json

   { "api_key": "cgw_live_…" }
   ```
   Response is a service JWT: same envelope, no `sub`, `azp=corereminder`,
   `scope` from the key row, TTL 300s. Cache until near-expiry, re-exchange
   (the worker in `services/corefinance/cmd/worker/main.go` is the pattern
   for where this lives).
3. **Worker calls downstream directly**:
   ```http
   GET http://corefinance-api:6969/internal/recurring/active
   Authorization: Bearer {{service_jwt}}
   ```
   Expect 200. Same token on `/api/budget/expenses/` → 401; a user JWT on
   `/internal/*` → 403 (operator live-check from the identity runbook).

## 7. Testing checklist

Replicate `internal/auth/verifier_test.go`, `internal/auth/scope_test.go`,
`internal/service/handler_test.go` (corefinance `routes_test.go` is only a
placeholder HelloWorld test — write real route tests instead):

- [ ] **Verifier** (in-memory `httptest` JWKS server serving your Ed25519
  `kid`; `signToken` helper with explicit `kid` header): valid user token
  reaches handler with `X-User-ID` stripped even when a spoof header is sent;
  missing/malformed bearer (`""`, `"Bearer"`, `"Bearer "`, `"Token abc"`) →
  401 without reaching handler; wrong key, wrong `iss`, wrong `aud` → 401;
  expiry 30s ago passes (60s leeway), 61s ago → 401; newly published `kid`
  verifies after refresh; service token (no `sub`) passes verification but
  establishes no user; unreachable JWKS → `NewVerifier` errors (fail closed).
- [ ] **Scope** (`scope_test.go` pattern): matching scope → next; wrong scope
  → 403; user identity without service identity → 403; no identity → 403.
- [ ] **Handlers**: user handlers over a stub `db.Querier` embedding the
  generated interface (override only the used method) + context identity via
  `auth.WithUserID`; service handlers (`handler_test.go` pattern) assert 200
  shape on success and 500 on stub error.
- [ ] **`.http` spoof cases** (§5): run all four against the running service
  before opening the gateway route.

## 8. Common pitfalls (from the implementation history)

1. **`TIMESTAMP` vs `TIMESTAMPTZ` for Go-compared expiry.** Bare `TIMESTAMP`
   columns come back without a zone and Go comparisons (`expires_at.Before(now)`,
   `revoked_at` checks) silently misbehave across TZ settings. Use
   `TIMESTAMPTZ` for every time column the service compares (`expires_at`,
   `revoked_at`, `due_at`, `start/end_date` where compared). The gateway
   `api_keys` migration (`002_create_api_keys.sql`) is the reference.
2. **sqlc mock updates when adding queries.** The generated `db.Querier`
   interface grows with every new query, so any hand-written stub querier in
   tests breaks until it embeds `db.Querier` (forward-compatible) rather than
   re-declaring the full interface. Always `go generate`/re-run
   `sqlc generate` and `go build ./...` after touching `queries/*.sql`.
3. **chi static-vs-wildcard route precedence.** Register static segments
   (`/search`, `/check-skipped`, `/skip`, `/occurrences`) **before**
   `/{id}` in the same group — chi matches in registration order and
   `/{id}` swallows `/search` (corefinance `routes.go` expenses/incomes
   groups show the correct order). A "get by id returns 400 on the literal
   `search`" bug is always this.
4. **Typed-nil validator interfaces.** A handler/service constructor taking an
   interface and receiving a typed nil pointer (`var s *RealService; NewHandler(s)`)
   is non-nil at the interface level — nil checks pass, first method call
   panics. `server.New` panics on nil verifier for exactly this reason; do the
   same nil-guard in your constructors during wiring, and prefer failing at
   startup over nil-deref at request time.
5. **testcontainers patterns.** Reuse one container per package (`TestMain`
   + `sync.Once`), wait for readiness (pgx ping loop, not fixed sleep), run
   goose `Up` against the direct URL before tests, and truncate (not drop)
   tables between cases. Never share one `pgxpool` across parallel tests that
   mutate the same rows — acquire per-test connections or serialize.
