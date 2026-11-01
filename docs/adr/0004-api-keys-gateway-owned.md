# API keys are issued and stored only by the gateway

Downstream services accept a minted internal token and nothing else; the gateway owns API key issuance, scoping, and revocation. This keeps downstream services stateless verifiers with no credential database to keep in sync. The explicit no is as important as the yes: no downstream stores API keys, and no client-supplied user-identity header is trusted at any hop.

**Consequences**: adding a downstream requires no credential work beyond accepting the gateway's audience, but every change to key scope semantics ships in the gateway and affects all downstreams at once.
