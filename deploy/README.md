# Apply checklist: `deploy/` → k3s

Order matters. Each step ends with a manual verification before moving on.
Adjust the `TODO` names in each manifest first (namespace `coregateway`,
Service/label names, image pins).

The homelab cluster uses **Flux with sops + age (Source B)**; the full build
is in [`docs/deploy/homelab-k3s.md`](../docs/deploy/homelab-k3s.md). The Vault
files (Source A) stay here as an unused alternative.

These files are templates: copy them into the GitOps repo (`core-infra`) and
adjust names there. Nothing here is applied by automation in this repo, and
`deploy/examples/` is a template shelf, not live config.

## File map

Pick **one** secret source. Both produce the same Secret `gateway-jwt-keys`
with keys `private_pem`, `prev_private_pem`, `kid`, `prev_kid`, which is all
`gateway-deployment-patch.yaml` cares about.

| File | Source | Applied |
|---|---|---|
| `gateway-deployment-patch.yaml` | either | yes |
| `cilium-networkpolicy.yaml` | either | yes |
| `vault-external-secret.yaml` | Vault (ESO) | only with Vault |
| `vault-rotation-cronjob.yaml` | Vault | only with Vault |
| `vault-backup-cronjob.yaml` | Vault | only with Vault |
| `vault-kv-layout.md` | Vault | reference |
| `sops-rotation-cronjob.yaml` | sops + age | only with sops |
| `examples/sops-*` | sops + age | copy into the GitOps repo, never apply |

Running both rotation stacks is a mistake: they would each generate keys and
fight over the same Secret.

## 0. Prereqs

- [ ] k3s cluster with Cilium and Flux (`docs/deploy/homelab-k3s.md`,
      sections 1–9). Cilium mutual authentication is not enabled; the
      network policy plus the internal token are the two layers
- [ ] One of: Flux with kustomize-controller (sops path, the chosen one),
      **or** Vault (single node, integrated raft) + external-secrets operator
- [ ] Reloader installed (Stakater; watches Secrets → rolls Deployments)
- [ ] `kubectl`, `jq`, `curl`; `age`/`sops` too if you chose sops

---

# Source A — Vault (ESO)

## A1. Vault: auth, bootstrap, policy

Follow `deploy/vault-kv-layout.md`:

- [ ] Enable the Kubernetes auth method; create role `jwt-rotation` bound to
      SA `jwt-rotation` in namespace `coregateway`
- [ ] Create role `vault-backup` bound to SA `vault-backup` in namespace
      `vault` (snapshot capability only)
- [ ] Bootstrap the key material (genkey → `vault kv put
      secret/coregateway/jwt …` → shred the local PEM)
- [ ] Verify: `vault kv get secret/coregateway/jwt` shows
      `private_pem/kid/created_at` (+ empty `prev_*`)

## A2. ExternalSecret + gateway wiring

- [ ] Create the Vault `ClusterSecretStore` `vault-backend` (K8s auth)
- [ ] Apply `deploy/vault-external-secret.yaml`
- [ ] Verify sync: `kubectl -n coregateway get externalsecret
      gateway-jwt-keys` shows `Ready`, and Secret `gateway-jwt-keys`
      contains `private_pem/kid`
- [ ] Fold `deploy/gateway-deployment-patch.yaml` into the gateway Deployment
      and apply → Reloader (or manual `rollout restart`) rolls the pods
- [ ] Verify serving: pods `Ready`, then
      `curl http://gateway.coregateway.svc:8080/.well-known/jwks.json | jq '.keys[].kid'`
      shows the bootstrapped `kid`
- [ ] Verify traffic: login → `GET /api/budget/remaining` → `200`
- [ ] ArgoCD: add `ignoreDifferences` for the ESO-managed Secret's
      `data`/`stringData` (see note at the bottom of
      `vault-external-secret.yaml`) so sync stays green

## A3. Rotation (dry-run the automation before trusting it)

- [ ] Apply `deploy/vault-rotation-cronjob.yaml` (monthly `jwt-rotation` +
      suspended `jwt-rotation-manual` + script ConfigMap)
- [ ] Prove end-to-end with a forced run (exercises phase 1 → JWKS poll →
      drain → phase 2 on the live chain):
      `kubectl create job --from=cronjob/jwt-rotation-manual test-rotation -n coregateway`
- [ ] Watch: `kubectl logs -f job/test-rotation -n coregateway` — expect
      phase-1 write, "JWKS serves `<new-kid>`", drain sleep, phase-2 write,
      "rotation complete"
- [ ] Verify: JWKS serves only the new `kid`; `kubectl rollout status
      deploy/gateway`; old key versions destroyed in Vault
      (`vault kv metadata get secret/coregateway/jwt`); budget traffic still
      `200` throughout (spot-check during the run)
- [ ] Delete the test Job; the monthly CronJob now owns the 90-day policy

## A4. Vault backups

- [ ] Create PVC `vault-backups`, apply `deploy/vault-backup-cronjob.yaml`
- [ ] Trigger once manually (`kubectl create job --from=…` or wait for 02:00),
      verify a `.snap` lands on the PVC
- [ ] Spot-check restore knowledge: `vault operator raft snapshot restore`
      syntax (don't restore over a healthy Vault — read the runbook instead)

---

# Source B — sops + age (Flux)

sops is encryption at rest in Git; it does not generate or rotate anything.
The rotation CronJob does that and proposes the change as a **pull request**
you merge. Flux decrypts and applies; Reloader rolls the pod.

## B1. Age identity and repo plumbing

- [ ] `age-keygen -o age.agekey`, then
      `kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=age.agekey`
      (shape: `deploy/examples/sops-age-secret.yaml`); store the key offline
      and shred the local copy
- [ ] Copy `deploy/examples/sops-dot-sops.yaml` to the **GitOps repo root**
      as `.sops.yaml`, with your public key (`age-keygen -y age.agekey`)
- [ ] Copy `deploy/examples/sops-gateway-jwt-keys.yaml` into that repo
      (e.g. `clusters/<cluster>/coregateway/secrets/`), fill in the key, then
      `sops -e -i` it. Confirm `sops -d <file> | head` decrypts and the
      committed file does not contain `PRIVATE KEY`
- [ ] Add `decryption: {provider: sops, secretRef: {name: sops-age}}` to the
      Flux Kustomization that owns this app
      (`deploy/examples/sops-flux-kustomization.yaml`)
- [ ] Fold `deploy/gateway-deployment-patch.yaml` into the Deployment and
      push → Flux reconciles → Reloader rolls the pods
- [ ] Verify serving and traffic exactly as in A2 (JWKS `kid`, budget `200`)

## B2. Rotation jobs

- [ ] Build the job image (`deploy/examples/sops-rotation-image.Dockerfile`)
      and pin it by digest in `deploy/sops-rotation-cronjob.yaml`
- [ ] Copy the age identity into the app namespace — the jobs decrypt the
      Secret themselves and cannot mount `flux-system`'s copy:
      `kubectl -n coregateway create secret generic sops-age --from-file=age.agekey=age.agekey`
- [ ] Create Secret `jwt-rotation-git` in `coregateway` with key `token` — a
      fine-grained PAT scoped to the GitOps repo, `contents:write` +
      `pull-requests:write`
- [ ] Fill the `TODO` env values (`GITOPS_REPO`, `SECRET_FILE`, `JWKS_URL`)
- [ ] Apply `deploy/sops-rotation-cronjob.yaml` (quarterly `sops-jwt-rotation`,
      15-minute `sops-jwt-rotation-retire`, suspended manual variant)
- [ ] Dry-run phase 1:
      `kubectl create job --from=cronjob/sops-jwt-rotation-manual test-rotation -n coregateway`
      → a PR appears with `kid` moved to `prev_kid`, `rotated-at` set, and
      ciphertext only
- [ ] Merge it, watch Flux reconcile, confirm `curl …/jwks.json | jq '.keys[].kid'`
      lists **both** kids, then wait for the retire PR (≤15 min after the
      1200s drain) and merge that
- [ ] Confirm the old key is gone from JWKS and the Secret's `prev_*` are empty

Full policy, manual commands and failure modes:
`docs/runbooks/jwt-key-rotation.md`.

---

## C. Cilium policy (last — it can break traffic if labels are wrong)

- [ ] Fix pod labels/ports in `deploy/cilium-networkpolicy.yaml`, and add the
      downstream's DB egress (DNS-only by default — the template intentionally
      has no broad `toCIDR`)
- [ ] `kubectl apply --dry-run=server` first; then apply for real
- [ ] Verify allow: gateway → corefinance budget call → `200`
- [ ] Verify deny: `kubectl run -it --rm debug --image=curlimages/curl
      -n coregateway -- curl -m 5 http://corefinance:6969/api/budget/priority-groups`
      → must time out / drop (proves ingress is gateway-only)
- [ ] Repeat per downstream (copy the policy, own `endpointSelector`)

## D. Closeout

- [ ] Record the recovery-material location somewhere survivable: Vault unseal
      keys + backup PVC, **or** the age private key. Losing it stops
      decryption/rotation, not traffic
- [ ] Calendar note (optional): rotation is quarterly-checked, 90-day policy;
      with sops you still merge two PRs, everything else is automatic
- [ ] Full procedure reference: `docs/runbooks/vault-rotation.md` (Vault
      specifics), `docs/runbooks/jwt-key-rotation.md` (policy, manual run,
      sops+age alternative); concept reference: `docs/auth-flow.md`
