# Downstream services fail closed when the gateway's JWKS is unreachable

A downstream service fetches the gateway's JWKS before it starts serving and exits if that fetch fails; after startup it rejects requests rather than falling back to cached or stale keys when a refresh fails. We accepted that a downstream cannot boot while the gateway is unreachable, in exchange for never serving traffic whose identity it could not verify.

**Consequences**: a gateway outage longer than the key cache lifetime turns into `401`s at every downstream, and a cold cluster start must order downstreams behind the gateway's health. There is deliberately no stale-key fallback, which is why a brief outage inside the cache window is invisible but a longer one is not.

Rationale in depth: `docs/auth-flow.md`.
