# Adding a downstream service to the gateway

Runbook for integrating a new microservice (example: `coreban`) so that
`coregateway-api` proxies, authenticates, and authorizes traffic to it.

Scope: everything **this** repo must change. The service's own verifier code
lives in its repo; cluster manifests live in the infra repo (see
[Production](#production-k3s--flux)).

- [Checklist](#checklist)
- [1. Vendor the service](#1-vendor-the-service)
- [2. Configuration](#2-configuration)
- [3. Proxy client](#3-proxy-client)
- [4. Server wiring](#4-server-wiring)
- [5. Route + auth gates](#5-route--auth-gates)
- [6. Local compose](#6-local-compose)
- [7. Tests](#7-tests)
- [8. Documentation](#8-documentation)
- [9. Verification](#9-verification)
- [Production (k3s + Flux)](#production-k3s--flux)
- [Removing a service](#removing-a-service)

## Checklist

Replace `coreban` / `COREBAN_URL` with the new service name throughout.

| # | File | Change |
|---|------|--------|
| 1 | `.gitmodules`, `go.work` | Submodule at `services/coreban` + `use ./services/coreban` |
| 2 | `internal/config/config.go` | `CorebanURL string` + `getEnv("COREBAN_URL", …)` |
| 3 | `internal/services/coreban/client.go` | Reverse-proxy client (copy `coredraw`) |
| 4 | `internal/server/server.go` | `CorebanClient` field + init in `New()` |
| 5 | `internal/server/routes.go` | `/api/coreban` route with `EdgeIdentity` + `RequireServiceKeyScope("coreban")` |
| 6 | `.env.example`, `.env`, `compose.yml` | `COREBAN_URL`, `JWT_AUDIENCE` gains `coreban` |
| 7 | `compose.yml` | `coreban-api` service block; optional `web.depends_on` |
| 8 | `internal/server/coreban_scope_test.go` | Key-scope gate test (copy `coredraw_scope_test.go`) |
| 9 | `README.md`, `docs/auth-flow.md`, `coregateway-api.http` | Service table, env table, audience list, sample requests |

No code change is needed for API-key scopes: `internal/auth/keys.go:69`
validates `^(admin|[a-z0-9-]+:(read|write|admin))$`, so `coreban:read` and
`coreban:write` are mintable as soon as the route references them.

## 1. Vendor the service

The service must already exist as its own repo with its own Go module.

```sh
git submodule add -b main git@github.com:ejsadiarin/coreban.git services/coreban
git add .gitmodules services/coreban
```

Add it to the workspace so `go build ./...` from the root covers it:

```go
// go.work
use ./services/coreban
```

```sh
go work sync
```

`go.work` references the submodule path, so a clone without
`--recurse-submodules` breaks every `go` command in the repo. Document
`git clone --recurse-submodules` (or `git submodule update --init`) wherever
the onboarding steps live.

## 2. Configuration

`internal/config/config.go`:

```go
type Config struct {
	// …
	CorefinanceURL string
	CoredrawURL    string
	CorebanURL     string // new
}

func Load() *Config {
	return &Config{
		// …
		CoredrawURL: getEnv("COREDRAW_URL", "http://localhost:6971"),
		CorebanURL:  getEnv("COREBAN_URL", "http://localhost:6972"), // pick a free port; coredraw uses 6971
	}
}
```

`Validate()` needs nothing extra: downstream URLs are non-fatal (a dead
downstream yields `502`, not a boot failure), unlike the `JWT_*` identity.

Also update:

- `.env.example` — `COREBAN_URL=http://localhost:6972`
- `.env` (local, gitignored) — same key, pointing at your native port
- `JWT_AUDIENCE` — append `coreban` in **both** files. This is the #1 cause
  of "it proxies but every request 401s": the gateway mints `aud` from this
  list, and the downstream accepts a token only when its own name is a member.

## 3. Proxy client

Copy `internal/services/coredraw/client.go` — it is the current pattern
(`httputil.ReverseProxy` with `Rewrite`, path passed through unchanged):

```go
// internal/services/coreban/client.go
package coreban

type Client struct{ target *url.URL }

func New(baseURL string) *Client { /* parse, panic on bad URL */ }

func (c *Client) Proxy() http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Host = c.target.Host
			r.Out.URL.Scheme = c.target.Scheme
			r.Out.Host = c.target.Host
		},
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("coreban: proxy error", "method", r.Method, "path", r.URL.Path, "error", err)
		http.Error(w, "downstream service unavailable", http.StatusBadGateway)
	}
	return proxy
}
```

The path is forwarded **as-is**, so the downstream must serve the same
`/api/coreban/...` prefix the gateway mounts. If the service uses a different
internal prefix, strip it in `Rewrite` rather than mounting a second alias.

Identity travels exclusively as the minted internal JWT in `Authorization`;
never forward `X-User-ID` (the edge strips it deliberately).

## 4. Server wiring

`internal/server/server.go`:

```go
type Server struct {
	// …
	CoredrawClient  *coredraw.Client
	CorebanClient   *coreban.Client // new
}

func New(…) (*http.Server, error) {
	// …
	s.CoredrawClient = coredraw.New(cfg.CoredrawURL)
	s.CorebanClient = coreban.New(cfg.CorebanURL)
}
```

## 5. Route + auth gates

`internal/server/routes.go` — the route order matters:

```go
r.Route("/api/coreban", func(r chi.Router) {
	r.Use(middleware.EdgeIdentity(s.TokenIssuer, s.KeysService, userExists))
	r.Use(auth.RequireServiceKeyScope("coreban"))
	r.Use(middleware.ForwardHeaders())
	r.Handle("/*", s.CorebanClient.Proxy())
})
```

| Gate | Effect |
|---|---|
| `EdgeIdentity` | authenticates a session **or** `cgw_live_*` key, mints the ≤300s Ed25519 JWT (`sub`, `azp`, `scope`, optional `act_as`), strips `X-User-ID`/`Cookie`. Anything unauthenticated → 401, never proxied. |
| `RequireServiceKeyScope("coreban")` | key-authed callers need `coreban:read` (GET/HEAD) or `coreban:write` (everything else), else 403. `admin` and `coreban:admin` cover both. Session callers pass through to the downstream's own role checks. |
| `ForwardHeaders` | copies the chi request ID into `X-Request-ID` for correlation (`middleware/forward.go`). It does **not** touch identity — `EdgeIdentity` already set `Authorization` and deleted `X-User-ID`/`Cookie`. |

Admin-only sub-trees get their own `r.Route("/admin", …)` with
`middleware.RequireScope("admin")` — see `/api/budget` for the pattern.

## 6. Local compose

Add to `compose.yml`, mirroring `coredraw-api`:

```yaml
  coreban-api:
    build:
      context: ./services/coreban
      dockerfile: Dockerfile.coreban-api
      target: api
    ports:
      # Not needed outside this machine (gateway reaches it by service name).
      - "127.0.0.1:6972:6972"
    env_file:
      - ./services/coreban/.env
    environment:
      - PORT=6972
      - GODEBUG=netdns=go
      # Dev override: reach the gateway by compose service name over plain HTTP.
      - JWT_JWKS_URL=http://coregateway-api:8080/.well-known/jwks.json
    sysctls:
      - net.ipv6.conf.all.disable_ipv6=1
      - net.ipv6.conf.default.disable_ipv6=1
    depends_on:
      coregateway-api:
        condition: service_healthy
```

Plus in `coregateway-api.environment`:

```yaml
      - COREBAN_URL=http://coreban-api:6972
```

and `JWT_AUDIENCE=${JWT_AUDIENCE:-corefinance,coredraw,coreban}`.

Notes:

- `environment` overrides `env_file`, so the service's local `.env` can hold
  native-run values (e.g. `JWT_JWKS_URL=http://localhost:18080/...`) without
  breaking compose.
- `depends_on: service_healthy` on the gateway, not the other way round —
  the gateway boots fail-closed on missing JWT material.
- Add `coreban-api` to `web.depends_on` only if the UI calls it on first paint.

## 7. Tests

Copy `internal/server/coredraw_scope_test.go` to `coreban_scope_test.go` and
retarget it. It asserts the gate end-to-end: write-only key on GET is 403 and
**unproxied**, read-only key on PUT is 403, admin key passes, session passes,
and anonymous is 401. The JWT audience in the test issuer must include the new
service so the minted token matches what the downstream expects.

## 8. Documentation

| File | What to add |
|---|---|
| `README.md` | Row in *Current services*; row in *Environment Variables*; `services/coreban/` in the structure tree |
| `.env.example` | `COREBAN_URL`, updated `JWT_AUDIENCE` |
| `docs/auth-flow.md` | Service in the audience/JWKS diagrams (see *Environment variables* and *What the downstream service checks*) |
| `coregateway-api.http` | Example requests under `/api/coreban` |
| this runbook | Nothing — it stays generic |

## 9. Verification

```sh
go build ./... && go vet ./...
go work sync

# proxy reachable through the gateway (admin scope bypasses service gating)
curl -i -H "Authorization: Bearer $ADMIN_KEY" http://localhost:8080/api/coreban/health

# scope gate: read-only key must 403 on a write
curl -i -X POST -H "Authorization: Bearer $CORE_BAN_READ_KEY" \
  http://localhost:8080/api/coreban/anything

# audience wiring: a token minted without "coreban" must 401 downstream
curl -i -H "Authorization: Bearer $TOKEN_WITHOUT_COREBAN_AUD" \
  http://localhost:6972/api/coreban/health
```

If the third call returns 200, the downstream is not verifying carefully —
its `JWT_AUDIENCE` is probably set to the gateway's comma-separated list
instead of its own name.

## Production (k3s + Flux)

Infra is a separate repo; this repo only produces the gateway image. For a new
downstream, the infra repo (Flux `Kustomization` + `ExternalSecret`) must
provide:

| Where | Value |
|---|---|
| `coregateway-api` Deployment env | `COREBAN_URL=http://coreban-api.<ns>.svc.cluster.local:6972`, `JWT_AUDIENCE=corefinance,coredraw,coreban` |
| `coreban-api` Deployment env | `JWT_ISSUER`, `JWT_AUDIENCE=coreban`, `JWT_JWKS_URL=http://coregateway-api.<ns>.svc.cluster.local:8080/.well-known/jwks.json` |
| NetworkPolicy | `coreban-api` ingress allowed **only** from `coregateway-api` (see `deploy/cilium-networkpolicy.yaml`) |
| Secrets | DB URL and any service keys via `ExternalSecret`/Vault (`deploy/vault-kv-layout.md`); never in the image or compose file |

Do not add a JWT `JWT_AUDIENCE` entry per environment in code — the list is
already env-driven. Nothing in this repo needs to know about namespaces,
ingress, or replicas.

## Removing a service

1. Remove its `r.Route` block and client field/wiring (`routes.go`, `server.go`).
2. Delete `internal/services/<name>/` and its `*_scope_test.go`.
3. Drop `COREBAN_URL` from `config.go`, `.env.example`, `.env`, `compose.yml`.
4. Remove `coreban` from `JWT_AUDIENCE` (gateway) — leave the service's own env
   alone until it is undeployed.
5. `git rm --cached services/coreban`, remove the `.gitmodules` entry, drop the
   `use ./services/coreban` line from `go.work`, `go work sync`.
6. Remove the README/docs rows, then `git submodule deinit -f services/coreban`
   and `rm -rf .git/modules/services/coreban` on existing clones.

Removing the entry from `JWT_AUDIENCE` while the service still runs is safe
but pointless; removing the route first (step 1) is what actually stops
traffic.
