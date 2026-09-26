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
   (today: corefinance) **never see cookies or API keys**. They accept
   exactly one credential: a short-lived JWT minted by the gateway and
   verified against the gateway's JWKS. They trust no headers from the
   network — `X-User-ID` is stripped and never read.

Rule of thumb: **authenticate once at the edge, propagate identity as a
signed token, authorize locally in each service.**

```
browser / script
  │  cookie (session_token)  or  Authorization: Bearer cgw_live_...
  ▼
gateway edge (:8080)
  │  validate credential → mint internal JWT (Ed25519, TTL 300s, per request)
  │  Authorization: Bearer <internal-jwt>  (+ X-Request-ID)
  ▼
downstream (corefinance :6969)
   fetch JWKS once at boot → verify iss/aud/sig/exp → context → authorize
```

---

## Flow 1 — Browser session

1. `POST /api/auth/login` with email + password (or `POST /api/auth/demo` for the demo user).
    - On success, the gateway sets the `session_token` cookie (HttpOnly, SameSite=Lax, Secure in prod, 24h / 30d with remember-me).
        - Implemented in `internal/auth/handler.go`.

2. Every request passes through the global `auth.AuthMiddleware`
   (`internal/auth/middleware.go`), which loads the session into the
   request context. It never rejects, it only populates.

3. On `/api/budget/*` routes, `middleware.EdgeIdentity` (`internal/middleware/edge_identity.go`) runs:
   - valid session → mint an internal JWT with `sub` = user ID, `azp` = `session`, and `scope` = `admin` if the user's role is admin (otherwise no scope).
   - no session and no key → `401 {"error":"authentication required"}`.

4. The reverse proxy forwards the request downstream with
   `Authorization: Bearer <jwt>` and `X-Request-ID`. 
    - Any client-supplied `X-User-ID` is deleted first — a forged header can never reach a downstream service.

5. corefinance's verifier (`services/corefinance/internal/auth/verifier.go`) - or any downstream service
    - checks the token (see ["What the downstream service checks"](what-the-downstream-service-checks)-), 
    - puts the user ID and scopes into the request context, 
    - and the handler authorizes locally (e.g. `RequireServiceScope` on `/internal/*`, user-scoped SQL queries elsewhere).

**Takeaway**: the cookie authenticates the *browser to the gateway*; the
JWT authenticates the *gateway to the downstream on the user's behalf*.
The downstream never touches the session store.

---

## Flow 2 — API keys (scripts, integrations, services)

API keys live in the gateway database (`api_keys` table, migration
`002_create_api_keys.sql`). Only a SHA-256 hash is stored — a leaked
database dump yields no usable keys.

**Management** (`internal/auth/keys_handler.go`, admin-only, session auth
+ `RequireRole(admin)` + `RequireScope(admin)`):

- `POST /api/auth/keys` — create a key. Body: `{"name": "...",
  "scopes": ["..."], "is_service_key": true/false, "expires_at": ...}`.
  Returns the plaintext **once** (`cgw_live_<random>`). It is never
  stored and can never be retrieved again.
- `GET /api/auth/keys` — list metadata (prefix, name, scopes, usage,
  expiry). No secrets.
- `DELETE /api/auth/keys/{id}` — revoke (soft delete).

**Use:** send the key as `Authorization: Bearer cgw_live_...` to the
gateway. The edge validates it (`KeysService.ValidateKey`), then mints
an internal JWT carrying `sub` = owner, `azp` = `key`, `scope` = the
key's scopes, and proxies as in Flow 1. Invalid/expired/revoked keys get
`401`; the downstream sees no difference between session- and
key-derived requests.

**Service keys and token exchange** (Pattern B): a key created with
`is_service_key: true` represents a *service*, not a user. Such a key
can call `POST /api/auth/token` to exchange itself for a short-lived
service JWT with `azp` + `scope` and **no `sub`**. Owned (user) keys are
rejected with `403`. Service tokens authorize `/internal/*` endpoints
(e.g. `GET /internal/recurring/active`, used for cross-user background
work). Exchanging at the edge keeps raw API keys off the wire between
services.

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
on unknown `kid`, so a rotation propagates on its own.

---

## The JWT itself

Header: `{"alg":"EdDSA","typ":"JWT","kid":"2026-09-a"}`.
Claims (5 minutes lifetime):

```json
{
  "iss": "https://gateway.internal",
  "aud": "corefinance",
  "sub": "<user-uuid>",   // absent on service tokens
  "azp": "session",       // "session" | "key" | service name
  "scope": "admin",       // space-separated; absent if none
  "iat": 1758883200,
  "exp": 1758883500
}
```

### What the downstream service checks

> [!NOTE]
> On downstream service boot/start up, it gets the `/.well-known/jwks.json` from the gateway and caches it
> 5m cache TTL --> once expired, downstream service gets this JWKS token again 
> If unknown `kid` --> means verifier doesn't know who signed this token, then get JWKS token again

**in order:**
- path is not public --> strip `X-User-ID` 
- parse Bearer --> `kid` known (refresh JWKS if not)
- signature valid 
- `iss` matches 
- `aud` matches 
- not expired (60s leeway for clock skew). 
- Anything fails → `401`; valid token without the needed scope → `403`.

The downstream also **fails closed at boot**: if JWKS is unreachable it exits instead of serving unauthenticated.

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
| `JWT_KID` | yes (non-empty) | Names *which* key signed a token, so verifiers can pick the right public key and old/new keys coexist during rotation. Date-letter scheme (`2026-09-a`) keeps rotations ordered and greppable. |
| `JWT_PREV_PRIVATE_KEY_PEM` / `JWT_PREV_KID` | only during rotation | Overlap window: the old key stays verifiable while the new one signs. Cleared after rotation. |
| `JWT_ISSUER` | yes | `iss` claim: the single authorized signer. Rejects tokens minted by anyone else, even if correctly signed by some other key the verifier might know. Same value everywhere *by design* (decision: one issuer; environments are separated by network + secrets, not by issuer string). |
| `JWT_AUDIENCE` | yes | `aud` claim: *who the token is for*. A token minted for `corefinance` is rejected by `corereminder` and vice versa — this is what stops cross-service token replay. Must equal what the downstream expects. |
| `JWT_TTL_SECONDS` | yes | Token lifetime (300s). Short enough that a leaked token is nearly useless, long enough to cover any single proxied request with margin. |

Downstream services need their own side of the handshake (see
`new-downstream-service.md`): `JWT_JWKS_URL` (where to fetch the
gateway's public keys), plus the expected `JWT_ISSUER` /
`JWT_AUDIENCE`. Missing key material anywhere → refuse to start, never
serve unverified.

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
