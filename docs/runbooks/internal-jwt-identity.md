# Runbook: internal JWT identity (`gateway-internal-jwt-identity`)

## The rule for future services (6.5)

Authenticate once at the edge, propagate signed identity internally,
authorize locally:

1. **Never accept `X-User-ID` from the wire.** It is not identity, only a
   spoofable hint. Every service strips it in its verification middleware.
2. **Never emit `X-User-ID` either.** Propagate identity by forwarding the
   inbound JWT unchanged (`Authorization: Bearer`). Go request context
   cannot cross the network — the JWT in the header is the network-level
   carrier.
3. **Verify locally.** Fetch the gateway JWKS, cache 5–10 min, refresh on
   unknown `kid`. Check signature, `iss`, `aud`, `exp` (±60s leeway).
   Fail closed when the JWKS is unreachable at startup.
4. **Service-originated calls use service tokens**, not user tokens: hold an
   ownerless `api_keys` row, trade it at `POST /api/auth/token`, call
   scope-gated `/internal/*` endpoints directly (never via the gateway).
   A service token opens no user-scoped route, and a user token opens no
   service route.
5. **The gateway holds all credential material** (users, sessions,
   `api_keys`). Downstream services hold public keys only.

## Trust values (all environments)

- `iss`: `https://gateway.internal`
- `aud`: downstream service name (`corefinance`, …)
- JWKS: `https://gateway.internal/.well-known/jwks.json` (override per
  environment, e.g. compose dev uses
  `http://coregateway-api:8080/.well-known/jwks.json`)
- TTL 300s. Signing key from env in every environment including dev —
  the gateway refuses to start without it.

## Key rotation

1. Generate: `openssl genpkey -algorithm ed25519 -out jwt_ed25519.pem`
2. Put the NEW key in `JWT_PRIVATE_KEY_PEM`/`JWT_KID`; move the OLD key to
   `JWT_PREV_PRIVATE_KEY_PEM`/`JWT_PREV_KID`.
3. Redeploy the gateway. JWKS publishes both keys; new tokens carry the
   new `kid`; old tokens verify until expiry.
4. After max TTL + JWKS cache window (≥15 min to be safe), remove the
   `PREV` pair and redeploy.

## Rollback

- Gateway: the legacy `X-User-ID` re-emit path was removed
  (`auth-hardening-vault-k3s`); rollback is reverting the commit(s) — no
  flag exists anymore.
- Migration: `make migrate-down` drops `coregateway.api_keys`.
- **Warning: rolling back re-opens header trust.** Any downstream still
  accepting `X-User-ID` becomes spoofable again. Treat rollback as a
  temporary bridge, not a resting state.

## Verified live (2026-09-24, local binaries against dev DBs)

- `GET /.well-known/jwks.json` serves the signing key.
- Register → login → cookie → `GET /api/budget/remaining` returns real
  budget data through the full chain (session → JWT → verify → proxy).
- No credentials via gateway → 401, never proxied.
- Direct `:6969` with `X-User-ID` (spoof) → 401; anonymous → 401.
- Direct `:6969` `/api/budget/priority-groups` → 200 (public preserved).
- Corefinance fail-closed at boot when the gateway/JWKS is unreachable.
- Intentional: the gateway edge-gates even downstream-public paths
  (anonymous `/api/budget/priority-groups` via gateway → 401). The edge
  authenticates everything it proxies; downstream-public exists for
  direct callers. No anonymous gateway use case exists today.

## Still to do by operator

- **Neon `MIGRATION_URL` targets the pooler host** with `options=` +
  `channel_binding=require`, which hangs goose. Point it at the direct
  host per the Makefile docs, then run `make migrate-up` (migration
  `002_create_api_keys.sql`). Key/exchange flows are integration-tested
  but have not run against Neon yet.
- **Rotate `neondb_owner`** — the password appeared in plaintext in a
  tool traceback during this implementation.
- Key-flow live check post-migration: as admin, `POST /api/auth/keys`
  → exchange at `POST /api/auth/token` → service JWT → direct
  `GET :6969/internal/recurring/active` (200), same token on
  `/api/budget/expenses/` (401), user JWT on `/internal/*` (403).

## Accepted posture

- Corefinance `/`, `/health`, `/websocket` intentionally sit outside the
  JWT verifier (pre-existing unauthenticated posture, out of scope for
  this change).
- `/api/budget/priority-groups` intentionally stays public via the
  verifier's `PublicPaths` bypass (reference data, no user scope).
- Everything else under `/api/budget`, and everything under `/internal`,
  requires a gateway-minted JWT; scoped routes additionally enforce
  scope (`RequireScope("admin")` at the gateway edge,
  `RequireServiceScope` downstream).
