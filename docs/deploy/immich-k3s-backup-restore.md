# Immich in k3s: backup and restore

Runbook for Immich once it runs in the cluster, as set up by
[`immich-migration.md`](./immich-migration.md) on the platform from
[`homelab-k3s.md`](./homelab-k3s.md). For the Compose install, use
[`immich-restore-drill.md`](./immich-restore-drill.md) instead.

- [1. Where the data lives](#1-where-the-data-lives)
- [2. What backs it up](#2-what-backs-it-up)
- [3. Weekly check](#3-weekly-check)
- [4. Before a risky change](#4-before-a-risky-change)
- [5. Which restore do I need](#5-which-restore-do-i-need)
- [6. Restores](#6-restores)
- [7. Drills](#7-drills)
- [8. Verify after any restore](#8-verify-after-any-restore)
- [9. Secrets a restore needs](#9-secrets-a-restore-needs)
- [10. Troubleshooting](#10-troubleshooting)

Names used throughout, all from the migration guide:

| Thing | Name |
|---|---|
| Namespace | `immich` |
| Helm release, server Deployment | `immich`, `immich-server` |
| Database cluster, its pod, its Service | `immich-database`, `immich-database-1`, `immich-database-rw` |
| Backup store definition | `ObjectStore` `immich-b2` → `s3://<B2_CLUSTER_BUCKET>/cnpg/immich` |
| Library on `core-2` | `/home/ejs/services/immich/library`, mounted in the pod at `/data` |
| Manifests | `core-infra/apps/immich/` |

---

## 1. Where the data lives

| Data | Where | If it is lost |
|---|---|---|
| Originals, sidecars, motion-photo videos | Plain files under the library directory on `core-2`'s NVMe | Gone unless restored from restic. **The only irreplaceable part** |
| Thumbnails, previews, transcodes | Same directory (`thumbs/`, `encoded-video/`) | Immich can regenerate them; hours of CPU |
| Albums, faces, favourites, users, every file's path | Postgres, on a `local-path-retain` volume on `core-2` | Photos survive as files, with no albums and no timeline until the database is restored |
| Nightly database dumps | `library/backups/` (inside the library directory) | Only a convenience copy |
| Machine-learning models, Valkey queue | Longhorn volume, memory | Download and rebuild themselves |
| Everything that defines the install | Git (`core-infra`), secrets encrypted with sops | Re-applied by Flux |

Library and database sit on the same disk of the same node. One dead NVMe
takes both. Everything below exists because of that sentence.

---

## 2. What backs it up

| What | How | Where | When | Keeps |
|---|---|---|---|---|
| Library directory, all of it | restic on `core-2` (`,backup-homelab`) | The restic B2 bucket | 03:00 by timer | Everything, until you prune |
| Database, continuous | CloudNativePG + Barman Cloud plugin: base backup plus every WAL segment | `<B2_CLUSTER_BUCKET>/cnpg/immich` | Base at 03:00, WAL within minutes | 30 days, any second in that window |
| Database, portable dump | Immich's own job | `library/backups/`, then B2 through restic | 02:00 | Last 14 |
| Manifests and encrypted secrets | Git | GitHub | Every push | Full history |

Three independent copies of the database, two tools, two buckets. The dump at
02:00 is the one that still works with no cluster at all: it is a plain SQL
file that any Postgres 18 can load.

The restic timer is described in
[`immich-restore-drill.md`](./immich-restore-drill.md) section 12. Without it
the library is backed up only when you remember to run the script.

What is **not** backed up, on purpose: the raw Postgres volume under
`/opt/local-path-provisioner` (copying live database files gives a corrupt
copy; the two database backups above replace it) and the model cache.

---

## 3. Weekly check

Five commands. Each one has a single right answer.

```sh
# 1. Database healthy
kubectl -n immich get cluster immich-database
#    STATUS: Cluster in healthy state

# 2. Last night's base backup finished
kubectl -n immich get backup --sort-by=.metadata.creationTimestamp | tail -3
#    newest row: PHASE completed, dated today

# 3. WAL archiving is flowing
kubectl -n immich get cluster immich-database \
  -o jsonpath='{.status.conditions[?(@.type=="ContinuousArchiving")].status}{"\n"}'
#    True

# 4. Last night's dump exists
ssh core-2 'ls -lt ~/services/immich/library/backups | head -2'
#    immich-db-backup-<today>T020000-...-pg18.x.sql.gz, about 60 MB

# 5. Last night's restic run happened
ssh core-2 'source ~/services/restic/restic-env && sudo -E restic snapshots --latest 1'
#    a snapshot from today, 03:00
```

A failed or missing answer is a broken backup, even though Immich itself
looks fine. Fix it the same day.

---

## 4. Before a risky change

Before an Immich upgrade, a chart bump, or anything that touches the database
image:

```sh
STAMP=$(date +%Y%m%d-%H%M)

# 1. On-demand base backup to B2
kubectl apply -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: immich-pre-change-$STAMP
  namespace: immich
spec:
  cluster: {name: immich-database}
  method: plugin
  pluginConfiguration:
    name: barman-cloud.cloudnative-pg.io
EOF
kubectl -n immich get backup immich-pre-change-$STAMP -w      # wait for: completed

# 2. Write this down. It is the point to return to if the change goes wrong.
date -u +%Y-%m-%dT%H:%M:%SZ
```

Then, in the web UI: **Administration → Job Queues → Create job → Create
Database Dump**. That gives a dump made by the old version, which section 6.1
can load.

Make the change only after both exist.

---

## 5. Which restore do I need

| What happened | Go to | Downtime | Data lost |
|---|---|---|---|
| An upgrade or a mistake damaged the database; files are fine | 6.1 (last dump) or 6.2 (exact time) | 15 min | Database changes after the chosen point |
| The database volume is gone or corrupt; files are fine | 6.2, no target time | 30 min | Nothing: WAL is replayed to the last archived segment |
| Photos were deleted or damaged on disk; database is fine | 6.3 | Minutes to hours | Files added after the last restic snapshot |
| `core-2` died (its disk held both) | 6.4 | Hours (181 GB download) | Files added after the last restic snapshot |
| Both nodes are gone | 6.5 | A day | Same |
| You want out of Kubernetes | 6.6 | An evening | Nothing |

"Files added after the last restic snapshot" are usually still on the phone.
After any restore, open the phone app and let it run a backup.

---

## 6. Restores

Every restore starts by stopping Immich, so nothing writes while data is
being replaced, and ends with section 8.

```sh
# Stop Immich
flux suspend helmrelease -n immich immich
kubectl -n immich scale deploy/immich-server --replicas=0
kubectl -n immich get pods                    # no immich-server pod left

# Start Immich
flux resume helmrelease -n immich immich
kubectl -n immich scale deploy/immich-server --replicas=1
kubectl -n immich logs deploy/immich-server -f
```

### 6.1 Roll the database back to a nightly dump

For "the upgrade broke it" and "I deleted the wrong album". Uses a dump from
`library/backups/`.

First take an on-demand backup (section 4, step 1), so this restore can
itself be undone.

**Option A: in the web UI.** Immich stays running.

1. **Administration → Maintenance → Restore database backup**.
2. Pick the dump. A green mark means it was written by the running version.
3. **Restore**, confirm. Immich makes a restore point first and rolls back to
   it if the restore fails.

**Option B: by command.** Use it when the web UI does not load. Stop Immich
first.

```sh
DUMP=<file name from: ssh core-2 'ls -t ~/services/immich/library/backups'>

kubectl -n immich exec immich-database-1 -c postgres -- psql \
  -c 'DROP DATABASE immich WITH (FORCE);' \
  -c 'CREATE DATABASE immich OWNER immich;'

{ echo 'SET ROLE immich;'
  ssh core-2 "sudo cat ~/services/immich/library/backups/$DUMP" | gunzip --stdout \
  | sed -e "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g" \
        -e '/ OWNER TO [^ ]*;$/d'
} | kubectl -n immich exec -i immich-database-1 -c postgres -- \
    psql --dbname=immich --single-transaction --set ON_ERROR_STOP=on
echo "psql exit=$?"                           # 0
```

The second `sed` expression drops the dump's ownership lines, so every table
belongs to `immich` whichever user wrote the dump. This exact pipeline was
run on 2026-11-15 against the live nightly dump and a Postgres 18.6 +
VectorChord 1.1.1 container: 17 seconds, no errors, 49,215 assets.

Start Immich. The dump must come from the same Immich version that is
running, or an older one; Immich migrates an older database forward on start
and cannot go backwards.

### 6.2 Restore the database from B2

For a lost database volume, or to return to an exact second within the last
30 days. CloudNativePG never restores in place: it builds a new cluster from
the base backup and replays WAL. The cluster keeps its name; its volume is
new.

1. Stop Immich, and stop Flux from applying `apps` until step 3:

   ```sh
   flux suspend kustomization apps
   ```

   This matters. If Flux applied the edited file to the cluster that is still
   running, that cluster would start writing under the new name, and the new
   name would no longer be empty.

2. In `core-infra/apps/immich/database.yaml`, change the `Cluster` in three
   places:

   ```yaml
   spec:
     bootstrap:                       # replaces the whole initdb block
       recovery:
         source: origin
         database: immich
         owner: immich
         secret: {name: immich-db-owner}
         # Only to stop at an exact time. Leave out to replay everything.
         recoveryTarget:
           targetTime: "2026-12-01T14:30:00Z"

     externalClusters:                # new block: where to read from
       - name: origin
         plugin:
           name: barman-cloud.cloudnative-pg.io
           parameters:
             barmanObjectName: immich-b2
             serverName: immich-database        # the name the backups were written under

     plugins:
       - name: barman-cloud.cloudnative-pg.io
         isWALArchiver: true
         parameters:
           barmanObjectName: immich-b2
           serverName: immich-database-g2       # NEW name to write under from now on
   ```

   The restored cluster must write its backups under a name that has never
   been used: it refuses to archive into a folder that already has files.
   Count up on each restore (`-g2`, `-g3`, …). The **next** restore then reads
   from the name you set here: `externalClusters…serverName` becomes
   `immich-database-g2`. Write the current name in a comment in that file.

3. Commit, push, and swap the cluster:

   ```sh
   kubectl -n immich delete cluster immich-database     # pod and claim go; see below
   flux resume kustomization apps
   flux reconcile kustomization apps --with-source
   kubectl -n immich get cluster immich-database -w
   #   Setting up primary → Cluster in healthy state
   ```

   Deleting the cluster deletes its claim, not its data: the storage class is
   `local-path-retain`, so the old database files stay on `core-2` under
   `/opt/local-path-provisioner/` as a `Released` volume. That is your undo
   until you remove it in step 5.

4. Check, then start Immich:

   ```sh
   kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -Atc \
     'SELECT count(*) FROM asset;'
   kubectl -n immich get cluster immich-database \
     -o jsonpath='{.status.conditions[?(@.type=="ContinuousArchiving")].status}{"\n"}'   # True
   ```

5. A week later, remove the old volume:

   ```sh
   kubectl get pv | grep Released                       # the old immich-database-1 volume
   kubectl delete pv <name>
   ssh core-2 'sudo ls /opt/local-path-provisioner/'    # delete the matching directory
   ```

Leave the `recovery` block in Git afterwards. It is read only when a cluster
is created, so it does nothing to the running one, and it is what a rebuild
from Git needs anyway (section 6.5).

If B2 has no usable backup, fall back to the dump: keep the original `initdb`
block (still give `plugins…serverName` a new value), let the empty cluster
come up, and load the newest dump with 6.1 option B. Do not start Immich in
between: it would create a fresh schema in the empty database.

### 6.3 Restore photos and videos

For files deleted or damaged on disk while the database is intact. On
`core-2`, with Immich stopped:

```sh
source ~/services/restic/restic-env
sudo -E restic snapshots                               # pick one from before the damage
SNAP=<snapshot ID>

# Everything:
sudo -E restic restore "$SNAP" --target / \
  --include /home/ejs/services/immich/library --verify

# Or one folder:
sudo -E restic restore "$SNAP" --target / \
  --include /home/ejs/services/immich/library/library/admin/2024 --verify
```

Restoring over an existing library is safe: restic rewrites only files whose
content differs from the snapshot and leaves the rest alone.

The database is now newer than the files. Photos uploaded after the snapshot
are in the database and missing on disk. Section 8.2 lists exactly which
ones; they are usually still on the phone. Start Immich and let the phone
back up again.

### 6.4 `core-2` is lost

The node's disk held the library and the database. `core-1` and the control
plane are still up.

1. **Replace the machine.** Debian, then the main guide's section 3. The
   hostname must be `core-2`: the library volume and the database are pinned
   to that node name.

2. **Restore the library first.** It is the long step; start it before
   anything else. Follow [`immich-restore-drill.md`](./immich-restore-drill.md)
   sections 3, 5 and 6 on the new machine, restoring the whole of
   `/home/ejs/services/immich`. Leave it running in `tmux`.

3. **Rejoin the cluster.** A reinstalled machine is rejected under its old
   name until the old node record is removed:

   ```sh
   kubectl delete node core-2
   kubectl -n kube-system delete secret core-2.node-password.k3s --ignore-not-found
   ```

   Then the main guide's section 6 (agent install, node label).

4. **Keep Immich stopped** until the library restore has finished and
   verified:

   ```sh
   flux suspend helmrelease -n immich immich
   kubectl -n immich scale deploy/immich-server --replicas=0
   ```

5. **Restore the database** with section 6.2, no target time. Database
   changes are replayed up to the last WAL segment that reached B2, normally
   within minutes of the failure. The old claim points at a disk that no
   longer exists; deleting the cluster in 6.2 step 3 clears it. If the delete
   hangs, remove the stuck volume by hand:
   `kubectl get pv | grep immich-database`, then `kubectl delete pv <name>`.

6. **Check the library volume bound**, then start Immich:

   ```sh
   kubectl get pv immich-library                        # Bound
   ssh core-2 'find ~/services/immich/library -maxdepth 2 -name .immich | wc -l'   # 6
   ```

7. **Put the backup back.** The restic credentials, the script and the timer
   lived on the dead disk. Reinstall them
   ([`immich-restore-drill.md`](./immich-restore-drill.md) section 12) and run
   one backup the same day.

Longhorn rebuilds its replicas on the new `core-2` by itself. Compose
services that lived on the old machine (Traefik, Gitea, …) are restored from
the same restic snapshot.

### 6.5 The whole cluster is lost

Do the main guide's section 18 restore drill first. Then:

- If the etcd snapshot was restored and `core-2`'s disk survived, Immich comes
  back by itself: the volume records and the data are both still there.
- If the cluster was rebuilt from Git on empty disks, **edit
  `database.yaml` to the `recovery` form of section 6.2 before Flux applies
  `apps`.** With the original `initdb` block, a fresh cluster creates an empty
  database, and Immich would start as a brand-new install on top of your
  restored library. Then follow 6.4 from step 2.

### 6.6 Leave the cluster

The library is plain files and the nightly dump is plain SQL, so Compose is
always a way out. Stop Immich in the cluster, then on `core-2` follow
[`immich-restore-drill.md`](./immich-restore-drill.md) section 8 with the
files already in place. Two differences from the Compose-era drill:

- The dump is from Postgres 18 (`…-pg18.x.sql.gz`). The Compose database
  image must be a Postgres 18 build of `ghcr.io/immich-app/postgres`, not the
  `14-…` tag in the old Compose file.
- The paths in the database start with `/data/`, so the Compose file must
  mount the library at `/data`, as the current release file does.

---

## 7. Drills

A backup that has never been restored is a guess.

### 7.1 Database from B2: every three months, 15 minutes, no downtime

Builds a second, throwaway cluster from the B2 backup, next to the live one.
It has no `plugins` block, so it cannot write to the archive.

```sh
kubectl apply -f - <<'EOF'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: immich-drill
  namespace: immich
spec:
  instances: 1
  imageName: ghcr.io/tensorchord/cloudnative-vectorchord:18.6-1.1.1   # same as the live cluster
  storage:
    storageClass: local-path          # the deleting class: cleans up after itself
    size: 20Gi
  postgresql:
    shared_preload_libraries: ["vchord.so"]
  bootstrap:
    recovery:
      source: origin
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: immich-b2
          serverName: immich-database          # the name currently written under
EOF

kubectl -n immich get cluster immich-drill -w          # Cluster in healthy state

for c in immich-database immich-drill; do
  kubectl -n immich exec $c-1 -c postgres -- psql -d immich -Atc \
    "select '$c', count(*) from asset;"
done
#   the two counts match, give or take uploads from the last few minutes

kubectl -n immich delete cluster immich-drill
```

Use the `imageName` and `serverName` that `database.yaml` has at the time.

### 7.2 Nightly dump: every three months, 2 minutes

Proves the plain-SQL copy loads. Run on any machine with Docker; it starts a
database with no network and removes it afterwards.

```sh
DUMP=$(ls -t ~/services/immich/library/backups/immich-db-backup-*.sql.gz | head -1)
IMG=ghcr.io/tensorchord/cloudnative-vectorchord:18.6-1.1.1

docker run -d --rm --name immich-dump-drill --network none --shm-size 256mb \
  --user postgres --entrypoint bash $IMG -c \
  'initdb -D /tmp/pg -U postgres >/dev/null && exec postgres -D /tmp/pg -c shared_preload_libraries=vchord.so -c listen_addresses= -k /tmp'
until docker exec immich-dump-drill psql -h /tmp -U postgres -Atc 'select 1' >/dev/null 2>&1; do sleep 2; done
docker exec immich-dump-drill psql -h /tmp -U postgres -q \
  -c 'CREATE ROLE immich LOGIN SUPERUSER' -c 'CREATE DATABASE immich OWNER immich'

{ echo 'SET ROLE immich;'
  gunzip --stdout "$DUMP" \
  | sed -e "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g" \
        -e '/ OWNER TO [^ ]*;$/d'
} | docker exec -i immich-dump-drill psql -h /tmp -U postgres --dbname=immich \
      --single-transaction --set ON_ERROR_STOP=on >/dev/null
echo "psql exit=$?"                                    # 0

docker exec immich-dump-drill psql -h /tmp -U postgres -d immich -Atc 'select count(*) from asset;'
docker stop immich-dump-drill
```

### 7.3 Photos from restic: every month, 5 minutes

Restores one album to a scratch folder and compares it with the live files.

```sh
# core-2
source ~/services/restic/restic-env
ALBUM=/home/ejs/services/immich/library/library/admin/2024      # any folder
sudo -E restic restore latest --target /tmp/restic-drill --include "$ALBUM" --verify
sudo diff -rq "$ALBUM" "/tmp/restic-drill$ALBUM" && echo "identical"
sudo rm -rf /tmp/restic-drill
```

Files added since the last snapshot show as "Only in"; that is expected.

### 7.4 Everything: once a year

The full [`immich-restore-drill.md`](./immich-restore-drill.md) on another
machine, using section 6.6's two differences. It is the only drill that
proves the off-box credentials still work.

---

## 8. Verify after any restore

### 8.1 Counts

```sh
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -At -c "
  select 'assets',  count(*) from asset
  union all select 'albums', count(*) from album
  union all select 'faces',  count(*) from asset_face
  union all select 'users',  count(*) from \"user\";"
```

### 8.2 Database and files agree

Immich stores a SHA-1 of every original at upload. Recompute them all:

```sh
# laptop
kubectl -n immich exec immich-database-1 -c postgres -- psql -d immich -At -c \
  "select encode(checksum,'hex') || '  ' || \"originalPath\" from asset where not \"isExternal\";" \
  | sed 's#  /data/#  /home/ejs/services/immich/library/#' > immich-sha1.txt
scp immich-sha1.txt core-2:/tmp/
ssh core-2 'sudo sha1sum --quiet -c /tmp/immich-sha1.txt; echo "exit=$?"'
```

| Output | Meaning |
|---|---|
| Nothing, `exit=0` | Every photo and video is present and identical to what was uploaded |
| `…: FAILED open or read` | In the database, missing on disk. Expected after 6.3 and 6.4 for uploads newer than the restic snapshot. Re-upload from the phone, or delete the entries in Immich |
| `…: FAILED` | The file exists and its content changed: damage. Restore that file from an older snapshot (6.3) |

### 8.3 In the app

Timeline loads with thumbnails; an old photo opens at full size; a video
plays; albums are there; search returns results; the phone app connects and
its backup runs.

---

## 9. Secrets a restore needs

| Secret | Needed for | Lives in |
|---|---|---|
| restic: B2 key ID, application key, repository address, password | The library (6.3, 6.4) | `core-2`, **and** a copy off `core-2` |
| Cluster age key | Decrypting every secret in Git, including the two below | Off-cluster (main guide, section 7) |
| `b2-cnpg` (B2 key for the cluster bucket) | The database from B2 (6.2) | Git, sops-encrypted |
| `immich-db-owner` (database password) | Immich reaching a restored database | Git, sops-encrypted |

With the restic values and the age key in hand, and Git reachable, everything
in this document can be done from bare machines. Without either one, it
cannot. Both must exist somewhere that is not `core-2` and not the cluster.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ContinuousArchiving` is `False` | B2 key expired or revoked, or the bucket is unreachable | `kubectl -n immich logs immich-database-1 -c plugin-barman-cloud`; renew `b2-cnpg` |
| Restored cluster stuck with "Expected empty archive" | It is archiving under a `serverName` that already has files | Give `plugins…serverName` a new value (6.2, step 2) |
| Recovery pod fails because it finds no backup | `externalClusters…serverName` is not the name the backups were written under | Look in the bucket: `cnpg/immich/<serverName>/base/` |
| Recovery ends before the time you asked for | Target is newer than the last archived WAL | Use an earlier time, or leave `recoveryTarget` out |
| Immich pod: "password authentication failed" after a restore | The role's password in the restored data differs from `immich-db-owner` | `kubectl -n immich exec immich-database-1 -c postgres -- psql -c "ALTER ROLE immich PASSWORD '<value from the Secret>'"` |
| Immich pod crash-loops on ".immich" | The library is not mounted or a folder is empty | `ssh core-2 'ls -la ~/services/immich/library'`; finish the restic restore |
| `immich-library` volume stays `Available` or `Pending` | Node is not named `core-2`, or the claim was recreated and the volume still references the old one | `kubectl get nodes`; `kubectl patch pv immich-library --type json -p '[{"op":"remove","path":"/spec/claimRef/uid"}]'` |
| Agent on the rebuilt `core-2` logs "Node password rejected" | Old node record still exists | 6.4, step 3 |
| Nightly dump missing after the move to the cluster | The `immich` role is not a superuser, or the dump job is disabled | `\du immich` in `psql`; **Administration → Settings → Database Dump Settings** |
| Search errors after a database restore | Vector indexes need rebuilding | `REINDEX INDEX clip_index; REINDEX INDEX face_index;` in `psql -d immich` |
