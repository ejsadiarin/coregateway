# Apply checklist: `deploy/` → k3s

Order matters. Each step ends with a manual verification before moving
on. Adjust the `TODO` names in each manifest first (namespace
`coregateway`, Service/label names, Vault address, image pins).

Assumes ArgoCD syncs this directory (or `kubectl apply -f deploy/` for
a first manual pass). Nothing here is applied by automation in this
repo — you are the applier.

## 0. Prereqs

- [ ] k3s cluster with Cilium (mTLS on) and ArgoCD
- [ ] Vault (single node, integrated raft) reachable from the cluster
- [ ] external-secrets operator installed
- [ ] Reloader installed (Stakater; watches Secrets → rolls Deployments)
- [ ] `kubectl`, `jq`, `curl`, Vault access for bootstrap

## 1. Vault: auth, bootstrap, policy

Follow `deploy/vault-kv-layout.md`:

- [ ] Enable the Kubernetes auth method; create role `jwt-rotation`
      bound to SA `jwt-rotation` in namespace `coregateway`
- [ ] Create role `vault-backup` bound to SA `vault-backup` in
      namespace `vault` (snapshot capability only)
- [ ] Bootstrap the key material (genkey → `vault kv put
      secret/coregateway/jwt …` → shred the local PEM)
- [ ] Verify: `vault kv get secret/coregateway/jwt` shows
      `private_pem/kid/created_at` (+ empty `prev_*`)

## 2. ExternalSecret + gateway wiring

- [ ] Create the Vault `ClusterSecretStore` `vault-backend` (K8s auth)
- [ ] Apply `deploy/external-secret.yaml`
- [ ] Verify sync: `kubectl -n coregateway get externalsecret
      gateway-jwt-keys` shows `Ready`, and Secret `gateway-jwt-keys`
      contains `private_pem/kid`
- [ ] Fold `deploy/gateway-deployment-patch.yaml` into the gateway
      Deployment and apply → Reloader (or manual `rollout restart`)
      rolls the pods
- [ ] Verify serving: pods `Ready`, then
      `curl http://gateway.coregateway.svc:8080/.well-known/jwks.json | jq '.keys[].kid'`
      shows the bootstrapped `kid`
- [ ] Verify traffic: login → `GET /api/budget/remaining` → `200`
- [ ] ArgoCD: add `ignoreDifferences` for the ESO-managed Secret's
      `data`/`stringData` (see note at the bottom of
      `external-secret.yaml`) so sync stays green

## 3. Rotation (dry-run the automation before trusting it)

- [ ] Apply `deploy/rotation-cronjob.yaml` (monthly `jwt-rotation` +
      suspended `jwt-rotation-manual` + script ConfigMap)
- [ ] Prove end-to-end with a forced run (exercises phase 1 → JWKS
      poll → drain → phase 2 on the live chain):
      `kubectl create job --from=cronjob/jwt-rotation-manual test-rotation -n coregateway`
- [ ] Watch: `kubectl logs -f job/test-rotation -n coregateway` —
      expect phase-1 write, "JWKS serves `<new-kid>`", drain sleep,
      phase-2 write, "rotation complete"
- [ ] Verify: JWKS serves only the new `kid`; `kubectl rollout status
      deploy/gateway`; old private key versions destroyed in Vault
      (`vault kv metadata get secret/coregateway/jwt`); budget traffic
      still `200` throughout (spot-check during the run)
- [ ] Delete the test Job; the monthly CronJob now owns the 90-day policy

## 4. Vault backups

- [ ] Create PVC `vault-backups`, apply
      `deploy/vault-backup-cronjob.yaml`
- [ ] Trigger once manually (`kubectl create job --from=…` or wait for
      02:00), verify a `.snap` lands on the PVC
- [ ] Spot-check restore knowledge: `vault operator raft snapshot
      restore` syntax (don't restore over a healthy Vault — read the
      runbook section instead)

## 5. Cilium policy (last — it can break traffic if labels are wrong)

- [ ] Fix pod labels/ports in `deploy/cilium-networkpolicy.yaml`, and
      add the downstream's DB egress (DNS-only by default — the template
      intentionally has no broad `toCIDR`)
- [ ] `kubectl apply --dry-run=server` first; then apply for real
- [ ] Verify allow: gateway → corefinance budget call → `200`
- [ ] Verify deny: `kubectl run -it --rm debug --image=curlimages/curl
      -n coregateway -- curl -m 5 http://corefinance:6969/api/budget/priority-groups`
      → must time out / drop (proves ingress is gateway-only)
- [ ] Repeat per downstream (copy the policy, own `endpointSelector`)

## 6. Closeout

- [ ] Record Vault unseal material + backup PVC location somewhere
      survivable (losing Vault stops rotations, not traffic)
- [ ] Calendar note (optional — automation owns it now): rotation is
      monthly-checked, 90-day policy; no human action expected
- [ ] Full procedure reference: `docs/runbooks/vault-rotation.md`;
      concept reference: `docs/auth-flow.md`
