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
One probe of a monitored service, recorded with its status, response time, and status code.
_Avoid_: ping, uptime check, probe
