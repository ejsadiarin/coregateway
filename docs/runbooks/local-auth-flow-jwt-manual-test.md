# Runbook: local manual test — auth flow + JWT (compose)

End-to-end drill from key generation to browser login, service keys, and
a rotation overlap — all against `compose.yml`. Concept reference:
`docs/auth-flow.md`.

## Secrets handling (read first)

The PEM lives as a **file only for ~10 seconds** (between `openssl` and
hand-off). Everywhere else it is a **string value with real newlines**:

- **Shell export (recommended locally):**
  `export JWT_PRIVATE_KEY_PEM="$(cat key.pem)"` — command substitution
  preserves newlines, compose interpolates the env var verbatim, Go
  parses it. No quoting pitfalls.
- **Root `.env`:** possible (double-quoted literal multiline), but
  fragile — one broken newline or an accidental commit and nothing
  parses. Prefer export.
- **Vault KV v2 (k3s target):** also a string value —
  `vault kv put secret/coregateway/jwt private_pem="$(cat key.pem)" …`.
  JSON escaping is transparent; what comes back out is byte-identical.
  ESO → K8s Secret → env preserves it end to end (K8s base64 is just
  transport encoding, decoded on injection).
- **Never:** single-line with literal `\n` text (Go sees backslash-n,
  not newlines — parse fails), and never commit any of it.

## 0. Prereqs

```bash
# Gateway does NOT auto-migrate on boot — DB must already be migrated:
make migrate-status   # expect 002_create_api_keys applied; else: make migrate-up
# If migrate-status hangs/fails from a bare shell, the MIGRATION_URL in
# .env likely points at the -pooler host (poolers reject the
# options=search_path param): retry against the direct host per the
# Makefile's own comment, or run via `make` targets which handle quoting.
```

Root `.env` supplies `DATABASE_URL`; `services/corefinance/.env` exists.
Leave both alone.

## 1. Generate the signing key

```bash
openssl genpkey -algorithm ed25519 -out /tmp/jwt-current.pem
export JWT_KID="local-a"
export JWT_PRIVATE_KEY_PEM="$(cat /tmp/jwt-current.pem)"
# admin seed for the key-provisioning tests (skip if you only want demo login):
export ADMIN_EMAIL="admin@example.com" ADMIN_PASSWORD="change-me-123"
# The gateway seeds this admin on boot (idempotent; existing rows are
# left alone). Caveat on the shared dev DB: admin@example.com already
# exists with an unknown password, so the seed skips it — if login 401s,
# register a fresh admin instead and promote it:
#   curl -s -X POST localhost:8080/api/auth/register -H 'Content-Type: application/json' \
#     -d '{"email":"you@example.com","password":"..."}'
# then: update coregateway.users set role='admin' where email='you@example.com';
# and use that email below.
```

## 2. Boot — gateway first, then the rest

```bash
docker compose up -d --build coregateway-api
docker compose logs -f coregateway-api   # wait for listening on :8080, no JWT errors
docker compose up -d --build
```

Staged because corefinance fail-closes at boot when JWKS is unreachable.
If `corefinance-api` crashes with a JWKS error, re-run
`docker compose up -d corefinance-api` once the gateway is up.

Negative test (optional): `unset JWT_PRIVATE_KEY_PEM` and boot — the
gateway must refuse to start. That is fail-closed working. Always
`--build` for this: a stale pre-fail-closed image boots happily with an
empty key.

## 3. Sanity endpoints

```bash
curl -s localhost:8080/health
curl -s localhost:8080/.well-known/jwks.json | jq '.keys[].kid'   # expect: "local-a"
```

## 4. Browser login

Open `http://localhost:3000` → log in as `admin@example.com` (or the
demo button — demo needs no password). Then:

- DevTools → Application → Cookies → `session_token` present (HttpOnly).
- Open the budget view → numbers load (`GET /api/budget/remaining`
  through the full chain: cookie → edge mint → proxy → JWKS verify).
- Log out → budget calls go `401`.

## 5. Identity layer via curl (cookie jar)

```bash
cj=$(mktemp)
curl -s -c $cj -X POST localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me-123"}' > /dev/null

curl -s -b $cj localhost:8080/api/auth/me | jq .email
curl -s -b $cj localhost:8080/api/budget/remaining | head -c 200; echo

curl -s localhost:8080/api/budget/remaining            # 401 {"error":"Authentication required"}
curl -s -b $cj localhost:8080/api/budget/remaining \
  -H 'X-User-ID: 00000000-0000-0000-0000-000000000000' | head -c 120
# still your data — forged header stripped at edge AND downstream
```

## 6. Service keys end-to-end (Pattern B)

```bash
key=$(curl -s -b $cj -X POST localhost:8080/api/auth/keys/service \
  -H 'Content-Type: application/json' \
  -d '{"label":"manual-test","scopes":["finance:read"]}' | jq -r .key)
# cgw_live_... — shown once, never again. Scopes matter: /internal/*
# requires finance:read, so provision with it (empty scopes → 403 there).

curl -s localhost:8080/api/budget/remaining -H "Authorization: Bearer $key"  # 401 (no user — correct)

svc=$(curl -s -X POST localhost:8080/api/auth/token \
  -H 'Content-Type: application/json' -d "{\"key\":\"$key\"}" | jq -r .token)

# service JWT straight at the downstream, bypassing the gateway:
curl -s localhost:6969/internal/recurring/active -H "Authorization: Bearer $svc" | head -c 200
# no sub, azp = label, scope-gated, verified off cached JWKS
```

## 7. Rotation drill (overlap, then cut)

```bash
export JWT_PREV_PRIVATE_KEY_PEM="$JWT_PRIVATE_KEY_PEM" JWT_PREV_KID="$JWT_KID"
openssl genpkey -algorithm ed25519 -out /tmp/jwt-new.pem
export JWT_PRIVATE_KEY_PEM="$(cat /tmp/jwt-new.pem)" JWT_KID="local-b"
docker compose up -d coregateway-api
curl -s localhost:8080/.well-known/jwks.json | jq '.keys[].kid'   # "local-a" + "local-b"

# old session still works mid-overlap (repeat a step-5 call with $cj) → 200

unset JWT_PREV_PRIVATE_KEY_PEM JWT_PREV_KID
docker compose up -d coregateway-api
curl -s localhost:8080/.well-known/jwks.json | jq '.keys[].kid'   # only "local-b"
```

## 8. Tear down secrets

```bash
shred -u /tmp/jwt-current.pem /tmp/jwt-new.pem; rm -f $cj
unset JWT_PRIVATE_KEY_PEM JWT_PREV_PRIVATE_KEY_PEM JWT_KID JWT_PREV_KID ADMIN_EMAIL ADMIN_PASSWORD
docker compose down
```

Out of scope locally: the CronJob chain (needs Vault/ESO/Reloader) and
multi-replica JWKS flap (needs k3s). Everything above covers what the
`auth-hardening-vault-k3s` change shipped.
