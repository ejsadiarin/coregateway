# 01: Backend scaffold with boards CRUD

**What to build:** A standalone Go API for coredraw that I can run locally: it verifies gateway-minted identity (failing closed without the gateway), stores boards (snapshot + doc + revision, user-scoped) in a new schema via migrations, and exposes the full boards contract — list, create, fetch, revision-guarded save, rename, delete — proven with a request collection including the identity spoof cases.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Service boots only when the gateway JWKS is reachable; every board query is scoped to the calling user
- [x] Full boards contract works against the local service: list, create, fetch (snapshot + doc + revision), save with revision guard (stale write rejected), rename, delete
- [x] Verifier test vectors pass (valid/spoof/malformed/expired/wrong-issuer/wrong-audience, rotation refresh, fail-closed boot) and handler tests cover scoping plus the revision-conflict path
- [x] Request collection covers happy paths plus bare user-ID header and garbled-token cases
