# Sign internal tokens with Ed25519 and publish public keys via JWKS

Downstream services must verify gateway-minted identity without being able to forge it. The gateway signs internal tokens with an Ed25519 private key it alone holds and publishes the public half at its JWKS endpoint, so each downstream verifies locally with no shared secret and no call back to the gateway per request. We rejected an HS256 shared secret because every downstream would then hold a signing key and could mint tokens for any user, and rejected per-request introspection because it would make every downstream request depend on the gateway's availability.

**Consequences**: rotation requires an overlap window in which both the current and previous public keys are published, and every downstream must accept a key id rather than a single fixed key.

Rationale in depth: `docs/auth-flow.md`.
