# Apply checklist: `deploy/` → k3s

The homelab cluster runs Flux, with Secrets encrypted by sops + age. The full
build, including where every file lands, is
[`docs/deploy/homelab-k3s.md`](../docs/deploy/homelab-k3s.md); that guide is
the source of truth, and this checklist covers only the gateway's signing key,
its rotation, and the network policy.

These files are templates. Copy them into the GitOps repo (`core-infra`,
under `apps/coregateway/`) and adjust them there. Nothing in this repo is
applied by automation, and `deploy/examples/` is a template shelf, not live
config.

Order matters. Each step ends with a check; do not continue until it passes.

## File map

| File | What it is | Where it goes |
|---|---|---|
| `gateway-deployment-patch.yaml` | Mounts `gateway-jwt-keys` into the gateway | Fold into `apps/coregateway/coregateway-api.yaml` (homelab guide 15.3 already has it folded in) |
| `cilium-networkpolicy.yaml` | Downstreams accept ingress only from the gateway | `apps/coregateway/`, applied last |
| `sops-rotation-cronjob.yaml` | Rotation jobs that open pull requests | `apps/coregateway/`, once the platform is stable |
| `examples/sops-dot-sops.yaml` | The `.sops.yaml` creation rule | `core-infra/.sops.yaml` (homelab guide section 7) |
| `examples/sops-age-secret.yaml` | Shape of the `sops-age` Secret | Created with `kubectl`, never committed |
| `examples/sops-flux-kustomization.yaml` | The `decryption` stanza | Already on the `apps` Kustomization (homelab guide 8.3) |
| `examples/sops-gateway-jwt-keys-secret.yaml` | Template of the encrypted key Secret | `apps/coregateway/gateway-jwt-keys.sops.yaml`, encrypted |
| `examples/sops-rotation-image.Dockerfile` | Image for the rotation jobs | Built and pushed once |

Every Secret the cluster reads is a `*.sops.yaml` file in `core-infra`,
encrypted for two age recipients: the cluster key (`sops-age` in
`flux-system`) and your personal key.

## 0. Prerequisites

- [ ] The homelab guide through section 15.2: k3s, Cilium, sops + age
      (section 7), Flux with the `apps` Kustomization decrypting with
      `sops-age` (section 8), Reloader (section 9), and the `coregateway`
      namespace
- [ ] `kubectl`, `flux`, `sops`, `age`, `jq`, `curl` on the laptop

## 1. Signing key

- [ ] Create `apps/coregateway/gateway-jwt-keys.sops.yaml` from
      `examples/sops-gateway-jwt-keys-secret.yaml` and encrypt it
      (homelab guide 15.2). Use a new key, never the dev checkout's
      `jwt_ed25519.pem`
- [ ] Check: `sops -d apps/coregateway/gateway-jwt-keys.sops.yaml | head`
      decrypts, and `grep -c 'PRIVATE KEY' apps/coregateway/gateway-jwt-keys.sops.yaml`
      prints `0`
- [ ] The gateway Deployment mounts it as in homelab guide 15.3 (the folded
      form of `gateway-deployment-patch.yaml`), with
      `reloader.stakater.com/auto: "true"`
- [ ] Push; `flux reconcile kustomization apps --with-source`
- [ ] Check serving: pods `Ready`, then
      `kubectl -n coregateway run jwks --rm -it --image=curlimages/curl --restart=Never -- curl -s http://coregateway-api:8080/.well-known/jwks.json`
      lists your `kid`
- [ ] Check traffic: log in, open the budget page → `GET /api/budget/remaining`
      returns `200`

## 2. Rotation jobs

sops encrypts at rest; it does not generate or rotate anything. The rotation
CronJobs do that and propose each phase as a **pull request** you merge. Flux
decrypts and applies; Reloader rolls the gateway.

- [ ] Build the job image (`examples/sops-rotation-image.Dockerfile`), push it
      to `ghcr.io/ejsadiarin/jwt-rotation`, and pin it by digest in
      `sops-rotation-cronjob.yaml`
- [ ] Copy the cluster age key into the app namespace. The jobs decrypt the
      Secret themselves and cannot mount `flux-system`'s copy. Take
      `cluster.agekey` from Vaultwarden (homelab guide section 7), then:
      `kubectl -n coregateway create secret generic sops-age --from-file=age.agekey=cluster.agekey && shred -u cluster.agekey`
- [ ] Create Secret `jwt-rotation-git` in `coregateway` with key `token`: a
      fine-grained token on `core-infra` only, `contents:write` +
      `pull-requests:write`. Encrypt it as `apps/coregateway/jwt-rotation-git.sops.yaml`
- [ ] Check the env values in `sops-rotation-cronjob.yaml` (`GITOPS_REPO`,
      `SECRET_FILE`, `JWKS_URL`) match `core-infra`
- [ ] Commit `sops-rotation-cronjob.yaml` under `apps/coregateway/` (quarterly
      `sops-jwt-rotation`, 15-minute `sops-jwt-rotation-retire`, suspended
      manual variant)
- [ ] Dry-run phase 1:
      `kubectl create job --from=cronjob/sops-jwt-rotation-manual test-rotation -n coregateway`
      → a PR appears with `kid` moved to `prev_kid`, `rotated-at` set, and
      ciphertext only
- [ ] Merge it, let Flux reconcile, confirm JWKS lists **both** kids, then
      wait for the retire PR (within 15 minutes after the 1200s drain) and
      merge that
- [ ] Confirm the old key is gone from JWKS and the Secret's `prev_*` are
      empty; delete the test Job

Full policy, manual commands and failure modes:
[`docs/runbooks/jwt-key-rotation.md`](../docs/runbooks/jwt-key-rotation.md).

## 3. Cilium policy (last: wrong labels break traffic)

The cluster-specific additions (the `ingress` entity for Gateway traffic,
DNS-aware egress to Neon) are in homelab guide 15.7.

- [ ] Copy `cilium-networkpolicy.yaml` once per downstream, with its own
      `endpointSelector` and port
- [ ] `kubectl apply --dry-run=server -f <file>` first, then commit it
- [ ] Check allow: the budget page still loads (gateway → `corefinance-api` → `200`)
- [ ] Check deny:
      `kubectl run -it --rm debug --image=curlimages/curl -n coregateway -- curl -m 5 http://corefinance-api:6969/api/budget/priority-groups`
      must time out
- [ ] Watch for drops: `hubble observe -n coregateway --verdict DROPPED`

## 4. Closeout

- [ ] The cluster age key (`cluster.agekey`) is in Vaultwarden and on paper
      (homelab guide sections 7 and 18). Losing it stops decryption and
      rotation, not traffic: running pods keep their Secrets
- [ ] Rotation is checked quarterly against a 90-day policy; you merge two PRs
      per rotation, everything else is automatic
- [ ] References: [`docs/runbooks/jwt-key-rotation.md`](../docs/runbooks/jwt-key-rotation.md)
      (policy, manual run), [`docs/auth-flow.md`](../docs/auth-flow.md) (concepts)
