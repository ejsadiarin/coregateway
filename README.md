# CoreGateway

API gateway and service monitor for a homelab dashboard. Built with Go, chi, pgx, and sqlc.

## Prerequisites

- Go 1.26+
- PostgreSQL 13+

## Setup

### 1. Install CLI tools

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
```

### 2. Configure environment

Create a `.env` file:

```bash
DATABASE_URL=postgresql://core:core@localhost:5432/core?sslmode=disable
PORT=8080
ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Run migrations

```bash
goose -dir internal/db/migrations postgres "$DATABASE_URL" up
```

### 4. Generate code

```bash
sqlc generate
```

### 5. Build and run

```bash
go build -o coregateway ./cmd/coregateway
./coregateway
```

Or:

```bash
go run ./cmd/coregateway
```

## Project Structure

```
coregateway/
├── cmd/coregateway/          # Entry point
│   └── main.go
├── internal/
│   ├── auth/                 # Authentication (register, login, sessions)
│   ├── user/                 # User management (CRUD)
│   ├── monitor/              # Service monitoring (CRUD, health checks, stats)
│   ├── services/             # Downstream clients + streaming proxy (corefinance)
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
│   └── corefinance/          # Corefinance microservice (separate repo/deployment)
├── proto/                    # Protobuf definitions (buf-managed)
├── compose.yml               # Docker Compose for local development
├── coregateway-api.http      # HTTP client file (VS Code REST Client)
└── go.mod
```

## API Endpoints

### Health & System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/system/stats` | System stats (mock) |
| GET | `/api/legacy/services` | Legacy services (mock) |
| GET | `/swagger/*` | Swagger UI |

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
| GET | `/api/services/{id}/history` | Health check history |
| GET | `/api/services/{id}/stats` | Uptime stats (24h/7d/30d) |
| GET | `/api/services/stats/all` | Overall stats |

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
  → httputil.ReverseProxy (streams body to corefinance-api, no buffering)
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
| `FRONTEND_URL` | - | Frontend URL for CORS |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `COREFINANCE_URL` | `http://localhost:6969` | Corefinance-api base URL (internal service) |
| `JWT_PRIVATE_KEY_PEM` | - | Gateway Ed25519 signing key, PEM (required) |
| `JWT_KID` | - | Signing key ID published in JWKS (required) |
| `JWT_PREV_PRIVATE_KEY_PEM` / `JWT_PREV_KID` | - | Previous key pair, rotation overlap only |
| `JWT_ISSUER` | `https://gateway.internal` | Internal JWT issuer |
| `JWT_AUDIENCE` | `corefinance` | Internal JWT audience |
| `JWT_TTL_SECONDS` | `300` | Internal JWT lifetime in seconds |

See `docs/auth-flow.md` and `.env.example` for the full auth picture.
| `ADMIN_EMAIL` | - | Admin user email (for seeding) |
| `ADMIN_PASSWORD` | - | Admin user password (for seeding) |

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
with the same `test` / `test-unit` / `test-integration` targets.

## Downstream Microservices

Coregateway acts as a **Backend-for-Frontend (BFF)** gateway. All traffic flows through it — the edge proxy (nginx/Traefik) only knows about coregateway, never the internal microservices.

```
Browser → Edge Proxy (nginx:3000) → coregateway-api:8080
  ├── /api/auth/*    → coregateway handlers (auth, users, services)
  ├── /api/services/* → coregateway handlers (monitoring)
  └── /api/budget/*  → ForwardHeaders → httputil.ReverseProxy → corefinance-api:6969
```

### Current services

| Service | URL | Routes | Description |
|---------|-----|--------|-------------|
| corefinance-api | `http://corefinance-api:6969` | `/api/budget/*` | Budget/finance tracking |

### Adding a new microservice (Runbook)

To integrate a new downstream service (e.g. `coreinventory-api`):

**1. Create the client package**

```bash
mkdir -p internal/coreinventory
```

Create `client.go` inside it:
```go
package coreinventory

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

type Client struct {
	target     *url.URL
	httpClient *http.Client
}

func New(baseURL string) *Client {
	target, err := url.Parse(baseURL)
	if err != nil {
		slog.Error("coreinventory: invalid base URL", "url", baseURL, "error", err)
		panic("coreinventory: invalid COREINVENTORY_URL")
	}
	return &Client{
		target:     target,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Proxy() http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(c.target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = c.target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("coreinventory: proxy error", "method", r.Method, "path", r.URL.Path, "error", err)
		http.Error(w, "downstream service unavailable", http.StatusBadGateway)
	}
	return proxy
}
```

**2. Add config field**

In `internal/config/config.go`, add `CoreinventoryURL string` to `Config` struct and read from `COREINVENTORY_URL` env var.

**3. Wire into server**

In `internal/server/server.go`, add `CoreinventoryClient *coreinventory.Client` to `Server` struct and initialize in `New()`.

**4. Mount the route**

In `internal/server/routes.go`:
```go
// inventory — streamed to coreinventory-api
r.Route("/api/inventory", func(r chi.Router) {
    r.Use(middleware.ForwardHeaders)
    r.Handle("/*", s.CoreinventoryClient.Proxy())
})
```

**5. Add to compose.yml**

```yaml
coreinventory-api:
  build:
    context: ./services/coreinventory
    dockerfile: Dockerfile
  ports:
    - "7070:7070"
  environment:
    - PORT=7070
    - ENV=development
    - DATABASE_URL=...
```

Add `COREINVENTORY_URL=http://coreinventory-api:7070` to coregateway-api environment.
Add `coreinventory-api` to web service's `depends_on`.

**6. Update README.md**

Add the service to the "Current services" table.

### Adding aggregation endpoints

For endpoints that combine data from multiple microservices, create typed HTTP clients instead of using the streaming proxy:

1. Add response types to `internal/{service}/types.go`
2. Add client methods that call multiple endpoints and aggregate
3. Register specific routes in `routes.go` that call these methods instead of the proxy

### Security: Network isolation

In production, internal microservices should only be reachable from coregateway-api. Configure your infrastructure (Docker network policies, Cilium NetworkPolicy, security groups) to block direct access to microservices from outside the gateway.
