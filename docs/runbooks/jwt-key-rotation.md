# Runbook: internal signing key rotation

Rotates the gateway's Ed25519 signing key and the `kid` that names it. The
mechanics are identical in every environment; only delivery differs
(a key file on the compose host, or a sops-encrypted Secret in k3s).

Related: `docs/auth-flow.md` (claims, JWKS, why a PEM key),
`docs/deploy/homelab-k3s.md` (the cluster), `deploy/README.md` (apply
order), `deploy/sops-rotation-cronjob.yaml` (automated executor).

## What rotates

| Variable | Rotates? | Why |
|---|---|---|
| `JWT_PRIVATE_KEY_FILE` (or inline `JWT_PRIVATE_KEY_PEM`) | **yes**, every cycle | the signing key itself |
| `JWT_KID` | **with the key** | a key identifier, not a secret. Never reuse a `kid` for different material — verifiers cache by `kid` and will reject fresh tokens until their cache expires |
| `JWT_PREV_PRIVATE_KEY(FILE\|_PEM)` / `JWT_PREV_KID` | set during the overlap, cleared after | keeps the old public key published while old tokens drain |
| `JWT_ISSUER` | never on a timer | not a secret; changing it invalidates every in-flight token instantly |
| `JWT_AUDIENCE` | only when services are added/removed | allow-list of downstreams, not a secret |
| `JWT_TTL_SECONDS` | never | unrelated to key age |

## Policy

- **Scheduled:** every 90 days. 30 days if more than one person can read the
  key material. The automated executor opens a rotation every quarter
  (`deploy/sops-rotation-cronjob.yaml`).
- **Immediately, off-cycle:** suspected or proven exposure (backup, synced
  folder, shell history, committed `.pem`, `docker inspect`, crash dump),
  a machine that held the key is lost/sold, offboarding someone with access,
  unexplained tokens in logs, or the same key used in two environments.
- A 300s token TTL already bounds the value of a stolen key. Rotation on a
  clock bounds **undetected** compromise, which is the part the TTL cannot.

## The invariant: two phases, never one

**Phase 1** publishes the new key *and* keeps the old one. **Phase 2**
retires the old one. Collapsing them into one step is the only way to break
a running fleet.

Drain window before phase 2:

```
token TTL        300s
clock skew        60s
verifier cache   300s   (JWKS Cache-Control / cache TTL)
                 -----
                 660s   -> wait 15 minutes
```

A crash between phases is safe: the overlap stays published, nothing is
broken, and the next run (or a manual re-run) finishes phase 2.

## Manual rotation

Use this for a host/compose deployment, for a drill, or when automation is
unavailable. Steps are the same in k3s — swap the delivery mechanism.

```bash
# 1. New key. kid = date + letter, e.g. 2027-01-a.
openssl genpkey -algorithm ed25519 -out jwt_ed25519_next.pem
#    Compose: the gateway runs as GID 10001 and must be able to read it.
sudo chgrp 10001 jwt_ed25519_next.pem && chmod 640 jwt_ed25519_next.pem

# 2. Build phase 1: new key current, old key previous.
mv jwt_ed25519.pem jwt_ed25519_prev.pem
mv jwt_ed25519_next.pem jwt_ed25519.pem
#    JWT_KID=<new>
#    JWT_PREV_PRIVATE_KEY_FILE=./jwt_ed25519_prev.pem   (native; file wins)
#    Compose mounts only the current key, so the previous one travels as env
#    for one cycle — paste the single-line form into .env:
#      JWT_PREV_PRIVATE_KEY_PEM="$(sed ':a;N;$!ba;s/\n/\\n/g' jwt_ed25519_prev.pem)"
#    JWT_PREV_KID=<old>

# 3. Roll the gateway.
docker compose up -d --force-recreate coregateway-api
# k3s: update the Secret producer, then
#   kubectl -n coregateway rollout restart deploy/coregateway-api

# 4. Verify overlap, then wait 15 minutes (never less).
curl -s localhost:8080/.well-known/jwks.json | jq -r '.keys[].kid'   # BOTH kids

# 5. Phase 2: clear JWT_PREV_*, roll again, verify ONLY the new kid.
```

Do not delete the old key file until step 5 verifies — it is the rollback.

## Automated: sops + age under Flux (k3s)

sops encrypts the Secret manifest in git; Flux's kustomize-controller
decrypts it at reconcile time with the age key held in the cluster. sops
does **not** generate or rotate anything — it only makes it safe to commit
the material. Rotation therefore stays a Git change, automated up to (not
including) the merge.

The cluster setup (two age recipients, `.sops.yaml`, the Flux
Kustomizations) is `docs/deploy/homelab-k3s.md` sections 7 and 8. The
templates are `deploy/examples/sops-*` and `deploy/sops-rotation-cronjob.yaml`;
`deploy/README.md` has the apply order.

### Prerequisites

```yaml
# The `apps` Kustomization (homelab guide 8.3) declares decryption:
spec:
  decryption:
    provider: sops
    secretRef:
      name: sops-age          # namespace flux-system
```

```yaml
# core-infra/.sops.yaml
creation_rules:
  - path_regex: .*\.sops\.ya?ml$
    encrypted_regex: ^(data|stringData)$
    age: >-
      age1cluster…,
      age1personal…
```

The encrypted manifest, `core-infra/apps/coregateway/gateway-jwt-keys.sops.yaml`
(values only; the shape is a normal Secret):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: gateway-jwt-keys
  namespace: coregateway
  annotations:
    coregateway.io/rotated-at: "1770000000"   # unix seconds; plaintext, read by the retire job
type: Opaque
stringData:
  private_pem: |
    -----BEGIN PRIVATE KEY-----
    ...
  kid: "2027-01-a"
  prev_private_pem: |
    ...
  prev_kid: "2026-09-a"
```

Both `prev_*` keys must exist even when empty — the Deployment mounts them as
fixed paths, and an empty file means "no rotation in progress".

### Rotation

```bash
openssl genpkey -algorithm ed25519 -out jwt_next.pem

# sops opens the decrypted file in $EDITOR and re-encrypts on save:
#   private_pem <- new PEM, kid <- new kid
#   prev_private_pem <- old PEM, prev_kid <- old kid
# Run from inside core-infra, with your personal key:
sops apps/coregateway/gateway-jwt-keys.sops.yaml

git commit -am "chore(jwt): rotate signing key (phase 1)" && git push
flux reconcile kustomization apps --with-source
# Reloader rolls coregateway-api; without it:
#   kubectl -n coregateway rollout restart deploy/coregateway-api

kubectl -n coregateway run jwks --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://coregateway-api:8080/.well-known/jwks.json      # both kids

# 15 minutes later — phase 2:
#   delete prev_private_pem / prev_kid, sops re-encrypt, commit, reconcile, restart
```

### Automated rotation with pull requests

`deploy/sops-rotation-cronjob.yaml` runs the two phases as **PRs you merge**;
it never writes to the cluster and needs no RBAC.

| CronJob | Schedule | Does |
|---|---|---|
| `sops-jwt-rotation` | quarterly (`0 3 1 */3 *`) | generates a new key, moves the current one to `prev_*`, opens a phase-1 PR |
| `sops-jwt-rotation-retire` | every 15 min | no-ops unless `prev_kid` is set, `rotated-at` is older than `DRAIN_SECONDS` (1200s), and JWKS serves both kids — then opens the phase-2 PR |
| `sops-jwt-rotation-manual` | suspended | same as phase 1, for incident rotation: `kubectl create job --from=cronjob/sops-jwt-rotation-manual …` |

The 15-minute phase boundary lives in the retire job because Flux has no
notion of "wait between reconciles". Its guard rails: it refuses to retire a
key that JWKS is not serving, and it never opens a second retire PR while one
is open.

### What is automated, and what is not

| Step | Automated? |
|---|---|
| Delivery + decryption at reconcile | yes (Flux) |
| Restart on change | yes, with Reloader (`reloader.stakater.com/auto`) |
| Key generation | yes — the rotation job (`openssl` in-cluster) |
| Opening the phase-1 / phase-2 PRs | yes — the CronJobs above |
| The 15-minute phase boundary | yes — the retire sweeper |
| Reviewing and merging both PRs | **no — human gate, by design** |

### sops-specific cautions

- **The age private key is the real root secret.** Anyone holding it can
  decrypt every rotation ever committed. The cluster key lives in the
  cluster (`sops-age` in `flux-system`, and the copy in `coregateway` the
  rotation jobs use), in Vaultwarden and on paper; your personal key stays
  on the laptop. If either leaks, rotate *it*: new recipient in
  `.sops.yaml` → `sops updatekeys` on every file → update the Secrets.
- **Git history keeps ciphertext.** Removing a leaked PEM from the working
  tree does not remove it from history; it stays decryptable by the age key.
- **Do not hand-edit the live Secret.** Flux re-applies on every reconcile,
  so a `kubectl edit secret` is drift and will be reverted.
- **The gateway reads the key at boot.** A mounted Secret updates within
  about a minute, but the process ignores it — restart (or Reloader) is
  required for both phases.
- Keep the volume read-only (`defaultMode: 0440` with the pod's `fsGroup`,
  homelab guide 15.3); the container only needs read.

## Verification

```bash
# Both kids during phase 1, only the new one after phase 2:
curl -s http://localhost:8080/.well-known/jwks.json | jq -r '.keys[].kid'

# Conditional GET still works (expect ETag on 200, 304 on the next poll):
etag=$(curl -sI http://localhost:8080/.well-known/jwks.json | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $etag" \
  http://localhost:8080/.well-known/jwks.json          # 304

# Which source the key came from (file vs inline PEM), never the material:
docker compose logs coregateway-api | grep 'internal JWT identity ready'
kubectl -n coregateway logs deploy/coregateway-api | grep 'internal JWT identity ready'

# End to end: login, then one proxied read -> 200.
```

A `401` at exactly one downstream right after a rotation usually means it
cached the old public key under the same `kid` (i.e. the key changed but the
`kid` did not). Restart that downstream or wait out its 5-minute cache, then
fix the `kid` before the next rotation.

## Rollback

- **Before phase 2:** write the previous key back as current (new key
  becomes `PREV`), roll, verify. Both keys are still published, so no token
  is invalidated.
- **After phase 2:** the old key is retired. Rolling back means publishing
  it again as `PREV` alongside the current key — never as the only current
  key, or tokens minted since phase 1 break.
- **What rollback cannot fix:** a leaked key. Rotate forward; do not restore
  a compromised key to shorten an incident.

## Troubleshooting

| Symptom | Likely cause → action |
|---|---|
| Fleet-wide `401` right after phase 1 | Overlap never published (PREV not set, or the gateway did not roll) → check JWKS shows both kids; fix delivery, re-run phase 1 |
| JWKS still shows one key | the PR is not merged, Flux has not reconciled, or the gateway did not roll → `flux get kustomizations`, `flux reconcile kustomization apps --with-source`, then check the Secret's keys and the pod age |
| `401` at a single downstream only | it cached the old key under a reused `kid` → restart it, and fix the naming |
| `401` everywhere ~15 min after phase 2 | tokens minted with the old key are still alive → wait out the TTL; should not happen if the drain window was respected |
| Gateway exits at boot: `JWT_PRIVATE_KEY_FILE: no such file` | the Secret volume/key changed name, or `prev_*` is missing from the Secret → keep all four keys present (empty `prev_*` is valid) |
| Retire job keeps saying the JWKS lacks a kid | the phase-1 PR is merged but not live: Flux or Reloader is stuck; the overlap is safe meanwhile → fix the reconcile or restart, and the next run opens the retire PR |
| Flux says `decryption failed` | a file was encrypted without the cluster recipient → `sops updatekeys <file>` from inside core-infra |
