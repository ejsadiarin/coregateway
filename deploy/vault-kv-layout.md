# Vault KV layout for gateway JWT keys

Engine: KV v2, mounted at `secret/` (default). All values below live at
one path so each rotation phase is a single atomic KV version.

## Path: `secret/coregateway/jwt`

| Key | Contents | Example |
|---|---|---|
| `private_pem` | Current Ed25519 private key, PKCS#8 PEM (multiline) | `-----BEGIN PRIVATE KEY-----…` |
| `kid` | Current key ID (date-letter convention) | `2026-09-a` |
| `prev_private_pem` | Previous private key, or empty outside rotation | `` (empty) |
| `prev_kid` | Previous key ID, or empty outside rotation | `` (empty) |
| `created_at` | Unix timestamp of the **current** key's creation | `1758883200` |

Bootstrap (before first deploy):

```bash
openssl genpkey -algorithm ed25519 -out jwt-current.pem
vault kv put secret/coregateway/jwt \
  private_pem="$(cat jwt-current.pem)" \
  kid="$(date +%Y-%m)-a" \
  prev_private_pem="" \
  prev_kid="" \
  created_at="$(date +%s)"
shred -u jwt-current.pem
```

## Policy HCL (`jwt-rotation` role)

```hcl
# Full control over the JWT key path (rotation job only).
path "secret/data/coregateway/jwt" {
  capabilities = ["create", "read", "update"]
}
path "secret/metadata/coregateway/jwt" {
  capabilities = ["read", "update", "delete"]
}
```

Bind to the rotation CronJob's ServiceAccount via the Kubernetes auth
method (`bound_service_account_names = ["jwt-rotation"]`,
`bound_service_account_namespaces = ["coregateway"]`). The gateway and
downstream pods get **no** Vault access at all — they read the synced
K8s Secret via external-secrets.

## Notes

- `kid` letter: if two rotations land in the same calendar month, bump
  the letter (`-a` → `-b`). The rotation script does this automatically.
- `created_at` tracks the **current** key only; the CronJob enforces the
  90-day policy off this field.
- Old KV versions are destroyed after phase 2 (see runbook) so a
  rotated-out private key does not linger in history. `destroy` wipes
  version data outright (unlike soft `delete`); destroy every version up
  to and including the phase-1 write, which still embeds the old key in
  `prev_private_pem`.
