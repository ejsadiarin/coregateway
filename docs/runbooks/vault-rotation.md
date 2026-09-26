# Runbook: Vault JWT rotation

Target state: Vault KV v2 at `secret/coregateway/jwt` holds the gateway
signing keys; external-secrets syncs them to the `gateway-jwt-keys`
Secret every minute; Reloader rolls the gateway on change; the monthly
`jwt-rotation` CronJob executes the two-phase rotation below
automatically. See `deploy/` for all templates and
`deploy/vault-kv-layout.md` for the KV schema.

## Policy

- Signing-key max age: **90 days** (`created_at` in Vault; enforced by
  the CronJob, which wakes monthly and no-ops on young keys — so actual
  rotation lands at 90–120 days).
- Rotate immediately on suspected exposure (PEM in logs/git/tickets) or
  personnel offboarding with secret-store access, regardless of age.
- Token TTL (300s) is unrelated and unchanged.

## How one automatic run works

1. CronJob reads `created_at`; exits 0 if age < 90d.
2. **Phase 1:** writes `{current: NEW, prev: OLD}` as one KV version →
   ESO syncs → Reloader rolls gateway → Job polls JWKS until the NEW
   `kid` appears (5 min timeout, Job fails loudly on timeout — check
   ESO/Reloader, overlap stays safely in place).
3. Drain wait ~10 min (300s token TTL + 5 min downstream cache + margin).
4. **Phase 2:** writes `{current: NEW, prev: cleared}`, destroys all
   versions up to and including phase 1 (`destroy` wipes the data; the
   phase-1 version still embeds the old key), verifies the OLD `kid` is
   gone from JWKS.
5. Vault version history is the audit log.

A crash between phases is safe: overlap still published, next month's
run (or a manual re-run) finishes it.

## Manual / incident rotation

Never hand-edit Vault (skips verification, age bookkeeping, kid naming,
version destroy). Trigger the same code path instead:

```bash
kubectl create job --from=cronjob/jwt-rotation-manual incident-YYYY-MM-DD -n coregateway
kubectl logs -f job/incident-YYYY-MM-DD -n coregateway
```

`FORCE=true` is baked into that template, bypassing only the age check.

## Verification (after any rotation)

```bash
# JWKS serves exactly the expected kids:
curl -s http://gateway.coregateway.svc:8080/.well-known/jwks.json | jq '.keys[].kid'
# Gateway pods all on the new revision:
kubectl rollout status deploy/gateway -n coregateway
# Spot-check a real call: login -> GET /api/budget/remaining -> 200
# Sync lag tuning: the ExternalSecret uses refreshInterval: 1m; if a
# rotation ever waits on sync, force it with:
# kubectl annotate externalsecret gateway-jwt-keys -n coregateway \
#   force-sync=$(date +%s) --overwrite
```

## Rollback

Rotation is forward-fixable by re-running, but to roll back: write the
previous KV version's values back as current (Vault history retains
them until destroyed — another reason phase-2 destroy matters only
*after* verification), let ESO/Reloader roll, confirm JWKS.

## Vault backup / restore

- Nightly `vault-backup` CronJob snapshots raft to the `vault-backups`
  PVC (14 retained). Restore: `vault operator raft snapshot restore
  <file>`.
- Seal/unseal: single-node Vault — keep unseal material per your install;
  loss of Vault does **not** stop traffic (gateway/downstream run on
  synced Secret + cached keys), it only blocks future rotations.

## Troubleshooting

| Symptom | Likely cause → action |
|---|---|
| Job fails polling JWKS for NEW kid | ESO not syncing or Reloader not rolling → `kubectl describe externalsecret gateway-jwt-keys`, check Reloader logs; overlap is in place, nothing is broken, fix the chain and re-run |
| JWKS shows 1 key right after phase 1 | ESO `refreshInterval` too long or Secret mapping wrong → check synced Secret contents vs Vault |
| `401`s fleet-wide post-rotation | Gateway rolled with NEW-only before drain (shouldn't happen — poll + wait guard it) → re-add overlap manually per rollback, then investigate |
| CronJob never acts | `created_at` missing/stale (pre-automation keys) → backfill once via `vault kv patch`, or run the manual template once |
