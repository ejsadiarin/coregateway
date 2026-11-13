# coreban attachments: Cloudflare R2

Sets up the object storage behind images and videos in the Feed (coreban
ADR-0004) for the cluster built in [`homelab-k3s.md`](./homelab-k3s.md).
The main guide calls this runbook from section 15.2; it can also be run on
its own against a cluster that already serves coreban.

Prerequisites: sections 7 (sops + age) and 8 (Flux) of the main guide, and a
Cloudflare account with R2 enabled. The dashboard's public origin is
`https://core.ejsadiarin.com`.

- [1. How it fits together](#1-how-it-fits-together)
- [2. Bucket](#2-bucket)
- [3. CORS](#3-cors)
- [4. API token](#4-api-token)
- [5. coreban's Secret](#5-corebans-secret)
- [6. Network policy](#6-network-policy)
- [7. Migrate and deploy](#7-migrate-and-deploy)
- [8. Verify](#8-verify)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Operations](#10-operations)

---

## 1. How it fits together

```
 phone ──PUT / GET (signed links, HTTPS)──────────────► R2 bucket coreban-attachments
   │                                                         ▲
   └─/api/coreban/attachments──► coregateway-api ──► coreban-api
                                                       │  signs links (S3 keys)
                                                       │  checks uploads (HEAD)
                                                       └─ cleaner deletes files (DELETE)
```

- Files never pass through the cluster. coreban signs a link, and the phone
  talks to R2 directly. That is why the bucket needs CORS for the dashboard's
  origin.
- The bucket stays **private**. Upload links last 15 minutes and are pinned
  to the declared type and size; read links last 1 hour.
- Objects are keyed `<user-id>/<attachment-id>`, plus `<…>.poster` for a
  video's poster frame.
- Each user has a 5 GB quota (`ATTACHMENT_QUOTA`); admins have none. Files
  waiting to be deleted still count.
- The cleaner runs inside `coreban-api`. When a note is permanently deleted,
  its files are queued in the same transaction and removed from R2 once
  their upload links have expired (15 minutes), with retries until R2
  confirms. Uploads that never made it into a note are swept after 24 hours.
  Archiving a note keeps its files.

## 2. Bucket

Cloudflare dashboard → **R2 Object Storage** → **Create bucket**:

| Field | Value |
|---|---|
| Name | `coreban-attachments` |
| Location | Automatic. Not a jurisdiction (EU, FedRAMP): that changes the endpoint |
| Default storage class | Standard |

After creating it, under **Settings**: leave **Public access** disabled
and connect **no custom domain**. Signed links work only on R2's S3
endpoint, and a public URL would bypass them.

## 3. CORS

Bucket → **Settings** → **CORS policy** → **Add CORS policy**:

```json
[
  {
    "AllowedOrigins": ["https://core.ejsadiarin.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

- The origin is scheme plus host, with no path and no trailing slash. Add one
  entry for every other origin the dashboard is served from.
- A plain-http address (a tailnet IP, say) can view attachments but cannot
  install the app, and Android only offers sharing to an installed app.
  Production is HTTPS only.

## 4. API token

R2 overview → **Manage API tokens** → **Create API token**:

| Field | Value |
|---|---|
| Name | `coreban-attachments` |
| Permissions | **Object Read & Write** |
| Specify bucket(s) | **Apply to specific buckets only** → `coreban-attachments` |
| TTL | Forever, or a date you put in the calendar (section 10) |

Copy these three values before leaving the page; the secret is shown once:

- Access Key ID
- Secret Access Key
- the S3 endpoint for your account: `https://<account-id>.r2.cloudflarestorage.com`

## 5. coreban's Secret

In `core-infra`, add the keys to coreban's encrypted Secret. Run sops from
inside the repo so it finds `.sops.yaml`:

```sh
cd ~/personal/core-infra
sops apps/coregateway/coreban-api.sops.yaml     # opens decrypted in $EDITOR; re-encrypts on save
```

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: coreban-api
  namespace: coregateway
stringData:
  DATABASE_URL: postgresql://coreban_role:…@<pooler-host>/coredb?sslmode=require
  NTFY_TOKEN: …
  S3_ENDPOINT: https://<account-id>.r2.cloudflarestorage.com
  S3_BUCKET: coreban-attachments
  S3_ACCESS_KEY_ID: …
  S3_SECRET_ACCESS_KEY: …
  S3_REGION: auto
```

If the file does not exist yet, write it in plaintext, then
`sops -e -i apps/coregateway/coreban-api.sops.yaml` before `git add`. The
pre-commit hook from section 7 of the main guide refuses an unencrypted
`*.sops.yaml`.

| Variable | Value | Note |
|---|---|---|
| `S3_ENDPOINT` | the account endpoint | Unset: coreban starts with attachments off |
| `S3_BUCKET` | `coreban-attachments` | |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from section 4 | |
| `S3_REGION` | `auto` | R2 ignores regions, but the signer needs `auto` |
| `S3_PUBLIC_ENDPOINT` | **unset** | Only for a store coreban reaches on a different address than the phone does (the local e2e stack) |
| `ATTACHMENT_QUOTA` | unset (`5GB`) | Per user; accepts `500MB`, `10GB`, … |

The `coreban-api` Deployment reads the Secret with `envFrom` and carries
the Reloader annotation, so a merged change rolls the pods.

Check before committing:

```sh
grep -c 'S3_SECRET_ACCESS_KEY: ENC\[' apps/coregateway/coreban-api.sops.yaml   # 1
sops -d apps/coregateway/coreban-api.sops.yaml | grep S3_BUCKET               # decrypts
```

## 6. Network policy

Skip this until coreban has an egress policy (main guide 15.7). Once it
has one, the pod needs R2 over HTTPS. The phone's own uploads do not pass
through the cluster, so this covers only coreban's checks and the cleaner:

```yaml
egress:
  # … DNS with the dns rule, Neon, the gateway's JWKS (main guide 15.7)
  - toFQDNs:
      - matchPattern: "*.r2.cloudflarestorage.com"
    toPorts:
      - ports: [{port: "443", protocol: TCP}]
```

Without it, picking a file fails with a 500 and
`hubble observe -n coregateway --verdict DROPPED` shows coreban's
connections to R2 being dropped.

## 7. Migrate and deploy

Attachments need coreban at `8e48c7b` or later, and the web and gateway
from `rewrite-v2` at `4dc5f0c` or later. Migrate before the new pods start,
as in main guide 15.6:

```sh
cd ~/personal/coregateway/services/coreban     # MIGRATION_URL (owner role, direct host) in .env
make migrate-status                            # 00013_attachments and 00014_attachment_deletions pending
make migrate-up
```

Then commit the Secret and the image tag bumps to `core-infra`, push, and:

```sh
flux reconcile kustomization apps --with-source
kubectl -n coregateway rollout status deploy/coreban-api
```

## 8. Verify

```sh
# The "attachments are off" warning is gone:
kubectl -n coregateway logs deploy/coreban-api | grep -c 'S3_ENDPOINT is not set'   # 0

# Anonymous access is refused, so the bucket really is private:
curl -s -o /dev/null -w '%{http_code}\n' \
  https://<account-id>.r2.cloudflarestorage.com/coreban-attachments/          # 400 or 403

# CORS answers the dashboard's preflight:
curl -s -o /dev/null -D - -X OPTIONS \
  -H 'Origin: https://core.ejsadiarin.com' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type' \
  https://<account-id>.r2.cloudflarestorage.com/coreban-attachments/probe \
  | grep -i access-control-allow-origin                                      # the origin
```

On the phone, over `https://core.ejsadiarin.com`:

1. Feed → paperclip → pick a photo and a short video, type a caption,
   **Send**. Each file shows a progress bar, then the note posts.
2. Tap the photo: it opens full screen, and **Download** saves a
   `coreban-YYYYMMDD-….webp`. Play the video.
3. In R2 → `coreban-attachments` → Objects, there is a folder named after
   your user id holding the two files and the video's `.poster`.
4. Install the app (browser menu → Install), open it once, then in Gallery
   select a few photos → **Share** → **CORE**. They arrive in the chat box
   with nothing posted until **Send**.
5. Optional: permanently delete that note. Its objects leave the bucket
   within about 15 minutes.

## 9. Troubleshooting

| Symptom | Cause | Check |
|---|---|---|
| "Attachments aren't set up on this server yet" | coreban answers 503: `S3_ENDPOINT` did not reach the pod | `kubectl -n coregateway exec deploy/coreban-api -- env \| grep -c S3_` (prints a count, not values); Flux reconciled? |
| Upload fails at once, console says CORS | Origin not in the CORS policy, or `content-type` missing from `AllowedHeaders` | The preflight `curl` in section 8 |
| coreban answers 500 when a file is picked | Wrong endpoint, token not scoped to this bucket, or `S3_REGION` not `auto` | `kubectl -n coregateway logs deploy/coreban-api` |
| 500 only once a network policy is applied | No egress to R2 | Section 6; `hubble observe -n coregateway --verdict DROPPED` |
| Upload reaches 100 % but Send says "an attachment hasn't finished uploading" | coreban cannot find the file in R2: the PUT was refused, or went to another bucket | R2 → bucket → Objects; the PUT's response in the browser's network panel |
| Images load, then break after an hour | A read link expired on a page left open | Reload; links are re-signed on each Feed load |
| "storage quota reached: … of 5.0 GB used" | Quota, counting files still queued for deletion | Section 10, usage query |
| Deleted notes' files stay in R2 | The cleaner is retrying a refused delete | Logs: `attachments: delete refused; will retry`; section 10, queue query |
| Sharing from Gallery does not list CORE | App not installed over HTTPS, or installed before the share update | Reinstall from `https://core.ejsadiarin.com` and open it once |

## 10. Operations

**Rotating the token** (yearly, or at once if it leaks):

1. Create a second token as in section 4.
2. Put its two values in `coreban-api.sops.yaml`, push, and reconcile.
   Reloader rolls coreban.
3. Wait an hour, so that read links signed with the old token have expired
   (upload links last only 15 minutes).
4. Delete the old token in R2 → Manage API tokens.

For a leak, delete the old token at once instead; open pages need a reload.

**Adding an origin**: append it to `AllowedOrigins` (section 3).

**Usage and the deletion queue** (with `MIGRATION_URL`, which sets
`search_path` to `coreban`):

```sh
psql "$MIGRATION_URL" -c "
  SELECT owner_id, pg_size_pretty(sum(size_bytes)) FROM attachments GROUP BY owner_id;"
psql "$MIGRATION_URL" -c "
  SELECT key, attempts, next_attempt_at, last_error FROM attachment_deletions
  ORDER BY next_attempt_at LIMIT 20;"
```

A row with many `attempts` and a `last_error` means R2 keeps refusing that
delete. The cleaner backs off up to an hour between tries and never gives
up.

**Backups**: attachments have no copy outside R2. A note's text survives
with `coredb`; its files do not. To add one later, mirror the bucket to B2
(`rclone sync`) on a schedule.

**Turning attachments off**: remove `S3_ENDPOINT` from the Secret. New
uploads are refused with the "not set up" message. Notes still load with
their text, but their attachments come without links, so they stop
showing. The cleaner stops too, so nothing in
the bucket is deleted.
