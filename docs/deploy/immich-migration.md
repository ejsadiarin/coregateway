# Immich: Docker Compose to k3s

Moves the existing Immich install on `core-2` (the N100) into the cluster
built in [`homelab-k3s.md`](./homelab-k3s.md). The photos and videos do not
move: the cluster mounts the directory they are already in. Only the database
is "restored": dumped from Compose and loaded into the cluster's Postgres.

`core-2` is the Kubernetes node name of the machine whose hostname is
`homelab` today. `ssh core-2` below means a shell on that machine.

Prerequisites:

1. The restore drill in [`immich-restore-drill.md`](./immich-restore-drill.md)
   has passed. Do not change how Immich runs before you have proved the backup
   can rebuild it.
2. Sections 1–13 of the main guide are done and verified (CloudNativePG,
   `local-path-retain`, the internal Gateway, tailnet access and DNS).

Once Immich runs in the cluster, backups and every kind of restore are in
[`immich-k3s-backup-restore.md`](./immich-k3s-backup-restore.md).

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
| Photos and videos | `/home/ejs/services/immich/library` on `core-2`'s NVMe, about 181 GB | Same directory, mounted through a static local volume. Nothing is copied |
| Server | `immich_server` container | Official Helm chart, pinned to `core-2` |
| Machine learning | `immich_machine_learning` | Same chart, prefers `core-1` (the i5) |
| Redis | `redis:6.2` container | Valkey from the chart, no persistence |
| Database | `immich_postgres`, Postgres 14.19 + VectorChord 0.4.3, superuser `postgres`, 341 MB | CloudNativePG, Postgres 18 + VectorChord 1.1.1, on `core-2`'s SSD |
| Library mount inside the container | `/usr/src/app/upload` (Compose file from an older release) | `/data` (fixed by the chart) |
| URL | `immich.local.ejsadiarin.com` via Traefik (tailnet address, public DNS record) | `immich.lab.ejsadiarin.com` via the internal Gateway (tailnet devices only) |
| Media backup | restic on the host, run by hand | Same job, on a timer |
| Database backup | Immich's nightly dump into `library/backups` | That, plus continuous backup to B2 |

State and versions checked 2026-11-15: Immich `v3.4.1` is both the latest
release and what Compose runs (its tag floats on `release`). Chart `0.13.4`
has a default image tag of `v3.2.0`, so the tag is set explicitly. Immich's
image carries Postgres clients for 14 to 18 and supports VectorChord 0.3 up
to, not including, 2.0.

The move and an Immich upgrade never happen together: Compose is first pinned
to the exact version the cluster will run.

The riskiest step is loading a Postgres 14 dump into Postgres 18 with a newer
VectorChord. That was rehearsed on 2026-11-15: the live nightly dump was
loaded into a throwaway `cloudnative-vectorchord:18.6-1.1.1` container with
the command from section 6.3. It took 17 seconds with no errors; all 49,215
assets, both search indexes and `vchord` 1.1.1 were present, and every table
was owned by `immich`.

---

## 2. Your files are not locked in

The storage template is on (`{{y}}/{{album}}/{{filename}}`), so nearly every
original is a normal file under a readable path:

```
/home/ejs/services/immich/library/
├── library/admin/<year>/<album>/IMG_1234.jpg   ← originals (49,040). Open these with anything
├── upload/<user-id>/…                          ← mobile uploads in flight
├── profile/<user-id>/…                         ← avatars
├── thumbs/…                                    ← generated previews, can be rebuilt
├── encoded-video/…                             ← generated transcodes, plus motion-photo videos
└── backups/…                                   ← nightly database dumps
```

Two things in that tree are not what the folder names suggest (2026-11-15):

- `encoded-video/` also holds the video halves of 144 motion photos. Immich
  tracks them as assets, so the folder is not purely "can be rebuilt". Back
  it up with the rest.
- `upload/` still holds 31 assets the template has not moved, and 109 files
  (5.6 GB) the database does not reference at all: leftovers from interrupted
  uploads. They are harmless. Do not clean them up during the migration.

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

### 3.1 Confirm the library path

`<LIBRARY_PATH>` below is `/home/ejs/services/immich/library`. It sits on the
root NVMe; no data drives are attached to this machine today.

```sh
cd ~/services/immich
docker inspect immich_server \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
#   /home/ejs/services/immich/library -> /usr/src/app/upload   (today)
df -h /home/ejs/services/immich/library            # the root filesystem
```

If you later move the library to a separate drive, that drive must be in
`/etc/fstab` (main guide, section 3) and `<LIBRARY_PATH>` changes with it.

### 3.2 Confirm a fresh backup exists

```sh
ls -lt ~/services/immich/library/backups | head -3     # a dump from the last 24 h
source ~/services/restic/restic-env
sudo -E restic snapshots --latest 1                    # from the last 24 h
```

Do not continue without both. If the snapshot is older, run `,backup-homelab`
now.

### 3.3 Pin the version and replace the Compose file

Compose runs `v3.4.1` through a floating tag. Pin it, so nothing upgrades
underneath the migration:

```sh
grep -q '^IMMICH_VERSION=' .env \
  && sed -i 's/^IMMICH_VERSION=.*/IMMICH_VERSION=v3.4.1/' .env \
  || echo 'IMMICH_VERSION=v3.4.1' >> .env
```

The `docker-compose.yml` in `core-infra` is from an older release. It differs
from the `v3.4.1` file in three ways that matter:

| | Yours | `v3.4.1` release file |
|---|---|---|
| Library mount | `${UPLOAD_LOCATION}:/usr/src/app/upload` | `${UPLOAD_LOCATION}:/data` |
| Cache | `redis:6.2-alpine` | `valkey/valkey:9` |
| Database image | Same tag, no digest | Same tag, pinned by digest |

Replace the file with the release's, then put back what is yours: the Traefik
labels on `immich-server`, `networks: [proxy]` on all four services, and the
top-level `networks:` block.

```sh
cp docker-compose.yml docker-compose.old.yml
curl -L -o docker-compose.new.yml \
  https://github.com/immich-app/immich/releases/download/v3.4.1/docker-compose.yml
diff docker-compose.old.yml docker-compose.new.yml     # merge labels and networks by hand
mv docker-compose.new.yml docker-compose.yml
docker compose up -d --remove-orphans
docker compose logs -f immich-server
```

Changing the mount to `/data` changes where Immich looks for every file.
Immich notices at startup and rewrites the paths in the database itself. In
the log, expect:

```
Media location changed (from=/usr/src/app/upload, to=/data)
Detected a change to media location, performing an automatic migration of file paths ...
```

Why it has not happened already: when both `/data` and `/usr/src/app/upload`
exist in the container, Immich keeps using the old one. Today both exist (the
image always has `/data`; your Compose file adds the other). Once the library
is mounted at `/data`, only that path exists and Immich switches.

Take a new database dump afterwards (**Administration → Job Queues → Create
job → Create Database Dump**) and run `,backup-homelab`, so the newest backup
matches the new paths.

### 3.4 Check the paths stored in the database

```sh
docker exec immich_postgres psql -U postgres -d immich -Atc \
  'SELECT "originalPath" FROM asset LIMIT 3;'
```

- Paths start with `/data/` → good. Open the web UI and view a photo and a
  video before going on.
- Paths still start with `/usr/src/app/upload/` → the automatic rewrite did
  not run. Check that the mount is `/data` (the `docker inspect` command in
  3.1), then run it by hand and restart:

  ```sh
  docker exec -it immich_server immich-admin change-media-location
  #   previous value: /usr/src/app/upload      new value: /data
  docker compose restart immich-server
  ```

If you skip 3.3 altogether, the cluster's first start performs the same
rewrite, because the chart mounts the library at `/data`. Doing it on Compose
first keeps the two changes apart, and keeps rollback (section 9) trivial.

### 3.5 Check the extensions

```sh
docker exec immich_postgres psql -U postgres -d immich -c '\dx'
```

Checked 2026-11-15: `vchord` 0.4.3, `vector`, `earthdistance`, `cube`,
`pg_trgm`, `unaccent`, `uuid-ossp`. The old **`vectors`** extension
(pgvecto.rs, with an "s") is gone, which is what the new database needs. An
empty schema named `vectors` is still there and is carried over by the dump;
it does no harm.

If `vectors` ever shows up in `\dx` again, remove it before dumping:

```sh
docker exec immich_postgres psql -U postgres -d immich -c 'DROP EXTENSION vectors;'
```

### 3.6 Record ownership

```sh
stat -c '%u:%g' ~/services/immich/library/library      # 0:0
```

Checked 2026-11-15: `0:0`. Compose runs Immich as root, and so does the chart
by default, so new files will match old ones with no extra setting.

### 3.7 Record a baseline

Section 8 compares against these numbers.

```sh
docker exec immich_postgres psql -U postgres -d immich -At -c "
  select 'assets',  count(*) from asset
  union all select 'albums', count(*) from album
  union all select 'faces',  count(*) from asset_face
  union all select 'users',  count(*) from \"user\";"
```

On 2026-11-15: 49,215 assets, 44 albums, 1,941 faces, 1 user.

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
    path: /home/ejs/services/immich/library      # <LIBRARY_PATH>
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

The path is on `core-2`'s root disk, so it is always there when the node is
up. The node name in `nodeAffinity` must match `kubectl get nodes` exactly.
It comes from `node-name` in the k3s config (main guide, section 6); if the
N100 joined under another name, the volume never binds.

Guards against writing to the wrong place:

1. Immich keeps a hidden `.immich` marker file in each of the six folders and
   refuses to start if one is gone.
2. If the library later moves to a separate drive, `<LIBRARY_PATH>` must be a
   directory **inside** the mounted filesystem, not the mount point itself.
   With the drive missing, the path then does not exist and the pod fails to
   start instead of writing to the root disk.

The library shares the 477 GB disk with the OS, Docker, the database volume
and Longhorn's replicas (main guide, section 10.2). On 2026-11-15 the disk was
67 % full with 147 GB free.

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
kubectl -n immich get svc immich-database-rw       # the address Immich connects to
kubectl -n immich exec immich-database-1 -c postgres -- psql -c '\du immich'
#   attributes include Superuser
kubectl -n immich exec immich-database-1 -c postgres -- \
  psql -d immich -c "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('vchord','vector');"
```

If `immich` is not a superuser, the operator did not apply the managed role to
the bootstrap owner. Grant it by hand
(`psql -c 'ALTER ROLE immich SUPERUSER;'`) and keep going.

There is no `immich-database-app` Secret. The operator generates one only
when it invents the password itself; here the password comes from
`immich-db-owner`, which lives in Git (encrypted). That is deliberate: the
password survives a rebuild of the cluster, so a restored database and a
reinstalled Immich still agree. Section 7 reads the credentials from
`immich-db-owner` for that reason.

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
docker exec immich_postgres pg_dump --clean --if-exists \
  --no-owner --no-privileges \
  --dbname=immich --username=postgres \
  | gzip > ~/immich-cutover.sql.gz
ls -lh ~/immich-cutover.sql.gz                    # about 60 MB
gunzip -t ~/immich-cutover.sql.gz && echo archive ok
```

`--no-owner` makes everything belong to whoever restores it. Without it, every
table would be owned by `postgres` in the new cluster and not by `immich`.

Keep this file until the decommission in section 10. Together with the
untouched `postgres` directory it is your way back.

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
half-loaded; fix the cause and run it again. Expect it to finish in under a
minute (17 seconds in the 2026-11-15 rehearsal).

**Verify**

```sh
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -Atc \
  'SELECT count(*) FROM asset;'                       # matches the baseline from 3.7
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
              tag: v3.4.1                      # same as Compose; bump deliberately
            env:
              TZ: Asia/Manila
              DB_HOSTNAME: immich-database-rw    # Service created by CloudNativePG
              DB_DATABASE_NAME: immich
              DB_USERNAME:
                valueFrom: {secretKeyRef: {name: immich-db-owner, key: username}}
              DB_PASSWORD:
                valueFrom: {secretKeyRef: {name: immich-db-owner, key: password}}

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

The chart mounts the library claim at `/data` by default. If the rendered
output shows anything else, stop: the paths in the database (section 3.4)
must match the mount.

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
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -Atc \
  'SELECT "originalPath" FROM asset LIMIT 1;'                 # starts with /data/
```

Then prove the cluster's database and the files on disk still agree. Immich
stores a SHA-1 of every original at upload; recompute them all on `core-2`:

```sh
# laptop
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -At -c \
  "select encode(checksum,'hex') || '  ' || \"originalPath\" from asset where not \"isExternal\";" \
  | sed 's#  /data/#  /home/ejs/services/immich/library/#' > immich-sha1.txt
wc -l < immich-sha1.txt                                       # the asset count from 3.7
scp immich-sha1.txt core-2:/tmp/
ssh core-2 'sudo sha1sum --quiet -c /tmp/immich-sha1.txt; echo "exit=$?"'
#   no output and exit=0: every photo and video is present and unchanged
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
| Everything under `<LIBRARY_PATH>` | The restic job on `core-2` (`,backup-homelab`). `~/services/immich` stays in its target list; nothing about the path changed |
| Database, continuous | CloudNativePG to `b2://<B2_CLUSTER_BUCKET>/cnpg/immich`, 30-day retention, point-in-time recovery |
| Database, portable dump | Immich's nightly job still writes into `library/backups`, which restic carries offsite |

Confirm the first scheduled CNPG backup and the first nightly dump written
from the cluster:

```sh
kubectl -n immich get backup                     # phase: completed
kubectl -n immich get cluster immich-database -o jsonpath='{.status.conditions}' | jq
#   ContinuousArchiving: True
ssh core-2 'ls -lt ~/services/immich/library/backups | head -2'
#   a dump named ...-pg18.x.sql.gz from last night
```

Day-to-day checks and every restore path (one bad day, a lost database
volume, a lost library, a lost node) are in
[`immich-k3s-backup-restore.md`](./immich-k3s-backup-restore.md). Run its
database drill (section 7) once before decommissioning Compose.

### Decommission Compose

After two weeks without problems, one successful restic run, one successful
CNPG backup and one passed database drill:

1. Remove the Immich containers and leave a note in `core-infra/immich/` that
   the Compose file is retired:

   ```sh
   cd ~/services/immich && docker compose down
   ```

   Keep `docker-compose.yml` and `.env` in place: restic still backs them up,
   and they are the way back to Compose if you ever leave the cluster.
2. Delete the old database directory. `~/immich-cutover.sql.gz` (60 MB) is
   the archive of it; move that file into `~/services/immich/` so restic keeps
   a copy, then:

   ```sh
   sudo rm -rf ~/services/immich/postgres
   ```

3. Remove the `immich_model-cache` Docker volume. The `immich.local` Traefik
   labels go away with the containers.

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
