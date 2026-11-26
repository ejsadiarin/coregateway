# coredb: in-app backups and restore

The gateway backs up the whole shared database (`coredb`, every service's
schema) by running `pg_dump` against the owner connection, and keeps the
files in its backup folder ([ADR-0006](../adr/0006-gateway-runs-database-backups.md)).
This runbook covers where those files are, how to get them off, and how to
restore from one by hand. **The app never restores.**

- [1. What is taken, and where it lives](#1-what-is-taken-and-where-it-lives)
- [2. Copy a backup off](#2-copy-a-backup-off)
- [3. Pick a pg_restore](#3-pick-a-pg_restore)
- [4. Before any restore](#4-before-any-restore)
- [5. Restore everything](#5-restore-everything)
- [6. Restore one service's schema](#6-restore-one-services-schema)
- [7. Verify](#7-verify)

The restores below were tested against the local compose stack
(`scripts/local.sh up coregateway-api`) on 2026-11-26. Its Postgres listens
on `127.0.0.1:25432` only, so there add `--network host` to `pg17` (section
3) and use `-h 127.0.0.1 -p 25432 -U neondb_owner` with password `owner`.

---

## 1. What is taken, and where it lives

| | |
|---|---|
| Nightly | 02:00 Asia/Manila, by the gateway itself |
| Manual | **Back up now** on the admin **Backups** page |
| Kept | The three newest successful backups, nightly and manual together; a failed run deletes nothing |
| Format | `pg_dump --format=custom`, one file per backup, mode `0600` |
| Name | `coredb-<nightly\|manual>-<UTC yyyymmddThhmmssZ>-pg<server major>.dump` |
| Not included | coreban's attachment files in R2 ([`coreban-attachments.md`](./coreban-attachments.md)) |

| Where the gateway runs | Folder |
|---|---|
| Compose (`compose.yml`) | Host `~/services/coregateway/backups`, owned by UID 10001 |
| k3s ([`homelab-k3s.md`](./homelab-k3s.md) 15.3) | PVC `coregateway-backups` (Longhorn, ReadWriteMany) at `/backups` in both gateway pods |

The folder also holds `.lock` while a backup runs and `last-failure.json`
after a failed one. Neither is a backup.

The name's `pg<major>` is the **server's** major version when the backup was
taken. The files themselves are written by the gateway image's `pg_dump` 17.

## 2. Copy a backup off

Pick the newest file from the **Backups** page or the folder listing.

Compose, on the homelab (the files are owner-only for UID 10001):

```sh
ls -l ~/services/coregateway/backups
sudo cp ~/services/coregateway/backups/coredb-nightly-20261126T180000Z-pg17.dump .
sudo chown "$USER" coredb-nightly-20261126T180000Z-pg17.dump
```

Compose, from the container instead of the host path (works for the local
stack too, where the folder is a named volume):

```sh
docker cp <gateway container>:/backups/coredb-manual-20261126T154220Z-pg17.dump .
```

k3s, from the laptop:

```sh
POD=$(kubectl -n coregateway get pod -l app=coregateway-api -o name | head -1)
kubectl -n coregateway exec "$POD" -- ls -l /backups
kubectl -n coregateway cp "${POD#pod/}:/backups/coredb-nightly-20261126T180000Z-pg17.dump" \
  ./coredb-nightly-20261126T180000Z-pg17.dump
```

The Longhorn volume is also in the nightly Longhorn backup to B2
(`homelab-k3s.md` section 18), so a lost cluster still has an off-site copy:
restore the `coregateway-backups` volume first, then copy from it.

## 3. Pick a pg_restore

`pg_restore` must be at least as new as the `pg_dump` that wrote the file.
That is the gateway image's client (`postgresql17-client` in
`Dockerfile.coregateway-api`), not the `pg<major>` in the name, which is the
server's. Read it from the listing's `Dumped by pg_dump version` line and use
that major's Postgres image instead of whatever the laptop has:

```sh
pg17() { docker run --rm -i -v "$PWD":/restore -w /restore \
  -e PGPASSWORD -e PGSSLMODE postgres:17-alpine "$@"; }
pg17 pg_restore --list coredb-nightly-20261126T180000Z-pg17.dump | head
```

The listing's header shows `Dumped from database version` (the server) and
`Dumped by pg_dump version`. Under zsh, keep `pg17` a function: a variable
holding the command is not split into words.

## 4. Before any restore

1. **Restore into a copy first when you can.** On Neon, create a branch, or
   an empty database in the same project, and restore there. Roles are
   project-wide, so the runtime roles a backup grants to already exist.
   Into a database outside the project, run each repo's `bootstrap.sql` first
   (roles are not in a backup), or add `--no-owner --no-privileges`.
2. **Restoring over the live database:** stop everything that writes to it,
   or a restore races live writes.
   - Compose: `docker compose stop coregateway-api corefinance-api coredraw-api coreban-api corefinance-cron-worker`
   - k3s:

     ```sh
     kubectl -n coregateway scale deploy --all --replicas=0
     kubectl -n coregateway patch cronjob corefinance-worker -p '{"spec":{"suspend":true}}'
     ```

     Afterwards, scale each Deployment back to its count in section 15 and set
     `suspend` back to `false`.
3. Connect as the owner over the **direct** host, the same connection as
   `MIGRATION_URL` (the pooler drops session settings `pg_restore` relies on).
   Pass the password through `PGPASSWORD`, never on the command line:

   ```sh
   export PGPASSWORD='<owner password>'
   export PGSSLMODE=require   # Neon; leave unset for the local stack
   OWNER_HOST=<direct host>   # no -pooler
   ```

## 5. Restore everything

Into an empty database (a branch, or a fresh database):

```sh
pg17 pg_restore -h "$OWNER_HOST" -U neondb_owner -d <empty database> \
  --exit-on-error coredb-nightly-20261126T180000Z-pg17.dump
```

Over the live database, replacing every object in the backup:

```sh
pg17 pg_restore -h "$OWNER_HOST" -U neondb_owner -d coredb \
  --exit-on-error --clean --if-exists coredb-nightly-20261126T180000Z-pg17.dump
```

Then start the services again.

## 6. Restore one service's schema

Use this when one service's data is wrong and the others must keep their
newer data. **Do not use `pg_restore -n <schema>`**: it restores the tables
but not the schema itself or its grants, so it fails on a dropped schema and
leaves the service's runtime role without access.

Filter the archive's table of contents to the schema instead. That keeps the
schema, its tables, data, sequences and every grant together:

```sh
F=coredb-nightly-20261126T180000Z-pg17.dump
pg17 pg_restore --list "$F" | grep -E ' corefinance( |$)' > corefinance.list
grep -E 'SCHEMA|ACL' corefinance.list | head    # schema and grants are in it
```

Schema gone (dropped, or a fresh database that already has the others):

```sh
pg17 pg_restore -h "$OWNER_HOST" -U neondb_owner -d coredb \
  --exit-on-error -L corefinance.list "$F"
```

Schema still there, rolled back to the backup:

```sh
pg17 pg_restore -h "$OWNER_HOST" -U neondb_owner -d coredb \
  --exit-on-error --clean --if-exists -L corefinance.list "$F"
```

Swap `corefinance` for `coregateway`, `coredraw` or `coreban` as needed.
Stop only the services that write to that schema. The schemas use the
`uuid_generate_v7()` function from the `pg_uuidv7` extension installed in
`coregateway`, so a single-schema restore needs `coregateway` to exist in the
target database.

Restoring `coregateway` alone also rolls back users, sessions and API keys:
sessions created since the backup stop working and everyone signs in again.

## 7. Verify

```sh
pg17 psql -h "$OWNER_HOST" -U neondb_owner -d coredb -Atc \
  "select table_schema, count(*) from information_schema.tables
   where table_schema like 'core%' group by 1 order by 1"
pg17 psql -h "$OWNER_HOST" -U neondb_owner -d coredb -Atc \
  "select has_table_privilege('corefinance_role', 'corefinance.expenses', 'INSERT')"
```

Then start the services, sign in, and open the page that owns the restored
data. Each service's `goose_db_version` table comes back with its schema, so
its migrations resume from the restored version.
