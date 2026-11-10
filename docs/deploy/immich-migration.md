# Immich: Docker Compose to k3s

Moves the existing Immich install on `core-2` (the N100) into the cluster
built in [`homelab-k3s.md`](./homelab-k3s.md). The photos and videos do not
move: the cluster mounts the directory they are already in.

Prerequisites: sections 1–13 of the main guide are done and verified
(CloudNativePG, `local-path-retain`, the internal Gateway, tailnet access and DNS).

- [1. What changes and what does not](#1-what-changes-and-what-does-not)
- [2. Your files are not locked in](#2-your-files-are-not-locked-in)
- [3. Preflight on the Compose install](#3-preflight-on-the-compose-install)
- [4. Library volume](#4-library-volume)
- [5. Database cluster](#5-database-cluster)
- [6. Cutover](#6-cutover)
- [7. Install Immich](#7-install-immich)
- [8. Verify](#8-verify)
- [9. Rollback](#9-rollback)
- [10. After the move](#10-after-the-move)

---

## 1. What changes and what does not

| Piece | Compose today | In the cluster |
|---|---|---|
| Photos and videos | `UPLOAD_LOCATION` on `core-2` | Same directory, mounted through a static local volume. Nothing is copied |
| Server | `immich_server` container | Official Helm chart, pinned to `core-2` |
| Machine learning | `immich_machine_learning` | Same chart, prefers `core-1` (the i5) |
| Redis | `redis:6.2` container | Valkey from the chart, no persistence |
| Database | `immich_postgres`, Postgres 14 + VectorChord 0.4.3, superuser `postgres` | CloudNativePG, Postgres 18 + VectorChord 1.1.1, on `core-2`'s SSD |
| URL | `immich.local.ejsadiarin.com` via Traefik (LAN) | `immich.lab.ejsadiarin.com` via the internal Gateway (tailnet devices only) |
| Media backup | restic on the host | Unchanged |
| Database backup | Immich's nightly dump into `library/backups` | That, plus continuous backup to B2 |

Versions checked 2026-11-10: Immich `v3.3.6`, chart `0.13.4` (its default
image tag is `v3.2.0`, so the tag is set explicitly). Immich supports Postgres
14 to 19 and VectorChord 0.3 up to, not including, 2.0.

The move and an Immich upgrade never happen together: Compose is first brought
to the exact version the cluster will run.

---

## 2. Your files are not locked in

With the storage template on and its migration job run (both true for you),
every original is a normal file under a readable path:

```
<UPLOAD_LOCATION>/
├── library/<user>/<your template>/IMG_1234.jpg   ← originals. Open these with anything
├── upload/<user-id>/…                            ← mobile uploads in flight; empty when idle
├── profile/<user-id>/…                           ← avatars
├── thumbs/…                                      ← generated previews, can be rebuilt
├── encoded-video/…                               ← generated transcodes, can be rebuilt
└── backups/…                                     ← nightly database dumps
```

- Any photo viewer, file manager, `rsync` or restic can read `library/`
  directly on `core-2`. That stays true in the cluster because the volume is
  that same directory, not a copy inside a storage system.
- What lives **only** in the database: albums, people and face tags, shared
  links, favourites, descriptions and edited dates. The files carry their own
  EXIF data; album membership does not survive without the database.
- Treat `library/` as **read-only from outside Immich**. Renaming, moving or
  deleting files there leaves the database pointing at paths that no longer
  exist. Viewing and copying out is always safe.
- To bring in folders that other tools manage, use Immich's **External
  Libraries**: Immich indexes them in place and never moves them.

The volume in section 4 is deliberately not on Longhorn. Longhorn stores data
inside its own block-device images, which no photo viewer can open.

---

## 3. Preflight on the Compose install

All on `core-2`, in the Immich Compose directory.

### 3.1 Find the real library path

```sh
cd ~/services/immich                      # wherever the compose file lives
grep -E 'UPLOAD_LOCATION|DB_DATA_LOCATION|IMMICH_VERSION' .env
realpath "$(grep '^UPLOAD_LOCATION=' .env | cut -d= -f2)"
df -h "$(realpath "$(grep '^UPLOAD_LOCATION=' .env | cut -d= -f2)")"
```

Write down the absolute path. It is `<LIBRARY_PATH>` below. `df` tells you
whether it sits on the root SSD or on one of the labelled drives; if it is on
a drive, that drive must be in `/etc/fstab` (main guide, section 3).

### 3.2 Confirm a fresh backup exists

```sh
ls -lt "<LIBRARY_PATH>/backups" | head -3      # a dump from the last 24 h
restic snapshots --latest 1                     # your existing job, recent
```

Do not continue without both.

### 3.3 Bring Compose to the target version

`.env` currently has `IMMICH_VERSION=release`, which floats. Pin it:

```sh
sed -i 's/^IMMICH_VERSION=.*/IMMICH_VERSION=v3.3.6/' .env
```

The `docker-compose.yml` in `core-infra` is from an older release: it mounts
the library at `/usr/src/app/upload` and uses Redis 6.2. Current Immich
expects the library at **`/data`**. Replace the file with the one published
for the pinned release, re-apply your Traefik labels and `proxy` network, then:

```sh
curl -L -o docker-compose.new.yml \
  https://github.com/immich-app/immich/releases/download/v3.3.6/docker-compose.yml
diff docker-compose.yml docker-compose.new.yml    # merge labels and networks by hand
docker compose pull && docker compose up -d
docker compose logs -f immich-server              # wait for a clean start
```

Read the release notes for every major version between what you were running
(`docker inspect immich_server --format '{{.Config.Image}}'` and the version
shown in the web UI) and `v3.3.6` before pulling.

### 3.4 Check the paths stored in the database

Immich stores each file's path as seen from inside the container. The cluster
mounts the library at `/data`, so the database must agree:

```sh
docker exec immich_postgres psql -U postgres -d immich -Atc \
  'SELECT "originalPath" FROM asset LIMIT 3;'
```

- Paths start with `/data/` → good.
- Paths start with `/usr/src/app/upload/` or `upload/` → the install has not
  been moved to the new location yet. Fix it here, on Compose, following the
  release notes for the version that introduced `/data`, and re-run the query.
  Do not migrate until it shows `/data/`.

If the query fails on the table name, run `\dt` in `psql`; older versions call
the table `assets`.

### 3.5 Check the extensions

```sh
docker exec immich_postgres psql -U postgres -d immich -c '\dx'
```

Expected: `vchord`, `vector`, `earthdistance`, `cube` and a few standard ones.
If **`vectors`** (pgvecto.rs, with an "s") is still listed, the dump will not
restore into the new database. Remove it first, as Immich's VectorChord
migration notes describe:

```sh
docker exec immich_postgres psql -U postgres -d immich -c 'DROP EXTENSION vectors;'
```

### 3.6 Record ownership

```sh
stat -c '%u:%g' "<LIBRARY_PATH>/library"
```

Compose runs Immich as root unless you changed it, so this is normally `0:0`.
The chart also runs as root by default. If you see another owner, set the same
user in the chart values (section 7) so new files match old ones.

---

## 4. Library volume

A static local volume: Kubernetes is told "this directory on `core-2` is a
volume" and never provisions, formats or deletes anything.

`core-infra/apps/immich/library.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: immich
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: immich-library
spec:
  capacity:
    storage: 1Ti                         # informational for local volumes
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: static-local         # a label only; no provisioner behind it
  local:
    path: <LIBRARY_PATH>
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - {key: kubernetes.io/hostname, operator: In, values: [core-2]}
  claimRef:                              # only this claim may bind
    namespace: immich
    name: immich-library
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: immich-library
  namespace: immich
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: static-local
  volumeName: immich-library
  resources:
    requests:
      storage: 1Ti
```

Two guards against writing to the wrong place if a drive is not mounted:

1. `<LIBRARY_PATH>` must be a directory **inside** the mounted filesystem, not
   the mount point itself. If the drive is missing, the path does not exist and
   the pod fails to start instead of writing to the root disk.
2. Immich keeps a hidden `.immich` marker file in each folder and refuses to
   start if they are gone.

**Verify**

```sh
kubectl get pv immich-library          # Available, then Bound once the claim exists
kubectl -n immich get pvc              # immich-library Bound
```

---

## 5. Database cluster

One CloudNativePG instance on `core-2`, beside the server, on local SSD.

### 5.1 Credentials

`apps/immich/secrets.sops.yaml` (encrypt before committing):

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: immich-db-owner
  namespace: immich
type: kubernetes.io/basic-auth
stringData:
  username: immich
  password: <long random, A-Za-z0-9 only>
---
apiVersion: v1
kind: Secret
metadata:
  name: b2-cnpg
  namespace: immich
stringData:
  ACCESS_KEY_ID: <B2 keyID>
  ACCESS_SECRET_KEY: <B2 applicationKey>
```

### 5.2 Cluster and backups

`apps/immich/database.yaml`:

```yaml
apiVersion: barmancloud.cnpg.io/v1
kind: ObjectStore
metadata:
  name: immich-b2
  namespace: immich
spec:
  retentionPolicy: 30d
  configuration:
    destinationPath: s3://<B2_CLUSTER_BUCKET>/cnpg/immich
    endpointURL: https://s3.<B2_REGION>.backblazeb2.com
    s3Credentials:
      accessKeyId: {name: b2-cnpg, key: ACCESS_KEY_ID}
      secretAccessKey: {name: b2-cnpg, key: ACCESS_SECRET_KEY}
    wal:
      compression: gzip
---
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: immich-database
  namespace: immich
spec:
  instances: 1
  imageName: ghcr.io/tensorchord/cloudnative-vectorchord:18.6-1.1.1

  storage:
    storageClass: local-path-retain
    size: 20Gi

  affinity:
    nodeSelector:
      kubernetes.io/hostname: core-2

  postgresql:
    shared_preload_libraries: ["vchord.so"]

  bootstrap:
    initdb:
      database: immich
      owner: immich
      secret: {name: immich-db-owner}
      dataChecksums: true

  # Immich expects a superuser by default: it creates and updates extensions
  # itself and its built-in nightly dump needs it. This database serves only
  # Immich.
  managed:
    roles:
      - name: immich
        ensure: present
        login: true
        superuser: true
        passwordSecret: {name: immich-db-owner}

  plugins:
    - name: barman-cloud.cloudnative-pg.io
      isWALArchiver: true
      parameters:
        barmanObjectName: immich-b2

  resources:
    requests: {memory: 512Mi, cpu: 100m}
    limits: {memory: 2Gi}
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: immich-database-daily
  namespace: immich
spec:
  schedule: "0 0 3 * * *"            # six fields: seconds first
  cluster: {name: immich-database}
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
```

A single instance has no failover. If `core-2` is down, Immich is down anyway,
because the library is on that node.

The alternative the chart's own example uses is the stock CloudNativePG
Postgres image with VectorChord attached as an extension image. It is cleaner
long-term but depends on a newer Kubernetes feature; the single combined image
above is the simpler start.

**Verify**

```sh
kubectl -n immich get cluster immich-database      # "Cluster in healthy state", 1/1
kubectl -n immich get secret immich-database-app   # created by the operator
kubectl -n immich exec immich-database-1 -c postgres -- psql -c '\du immich'
#   attributes include Superuser
kubectl -n immich exec immich-database-1 -c postgres -- \
  psql -d immich -c "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('vchord','vector');"
```

If `immich` is not a superuser, the operator did not apply the managed role to
the bootstrap owner. Grant it by hand
(`psql -c 'ALTER ROLE immich SUPERUSER;'`) and keep going.

The database must stay **empty** until the restore. Do not install the Immich
chart yet: its first start would create a fresh schema and the restore would
then conflict.

---

## 6. Cutover

Immich is offline from the first command until section 8 passes. Budget an
hour; most of it is the restore rebuilding search indexes.

### 6.1 Stop writers, keep the database up

```sh
# core-2
cd ~/services/immich
docker compose stop immich-server immich-machine-learning
```

### 6.2 Dump

```sh
docker exec -t immich_postgres pg_dump --clean --if-exists \
  --no-owner --no-privileges \
  --dbname=immich --username=postgres \
  | gzip > ~/immich-cutover.sql.gz
ls -lh ~/immich-cutover.sql.gz
gunzip -t ~/immich-cutover.sql.gz && echo archive ok
```

`--no-owner` makes everything belong to whoever restores it. Without it, every
table would be owned by `postgres` in the new cluster and not by `immich`.

Then stop the rest, so nothing can write to the library:

```sh
docker compose stop
```

### 6.3 Restore

From the laptop:

```sh
scp core-2:immich-cutover.sql.gz .

{ echo 'SET ROLE immich;'
  gunzip --stdout immich-cutover.sql.gz \
  | sed "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g"
} | kubectl -n immich exec -i immich-database-1 -c postgres -- \
    psql --dbname=immich --single-transaction --set ON_ERROR_STOP=on
```

The `sed` line is from Immich's own restore procedure. `--single-transaction`
with `ON_ERROR_STOP` means a failure leaves the database empty rather than
half-loaded; fix the cause and run it again.

**Verify**

```sh
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -Atc \
  'SELECT count(*) FROM asset;'                       # matches the count on Compose
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -c '\dx'
#   vchord at 1.1.x, vector, earthdistance, cube; no "vectors"
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -Atc \
  "SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' GROUP BY 1;"
#   every table owned by immich
```

---

## 7. Install Immich

`apps/immich/release.yaml`:

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: OCIRepository
metadata:
  name: immich
  namespace: immich
spec:
  interval: 12h
  url: oci://ghcr.io/immich-app/immich-charts/immich
  ref:
    tag: 0.13.4
---
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: immich
  namespace: immich
spec:
  interval: 30m
  chartRef:
    kind: OCIRepository
    name: immich
  values:
    # Applied to every Immich component.
    controllers:
      main:
        containers:
          main:
            image:
              tag: v3.3.6                      # same as Compose; bump deliberately
            env:
              TZ: Asia/Manila
              DB_HOSTNAME:
                valueFrom: {secretKeyRef: {name: immich-database-app, key: host}}
              DB_USERNAME:
                valueFrom: {secretKeyRef: {name: immich-database-app, key: user}}
              DB_PASSWORD:
                valueFrom: {secretKeyRef: {name: immich-database-app, key: password}}
              DB_DATABASE_NAME:
                valueFrom: {secretKeyRef: {name: immich-database-app, key: dbname}}

    immich:
      persistence:
        library:
          existingClaim: immich-library

    valkey:
      enabled: true

    server:
      controllers:
        main:
          strategy: Recreate                   # one writer on the library volume
          pod:
            nodeSelector:
              kubernetes.io/hostname: core-2   # where the library is
          containers:
            main:
              resources:
                requests: {cpu: 200m, memory: 512Mi}
                limits: {memory: 3Gi}

    machine-learning:
      controllers:
        main:
          pod:
            affinity:
              nodeAffinity:
                preferredDuringSchedulingIgnoredDuringExecution:
                  - weight: 100
                    preference:
                      matchExpressions:
                        - {key: lab.ejsadiarin.com/class, operator: In, values: [compute]}
          containers:
            main:
              resources:
                requests: {cpu: 200m, memory: 1Gi}
                limits: {memory: 4Gi}
      persistence:
        cache:
          enabled: true
          type: persistentVolumeClaim
          size: 10Gi
          accessMode: ReadWriteOnce            # longhorn: follows the pod between nodes
```

The chart is built on the bjw-s common library, and where pod-level settings
go depends on that library's version. Before pushing, render it and check the
three things that matter:

```sh
helm template immich oci://ghcr.io/immich-app/immich-charts/immich --version 0.13.4 \
  -n immich -f values.yaml > /tmp/immich.yaml
grep -n -A3 'nodeSelector' /tmp/immich.yaml          # server pinned to core-2
grep -n -B2 -A2 'mountPath: /data' /tmp/immich.yaml  # library mounted at /data
grep -n 'DB_HOSTNAME' /tmp/immich.yaml               # present on the server
```

If the library is mounted anywhere other than `/data`, stop: the paths in the
database (section 3.4) must match the mount.

The route, `apps/immich/route.yaml`:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: immich
  namespace: immich
spec:
  parentRefs: [{name: internal, namespace: gateway, sectionName: https}]
  hostnames: [immich.lab.ejsadiarin.com]
  rules:
    - backendRefs: [{name: immich-server, port: 2283}]
      timeouts:
        request: 0s                # no cap: large video uploads take minutes
```

Check the Service name with `kubectl -n immich get svc` after the first
reconcile and adjust the `backendRefs` if the chart named it differently.

Commit and push. Flux applies the release; the first start runs any pending
schema migrations against the restored database.

```sh
flux reconcile kustomization apps --with-source
kubectl -n immich get pods -w
kubectl -n immich logs deploy/immich-server -f
```

---

## 8. Verify

```sh
kubectl -n immich get pods -o wide
#   immich-server on core-2, machine-learning on core-1, valkey, immich-database-1 on core-2
kubectl -n immich exec deploy/immich-server -- ls /data
#   library upload profile thumbs encoded-video backups
curl -sI https://immich.lab.ejsadiarin.com | head -1          # 200
```

In the web UI at `https://immich.lab.ejsadiarin.com`:

1. Log in with your existing account. The timeline shows every photo with
   thumbnails.
2. Open an old photo and an old video at full size: proves originals are read
   from the mounted library.
3. Albums, people and shared links are all present: proves the database.
4. Search for something by content ("beach"): proves the search index and the
   machine-learning pod.
5. **Administration → Settings → Server → External domain**: set it to
   `https://immich.lab.ejsadiarin.com` so shared links use the new name.
6. **Administration → Settings → Storage Template**: still enabled, same
   template.
7. Upload one photo from the web. On `core-2`:

   ```sh
   find "<LIBRARY_PATH>/library" -newermt '-10 minutes' -type f
   ```

   The new file appears under your template's folders with the same ownership
   as its neighbours.
8. Phone app: log out, set the server URL to `https://immich.lab.ejsadiarin.com`,
   log in, and let a backup run. The phone must have Tailscale on, at home
   and away: the internal Gateway is tailnet-only.

If search returns errors about indexes after the version jump:

```sh
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich \
  -c 'REINDEX INDEX face_index;' -c 'REINDEX INDEX clip_index;'
```

---

## 9. Rollback

Compose is untouched until you remove it, so going back takes minutes.

```sh
# 1. Stop the cluster copy so two servers never write to one library
flux suspend helmrelease -n immich immich
kubectl -n immich scale deploy --all --replicas=0

# 2. Start Compose again on core-2
cd ~/services/immich && docker compose up -d
```

The old database directory (`DB_DATA_LOCATION`) was never modified; it is
exactly as it was at cutover.

Anything uploaded to the cluster copy between cutover and rollback exists as
files under `library/` but is unknown to the old database. Find those files
with the `find -newermt` command from section 8 and re-upload them through
Compose Immich, then delete the strays.

**Never run both at once against the same library.**

---

## 10. After the move

### Backups

| Data | Covered by |
|---|---|
| Originals (`library/`, `upload/`, `profile/`) | Existing restic job on `core-2`. Keep `<LIBRARY_PATH>` in its include list; nothing about it changed |
| Database, continuous | CloudNativePG to `b2://<B2_CLUSTER_BUCKET>/cnpg/immich`, 30-day retention, point-in-time recovery |
| Database, portable dump | Immich's nightly job still writes into `library/backups`, which restic carries offsite |

Confirm the first scheduled CNPG backup:

```sh
kubectl -n immich get backup                     # phase: completed
kubectl -n immich get cluster immich-database -o jsonpath='{.status.conditions}' | jq
#   ContinuousArchiving: True
```

Restoring the database from B2 into a new cluster (same name, empty volume):

```yaml
spec:
  bootstrap:
    recovery:
      source: origin
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: immich-b2
          serverName: immich-database
```

A cluster restored this way must archive to a **different** `serverName` or
path than the one it was restored from; set `serverName` in the `plugins`
parameters to a new value.

### Decommission Compose

After two weeks without problems and one successful restic and CNPG backup:

1. Remove the Immich service from `core-infra/immich/` (or leave the file with
   a note that it is retired).
2. Archive, then delete, the old database directory:

   ```sh
   sudo tar -C ~/services/immich -czf /mnt/Backups/immich-pg14-final.tgz postgres
   sudo rm -rf ~/services/immich/postgres
   ```

3. Remove the `immich_model-cache` Docker volume and the `immich.local`
   Traefik labels.

**Do not delete `<LIBRARY_PATH>`.** It is the live library.

### Upgrading Immich from now on

1. Read the release notes.
2. Change `image.tag` in `apps/immich/release.yaml`. Bump the chart version
   only when its notes say the new Immich version needs it.
3. Push, watch `kubectl -n immich logs deploy/immich-server -f` through the
   migration.

Renovate will open the pull request; do not automerge Immich.

### Optional: hardware acceleration

Off today, and off here. Both nodes have Intel graphics with Quick Sync. To
use it, install the Intel GPU device plugin, request
`gpu.intel.com/i915: 1` on the server (transcoding) or use the `-openvino`
machine-learning image, and enable it under **Administration → Settings →
Video Transcoding**. Worth doing only if transcoding or face detection queues
are slow.

### If DNS lookups fail inside Immich pods

Immich's documentation notes a resolver problem on clusters whose nodes have a
`search` domain in `/etc/resolv.conf`. If the server cannot resolve the
database or machine-learning names, remove the `search` line on the nodes or
set `dnsConfig.options: [{name: ndots, value: "1"}]` on the pods.
