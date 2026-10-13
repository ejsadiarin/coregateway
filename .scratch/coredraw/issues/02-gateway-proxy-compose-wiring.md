# 02: Gateway proxy and compose wiring

**What to build:** The boards API becomes reachable through the gateway exactly like the existing downstream service: login session in the browser (or a scoped API key for scripts) flows through the edge, which mints identity and proxies to coredraw — with the token audience extended, per-service key scopes enforced, and compose ordering the boot behind the gateway healthcheck.

**Blocked by:** 01 (Backend scaffold with boards CRUD).

**Status:** done

- [x] Authenticated browser session can list and save boards through the gateway; unauthenticated calls get 401 and never reach the service
- [x] Read-scoped keys read but cannot write; uncovered keys are rejected at the edge; sessions pass through to downstream checks
- [x] Compose brings up gateway then coredraw in order, and a fresh boot serves traffic without manual steps
