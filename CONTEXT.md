# coregateway

An API gateway and auth boundary for a homelab: it authenticates clients once, then proxies requests to internal downstream services with a short-lived signed identity.

## Language

### Trust zones

**Gateway**:
The coregateway application itself — the only component that validates client credentials.
_Avoid_: edge, backend, API, coregateway-api

**Edge proxy**:
The reverse proxy in front of the gateway that terminates public traffic.
_Avoid_: edge, gateway, ingress

**Client**:
A browser or script that calls the gateway.
_Avoid_: user, consumer, caller

**Credential**:
What a client presents to the gateway to prove who it is: either a session or an API key.
_Avoid_: token, auth, login

**Trust zone**:
One side of the authentication boundary — outside (clients to gateway) or inside (gateway to downstream services).
_Avoid_: network, perimeter, segment

### Identity and credentials

**Session**:
A browser's authenticated state at the gateway, backed by a stored session record and carried in an HttpOnly cookie.
_Avoid_: login, cookie, token, JWT

**API key**:
A long-lived, user-owned credential for scripts and integrations, with a visible prefix and a stored hash.
_Avoid_: token, secret, service key

**Internal token**:
The short-lived signed token the gateway mints per proxied request to assert the caller's identity to one downstream service.
_Avoid_: JWT, auth token, session token, bearer token

**Minted identity**:
The user identity asserted by an internal token, as opposed to any identity a client claims.
_Avoid_: forwarded identity, user header, impersonation

**Downstream service**:
An internal service the gateway proxies to on a client's behalf.
_Avoid_: microservice, service, backend, upstream

### Authorization

**Role**:
A user's standing at the gateway — guest, user, or admin — which determines the scope the gateway grants in an internal token.
_Avoid_: permission, group, access level

**Scope**:
A capability string carried by an API key or an internal token, either `admin` or `<downstream>:read|write|admin`.
_Avoid_: permission, role, permission level

**Scope cover**:
Whether a key's scopes satisfy a route's requirement — `admin` covers everything, `<downstream>:admin` covers that downstream's read and write, otherwise the scope must match exactly.
_Avoid_: scope check, authorization

### People

**User**:
An account registered at the gateway.
_Avoid_: account, member, principal

**Timezone**:
A user's IANA zone (e.g. Asia/Manila), stored at the gateway and asserted in each internal token for the user the request is about; UTC until the user sets one.
_Avoid_: locale, offset, tz setting

**Caller**:
The user a request is authenticated as, whether by session or by API key ownership.
_Avoid_: requester, actor, client

**Target user**:
The user a targeted read is about, when it is not the caller.
_Avoid_: acting user, impersonated user, subject

**Targeted read**:
An admin read of another user's data. The gateway validates the target at the boundary and marks the request as acting for that user; writes are always bound to the caller.
_Avoid_: impersonation, on-behalf-of, sudo

### Monitoring

**Monitored service**:
A dashboard record describing an external endpoint the gateway probes and reports on.
_Avoid_: service, downstream, target, endpoint

**Health check**:
One probe of a monitored service: whether it answered as expected, how fast, and with what status code. Only the latest one is kept; there is no history and no uptime figure.
_Avoid_: ping, uptime check, probe

**Service status**:
What the dashboard says about a monitored service: **online** (its latest health check passed), **offline** (its latest health check failed), **degraded** (a built-in service whose real requests failed recently, or whose health check was slow), **unknown** (not checked since the gateway started), or **paused** (not being checked). Offline outranks degraded.
_Avoid_: uptime, health, state

**Built-in service**:
A monitored service the gateway creates from its own config for a downstream it proxies to. It follows the configured URL and can be paused or tuned, but not deleted or repointed.
_Avoid_: internal service, default service

### Backups

**Backup**:
A point-in-time copy of the shared database — every service's data, not only the gateway's — kept on the homelab, outside the database host. It guards against losing the host or a mistake older than the host's own restore window. Attachment files are not part of it. A backup is either **nightly** (on the schedule) or **manual** (an admin asked for one now); both count toward the same retention, and only one runs at a time.
_Avoid_: snapshot, dump, export, branch

**Retention**:
How many of the most recent successful backups are kept: three. The oldest is removed only after a newer backup succeeds, so failed nights never shrink what is kept.
_Avoid_: backup window, expiry, TTL

**Last failure**:
The most recent backup that failed, nightly or manual, with when and why; shown to admins until a backup next succeeds. A skipped nightly (one already taken that day, or another backup running) is not a failure.
_Avoid_: error log, alert, incident

### Exports

**Export**:
A user's own data written out as one versioned JSON file they can keep or import again, made of one or more parts. With its photos and videos it is a zip of that file and the media files beside it; the JSON inside is the same. Unlike a backup, it belongs to one user, is asked for by that user, and leaves out device and credential data.
_Avoid_: backup, dump, snapshot, download

**Part**:
The slice of an export one service owns (budget, kanban, draw, or the export-only account part), with its own format and version, valid as a file on its own and imported on its own.
_Avoid_: section, module, service export

**Import**:
Loading an export's chosen parts into the caller's own data, into any account. A part from the caller's own data keeps each record's id; a part from another account is copied under ids derived for the caller, with its links kept. Either way, what the caller already has is skipped, so importing the same file twice changes nothing.
_Avoid_: restore, upload, merge, sync
