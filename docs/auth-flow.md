# Authentication & Internal JWT Identity

How auth works end-to-end in coregateway: sessions and API keys at the
edge, short-lived Ed25519 JWTs between services, and what each `JWT_*`
env var is for.

Related docs:

- `docs/runbooks/internal-jwt-identity.md` — rotation procedure and
  fail-closed posture.
- `docs/runbooks/new-downstream-service.md` — onboarding a new
  downstream service (copy-paste checklist).
- OpenSpec change `gateway-internal-jwt-identity` (archived) — proposal,
  design decisions, specs.

---

## The big picture

There are **two trust zones**:

1. **Outside (clients → gateway).** Browsers use an `HttpOnly`
   `session_token` cookie. Scripts and integrations use long-lived API
   keys (`cgw_live_...`). The gateway is the *only* component that
   validates these credentials.
2. **Inside (gateway → downstream services).** Downstream services
   (today: corefinance) accept exactly one credential: a short-lived JWT
   minted by the gateway and verified against the gateway's JWKS. They
   never see API keys (the edge overwrites `Authorization` with the
   minted token), browser cookies (stripped on the proxy leg), or
   `X-User-ID` (stripped at the edge and again downstream, never read).
   User identity comes only from the verified JWT.

Rule of thumb: **authenticate once at the edge, propagate identity as a
signed token, authorize locally in each service.**

```
browser / script
  │  cookie (session_token)  or  Authorization: Bearer cgw_live_...
  ▼
gateway edge (:8080)
  │  validate credential → mint internal JWT (Ed25519, TTL from JWT_TTL_SECONDS, per request)
  │  Authorization: Bearer <internal-jwt>  (+ X-Request-ID)
  ▼
downstream (corefinance :6969)
   JWKS at boot (fail-closed) → cached 5m, refresh on unknown kid
   → verify iss/aud/sig/exp → add to request context → authorize
```

---

## Flow 1 — Browser session

1. `POST /api/auth/login` with email + password (or `POST /api/auth/demo` for the demo user).
    - On success, the gateway sets the `session_token` cookie (HttpOnly, SameSite=Lax, Secure in prod, 24h / 30d with remember-me).
        - Cookie built by `internal/session/session.go` (`SetCookie`), invoked from `internal/auth/handler.go`.

2. Every request passes through the global `auth.AuthMiddleware`
   (`internal/auth/middleware.go`), which loads the session into the
   request context. It never rejects, it only populates.

3. On `/api/budget/*` routes, `middleware.EdgeIdentity` (`internal/middleware/edge_identity.go`) runs:
   - valid session → mint an internal JWT with `sub` = user ID, `azp` = `session`, and `scope` = `admin` if the user's role is admin (otherwise no scope).
    - no session and no key → `401 {"error":"Authentication required"}`.

4. The reverse proxy forwards the request downstream with
   `Authorization: Bearer <jwt>` and `X-Request-ID`. 
    - Any client-supplied `X-User-ID` is deleted at the edge, so a forged
      header can never ride the proxy. (The transitional
      `JWT_REEMIT_USER_ID` flag was removed once the cutover completed.)
      The downstream verifier strips `X-User-ID` again and never reads it.
    - The `Cookie` header is stripped alongside it — neither cookies nor
      user-ID headers travel downstream; only the minted JWT does
      (plus `X-Request-ID`).

5. corefinance's verifier (`services/corefinance/internal/auth/verifier.go`) - or any downstream service
    - checks the token (see ["What the downstream service checks"](what-the-downstream-service-checks)-), 
    - puts the user ID and scopes into the request context, 
    - and the handler authorizes locally (e.g. `RequireServiceScope` on `/internal/*`, user-scoped SQL queries elsewhere).

**Takeaway**: the cookie authenticates the *browser to the gateway*; the
JWT authenticates the *gateway to the downstream on the user's behalf*.
The downstream never touches the session store.

---

## Flow 2 — API keys (scripts, integrations, services)

API keys live in the gateway database (schema-qualified
`coregateway.api_keys`, migration `002_create_api_keys.sql`). Only a
SHA-256 hash is stored — a leaked database dump yields no usable keys.

**Management** (`internal/auth/keys_handler.go`, admin-only via
`RequireAuth` + `RequireRole(admin)` — no scope check on these routes):

- `POST /api/auth/keys` — create an **owned** key. Body: `{"label":
  "...", "scopes": ["..."], "expires_at": ...}` (`label` required;
  unknown fields such as `name` / `is_service_key` are ignored). The
  owner is always the caller, so this endpoint can only create
  user-owned keys. Returns `201` with the plaintext in the `key` field
  **once** — it is never stored and can never be retrieved again.
- `GET /api/auth/keys` — list metadata: `id`, `key_prefix`, `label`,
  `scopes`, `expires_at`, `created_at`. (`last_used_at` is tracked but
  not returned.) No secrets.
- `DELETE /api/auth/keys/{id}` — revoke (soft delete via `revoked_at`).

There is **no `is_service_key` column or field**. A "service" key is
simply an *ownerless* row (`owner_user_id IS NULL`), provisioned via
`POST /api/auth/keys/service` (same admin guards, same once-only
plaintext response as above). Only ownerless keys are accepted at the
exchange below.

**Use:** send the key as `Authorization: Bearer cgw_live_...` to the
gateway. The edge validates it (`KeysService.ValidateKey`), then mints
an internal JWT carrying `sub` = owner, `azp` = `api-key:<keyID>`,
`scope` = the key's scopes, and proxies as in Flow 1.
Invalid/expired/revoked keys get `401 {"error":"Authentication required"}` —
and so do ownerless (service) keys on this path: they carry no user, so
the proxy leg rejects them and they must use the exchange instead.

Note: the downstream *can* distinguish session- from key-derived
requests — `azp` (`session` vs `api-key:<keyID>`) and `scope`
(role-derived vs key scopes) both arrive in the verified claims. What it
never sees is the raw API key itself.

**Service keys and token exchange** (Pattern B): an ownerless key
represents a *service*, not a user. It calls the public
`POST /api/auth/token` with the key in the JSON body — `{"key":
"cgw_live_..."}` (the `Authorization` header is ignored here) — and gets
back a short-lived service JWT with `azp` = the key's `label`, `scope` =
its scopes, and **no `sub`**. Errors: empty/malformed body →
`400 {"error":"invalid request body"}`; unknown/revoked/expired key →
`401 {"error":"Invalid API key"}`; owned (user) key →
`403 {"error":"Key is not a service key"}`. Service tokens authorize
`/internal/*` endpoints (e.g. `GET /internal/recurring/active`, used for
cross-user background work). Exchanging at the edge keeps raw API keys
off the wire between services.

**Why keys live in the gateway, not in each service:** one place to
issue, scope, rotate, and revoke; downstream services stay stateless
verifiers with no credential database to keep in sync.

---

## Flow 3 — Rotation (no downtime, no redeploys)

`JWT_PREV_PRIVATE_KEY_PEM` / `JWT_PREV_KID` hold the *previous* signing
key. During rotation both keys are published in JWKS
(`/.well-known/jwks.json`); new tokens use the current `kid`, old tokens
still verify until they expire (minutes, given the 300s TTL) or the
prev vars are cleared. Downstream caches JWKS for 5 minutes and refreshes
on unknown `kid`, so a rotation propagates on its own. Note:
`compose.yml` wires only the current-key vars for the gateway —
`JWT_PREV_*` are omitted, so overlap rotation can't be exercised via
compose without editing it.

### k3s deployment

Target state (templates in `deploy/`, applied by the operator; procedure
in `docs/runbooks/vault-rotation.md`):

- PEM material lives in Vault KV v2 (`secret/coregateway/jwt`), synced
  by external-secrets to the `gateway-jwt-keys` Secret and consumed as
  env. Nothing secret is committed or hand-edited.
- A monthly CronJob enforces the 90-day key-age policy and executes both
  rotation phases in one run (phase-1 overlap → poll JWKS → drain wait →
  phase-2 clear with KV version destroy), with gateway restarts via
  Reloader. Incident rotation is a manual Job from the suspended
  `jwt-rotation-manual` template — never a hand Vault write.
- A CiliumNetworkPolicy restricts downstream ingress to the gateway
  identity; the JWT stays the user-delegation layer on top of mesh mTLS.
- Vault itself is snapshotted nightly by the `vault-backup` CronJob.
  Losing Vault stops rotations, not traffic.

---

## The JWT itself

Header: `{"alg":"EdDSA","typ":"JWT","kid":"2026-09-a"}`.
Claims (5 minutes lifetime):

```json
{
  "iss": "https://gateway.internal",
  "aud": "corefinance",
  "sub": "<user-uuid>",   // absent on service tokens
  "azp": "session",       // "session" | "api-key:<keyID>" | service name
  "scope": "admin",       // space-separated; absent if none
  "iat": 1758883200,
  "exp": 1758883500
}
```

### What the downstream service checks

**In order, per request** (`services/corefinance/internal/auth/verifier.go`):

- strip `X-User-ID` unconditionally (before the public-path check, on
  every request including public ones)
- parse Bearer → look up `kid` in the cached key set
  (`keyFor`: cache hit only if the key is known **and** the cache is
  fresher than the TTL; otherwise exactly one JWKS refresh is attempted,
  then the lookup is retried against the new set)
- signature valid
- `iss` matches
- `aud` matches
- not expired (60s leeway for clock skew).
- Anything fails → `401`; valid token without the needed scope → `403`.

### JWKS fetching and failure modes

The verifier fetches the gateway's JWKS at **three distinct moments** -
not just once at boot:

1. **At boot - mandatory, blocking.** `NewVerifier` performs the initial
   fetch before serving traffic. If the gateway's JWKS endpoint is
   unreachable, the downstream **exits instead of starting**
   (`os.Exit(1)` in `cmd/api/main.go`). It never falls back to serving
   unverified.
2. **Lazily after cache expiry - 5-minute TTL.** There is no background
   ticker. On each verification, `keyFor` checks key age; the first
   request after the TTL expires triggers a single refresh fetch. So the
   key set is at most ~5 minutes stale, and steady state costs roughly
   one JWKS fetch per downstream every 5 minutes — not one per proxied
   request. Concurrent refresh-triggering requests are coalesced into one
   in-flight fetch (singleflight), and unknown `kid`s that survive a
   refresh are negatively cached for 30s — so forged kids cost one fetch
   per 30s, not one per request. (Fetch *failures* never write negative
   entries: the next request retries, preserving self-healing.)
3. **On demand - unknown `kid`.** A token signed with an unrecognized
   `kid` (e.g. right after gateway rotation) triggers an immediate
   refresh and a retry against the new key set, instead of a flat
   rejection. This is what lets rotation propagate on its own.

**Failure modes** (this is the part worth internalizing):

| Situation | Behavior |
|---|---|
| JWKS unreachable **at boot** | Process exits. Fail-closed; nothing is ever served unverified. |
| JWKS unreachable post-boot, cache **fresh** (< 5 min) | Almost no effect: no fetch is attempted for known `kid`s, so a brief outage is invisible. Exception: a token with an **unknown** `kid` still triggers a refresh attempt even on a fresh cache — if that fetch fails, the request gets `401`. |
| JWKS unreachable post-boot, cache **stale** (> 5 min) | Refresh fails → request gets `401`. There is **no stale-key fallback**: even a previously-known `kid` is rejected once the cache is stale and the refresh fails. Failed refreshes don't update the cache timestamp, so every subsequent request retries — the service self-heals the moment JWKS recovers. |
| Unknown `kid`, JWKS reachable | Refresh, retry against the new set; still unknown → `401` (likely a forged or mis-issued token). |
| Unknown `kid`, JWKS unreachable | Refresh fails → `401`. |

Why cache instead of fetching per request: per-request fetching would
double every downstream call into two network calls and make *every*
request depend on the gateway's availability — defeating the point of
self-contained JWTs. The cache gives zero extra network calls in normal
operation, bounded 5-minute staleness, and (via the PREV-key overlap)
no window where a valid token fails during rotation.

---

## Environment variables

Reference values (dev defaults from `.env.example`):

```env
JWT_PRIVATE_KEY_PEM=        # PKCS#8 Ed25519 private key, PEM-encoded (required)
JWT_KID=2026-09-a           # key ID published in JWT header + JWKS (required)
JWT_PREV_PRIVATE_KEY_PEM=   # previous private key during rotation (optional)
JWT_PREV_KID=               # previous key ID (optional)
JWT_ISSUER=https://gateway.internal
JWT_AUDIENCE=corefinance
JWT_TTL_SECONDS=300
```

| Variable | Required | Purpose |
|---|---|---|
| `JWT_PRIVATE_KEY_PEM` | yes — gateway refuses to start without it | The signing key. Generates `kid`-stamped signatures; the public half is published via JWKS. Generate with `openssl genpkey -algorithm ed25519`, never commit it. |
| `JWT_KID` | yes (non-empty) | Names *which* key signed a token, so verifiers can pick the right public key and old/new keys coexist during rotation. Date-letter scheme (`2026-09-a`) is convention only — any non-empty value passes, no format check — but it keeps rotations ordered and greppable. |
| `JWT_PREV_PRIVATE_KEY_PEM` / `JWT_PREV_KID` | only during rotation — and asymmetric: `JWT_PREV_KID` is required when `JWT_PREV_PRIVATE_KEY_PEM` is set (startup error otherwise), but `JWT_PREV_KID` alone without the PEM is silently ignored | Overlap window: the old key stays verifiable while the new one signs. Cleared after rotation. |
| `JWT_ISSUER` | no — defaults to `https://gateway.internal` when unset | `iss` claim: the single authorized signer. Rejects tokens minted by anyone else, even if correctly signed by some other key the verifier might know. Same value everywhere *by design* (decision: one issuer; environments are separated by network + secrets, not by issuer string). |
| `JWT_AUDIENCE` | no — defaults to `corefinance` when unset | `aud` claim: *who the token is for*. A token minted for `corefinance` is rejected by `corereminder` and vice versa — this is what stops cross-service token replay. Must equal what the downstream expects. |
| `JWT_TTL_SECONDS` | no — defaults to `300` | Token lifetime. Short enough that a leaked token is nearly useless, long enough to cover any single proxied request with margin. Explicit `<=0` fails startup; a non-numeric value silently falls back to `300`. |

Downstream services need their own side of the handshake (see
`new-downstream-service.md`): `JWT_JWKS_URL` (where to fetch the
gateway's public keys), plus the expected `JWT_ISSUER` /
`JWT_AUDIENCE`. These also have working defaults
(`https://gateway.internal`, `corefinance`,
`https://gateway.internal/.well-known/jwks.json`), so the downstream
refuses to start only when values are empty after fallback or — the
usual case — when the initial JWKS fetch itself fails. Never serves
unverified either way.

---

## Why a PEM private key, not just a signing secret?

"Just a secret" means **HS256**: one symmetric string shared by signer
*and every verifier*, used for both signing and checking.

- **Any verifier can mint.** With HS256, every downstream service holds
  the secret, so a compromised (or merely curious) downstream can forge
  tokens for any user, including admins. With Ed25519 the private key
  exists *only* on the gateway; downstreams hold public keys, which can
  verify but never sign. Forgery requires breaching the gateway itself.
- **Smaller blast radius.** A leaked JWKS/public key is harmless by
  construction — it's published over HTTP anyway. A leaked HS256 secret
  is total compromise of the whole mesh.
- **Standard, interoperable encoding.** PEM-wrapped PKCS#8 is what
  `openssl`, Go, Python, and secret managers all read and write. A raw
  "secret string" has no standard form: hex? base64? which curve? PEM
  answers that, and it works unchanged when a future service is written
  in another language.
- **Rotation-friendly.** Private key stays in one place (gateway env /
  secret store); rotation ships *public* keys over existing JWKS
  plumbing instead of re-distributing a shared secret to N services.

Cost: one env var holding a multi-line PEM instead of a short string.
That is the entire price of removing every downstream's ability to forge
identity.

---

## Why the separate JWT_* fields?

Each field defeats a specific attack or failure mode; none of them is
ceremony:

- **`KID` — "which key?"** Without it, verifiers guess, and rotation
  means synchronized redeploys of signer + all verifiers. With `kid` in
  the header and a multi-key JWKS, rotation is: publish new key →
  switch signer → wait out the TTL → drop the old key. No coordination,
  no downtime.
- **`ISSUER` — "who says so?"** A signature only proves *someone* with
  *some* key signed this. `iss` pins the one authority allowed to speak
  for user identity. If a second signer is ever introduced (or an
  attacker points a verifier at a rogue JWKS), tokens from the wrong
  `iss` are rejected even with valid signatures.
- **`AUDIENCE` — "who is this for?"** Without `aud`, a token legitimately
  minted for service A can be replayed against service B (both verify the
  same gateway signature). `aud` binds each token to one recipient, so
  adding a second downstream never widens the first one's exposure.
- **`TTL` — "how long is a leak dangerous?"** No expiry means a logged,
  cached, or stolen token works forever. 300 seconds bounds the damage
  to minutes, and per-request minting means nothing depends on a token
  living longer.

Together: `kid` selects the key, the signature proves the gateway minted
it, `iss` proves the gateway was *allowed* to mint it, `aud` proves it
was minted *for you*, and `exp` proves it is still *fresh*. Remove any
one and a real attack gets easier — that is why each has its own env
var instead of being hardcoded.
