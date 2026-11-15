# Immich: restore drill from B2 (Compose + Traefik)

Rebuilds Immich on a second machine from nothing but the restic repository in
Backblaze B2, then proves every photo and video came back intact. Run it
before the k3s move ([`immich-migration.md`](./immich-migration.md)) and again
after any change to the backup script.

The same steps are the real disaster recovery for the Compose install;
section 11 lists what differs when it is not a drill.

- [1. What is being restored](#1-what-is-being-restored)
- [2. Rules](#2-rules)
- [3. Get the credentials without the homelab](#3-get-the-credentials-without-the-homelab)
- [4. On `homelab`: fresh backup and a baseline](#4-on-homelab-fresh-backup-and-a-baseline)
- [5. Prepare the test box](#5-prepare-the-test-box)
- [6. Restore the files](#6-restore-the-files)
- [7. Start Traefik](#7-start-traefik)
- [8. Restore the database and start Immich](#8-restore-the-database-and-start-immich)
- [9. Verify](#9-verify)
- [10. Tear down](#10-tear-down)
- [11. A real disaster](#11-a-real-disaster)
- [12. Gaps in the backup to close](#12-gaps-in-the-backup-to-close)
- [13. Troubleshooting](#13-troubleshooting)
- [Drill log](#drill-log)

---

## 1. What is being restored

State of the live install, checked on `homelab` on 2026-11-15:

| Item | Value |
|---|---|
| Host | `homelab` (N100, Debian 12), one 477 GB NVMe, no other drives attached |
| Immich | `v3.4.1`. The image tag floats (`IMMICH_VERSION` resolves to `release`) |
| Database | Postgres 14.19 + VectorChord 0.4.3, user `postgres`, database `immich`, 341 MB |
| Media | `/home/ejs/services/immich/library`, owned by root, about 181 GB |
| Contents | 49,215 assets, 44 albums, 1 user. Storage template on: `{{y}}/{{album}}/{{filename}}` |
| Paths in the database | Start with `/usr/src/app/upload/` (the Compose file is from an older release) |
| URL | `immich.local.ejsadiarin.com`: a public DNS record pointing at `homelab`'s tailnet address, served by Traefik with a `*.local.ejsadiarin.com` Let's Encrypt wildcard |
| Backup | `,backup-homelab` (restic to B2), run by hand. No cron job or timer exists |

What the backup contains for Immich, and what it does not:

| In the snapshot | Not in the snapshot |
|---|---|
| `~/services/immich/docker-compose.yml` and `.env` | `~/services/immich/postgres` (the live database files; excluded on purpose) |
| `library/library`, `upload`, `profile`: originals | The `model-cache` Docker volume (models download again) |
| `library/thumbs`, `encoded-video`: generated files | |
| `library/backups`: Immich's own database dumps, nightly at 02:00, last 14 kept | |
| `~/services/traefik`: Compose file, `.env`, `data/acme.json` (the certificate) | |

So the database comes back from a dump in `library/backups`, never from raw
Postgres files. `encoded-video` is not only generated files: the video halves
of 144 motion photos live there as assets. Restore the whole `library`
directory, as the backup already stores it.

On 2026-11-15 the newest dump was restored into a throwaway Postgres 14
container with the command in section 8: 30 seconds, no errors, 49,215 assets.
The dump is sound. The drill tests the rest: B2, restic, the files, Traefik.

---

## 2. Rules

1. **Sections 5 to 10 run on the test box only.** The live server has the same
   paths. The database restore in section 8 replaces a database; run on
   `homelab` it would replace the live one. Blocks that can do damage start
   with a hostname guard. Run `hostname` when in doubt.
2. The drill instance gets its own name, `immich-restore.local.ejsadiarin.com`,
   so it can never be mistaken for the live one.
3. Never point the phone app at the drill instance. Anything uploaded to it is
   deleted in section 10.
4. Nothing on `homelab` is stopped or changed. Live Immich keeps running.

---

## 3. Get the credentials without the homelab

Restic needs four values. Today they live in `~/services/restic/restic-env`
and `~/services/restic/restic-password` on `homelab`:

| Value | Variable |
|---|---|
| B2 key ID | `AWS_ACCESS_KEY_ID` |
| B2 application key | `AWS_SECRET_ACCESS_KEY` |
| Repository address | `RESTIC_REPOSITORY` (`s3:s3.<region>.backblazeb2.com/<bucket>`) |
| Repository password | The single line in `restic-password` |

**Collect all four without logging in to `homelab`.** This is the first test
of the drill, and the one most likely to fail: `~/services/restic` and
`~/.password-store` are both inside the backup they unlock. If the only copies
are on `homelab`, a dead `homelab` means the backup cannot be opened.

If you cannot produce them from somewhere else, stop here and fix that first:
put the four values in a password manager that does not run on `homelab`, and
keep a printed copy. The B2 key can be re-created in the Backblaze console.
The repository password cannot be recovered by anyone.

To check the variable names without printing the values (on `homelab`):

```sh
grep -o '^export [A-Z_0-9]*' ~/services/restic/restic-env
```

---

## 4. On `homelab`: fresh backup and a baseline

Take a database dump first, then the file backup. In that order the worst
case is a few new files the database does not know about, never a database
that points at missing files.

1. In the web UI: **Administration → Job Queues → Create job → Create
   Database Dump → Confirm**. Then:

   ```sh
   ls -lt ~/services/immich/library/backups | head -3     # newest dump is minutes old
   ```

2. Run the backup and note the snapshot:

   ```sh
   ,backup-homelab
   source ~/services/restic/restic-env
   sudo -E restic snapshots --latest 1                    # write down the ID and time
   ```

3. Record the baseline. Keep these numbers; section 9 compares against them.

   ```sh
   docker exec immich_postgres psql -U postgres -d immich -At -c "
     select 'assets',  count(*) from asset
     union all select 'albums', count(*) from album
     union all select 'faces',  count(*) from asset_face
     union all select 'users',  count(*) from \"user\";"
   sudo du -sh ~/services/immich/library
   ```

   Also open **Administration → Server Stats** and note photos, videos and
   storage.

---

## 5. Prepare the test box

Requirements:

| Need | Check |
|---|---|
| Linux, x86-64, Docker with the Compose plugin | `docker compose version` |
| 200 GB free where `/home` lives | `df -h /home` |
| `/home/ejs/services` does not exist yet | `ls /home/ejs/services` fails |
| Ports 80, 443 and 222 free | `sudo ss -ltnp \| grep -E ':(80\|443\|222)\b'` prints nothing |
| restic 0.17.3 or newer (the version on `homelab`) | `restic version` |
| Reachable from the laptop, over the LAN or the tailnet | Its address is `<TEST_IP>` below |

A user named `ejs` is not required. Files are restored with their original
owners (root for the library, UID 1000 for the Compose files).

If `/home/ejs/services` already exists on the test box, use another box or see
"Restoring to a different path" in section 13.

```sh
hostname                                   # must NOT print "homelab"
sudo apt update && sudo apt install -y restic bzip2
restic version
```

If that prints a version below 0.17, install the official build instead
(Debian 12 packages 0.14):

```sh
curl -L https://github.com/restic/restic/releases/download/v0.17.3/restic_0.17.3_linux_amd64.bz2 \
  | bunzip2 | sudo tee /usr/local/bin/restic >/dev/null
sudo chmod +x /usr/local/bin/restic
hash -r && restic version                  # restic 0.17.3
```

Put the credentials from section 3 in place. Use an editor so the secrets do
not land in shell history:

```sh
sudo install -d -m 700 /etc/restic
sudoedit /etc/restic/restic-env
```

```sh
export AWS_ACCESS_KEY_ID=<B2 key ID>
export AWS_SECRET_ACCESS_KEY=<B2 application key>
export RESTIC_REPOSITORY=s3:s3.<region>.backblazeb2.com/<bucket>
export RESTIC_PASSWORD_FILE=/etc/restic/restic-password
```

```sh
sudoedit /etc/restic/restic-password       # one line: the repository password
sudo chmod 600 /etc/restic/restic-env /etc/restic/restic-password
```

**Verify**

```sh
sudo -i                                    # root shell for sections 5 and 6
source /etc/restic/restic-env
restic snapshots                           # lists snapshots; the one from section 4 is newest
restic check                               # "no errors were found"
```

`restic snapshots` succeeding proves the B2 key, the bucket address and the
password in one step.

---

## 6. Restore the files

Still in the root shell. Pick the snapshot from section 4:

```sh
SNAP=<snapshot ID>                         # or: latest
restic ls "$SNAP" /home/ejs/services/immich/library/backups | tail -5
#   the dump you created in section 4 is listed
```

Restore Immich and Traefik to their original paths. About 181 GB; at
100 Mbit/s that is four to five hours. Run it inside `tmux` so a dropped SSH
session does not stop it.

```sh
[ "$(hostname)" != homelab ] && \
restic restore "$SNAP" --target / \
  --include /home/ejs/services/immich \
  --include /home/ejs/services/traefik \
  --verify
```

`--verify` re-reads every restored file and compares it with the repository.
B2 does not charge for downloads up to three times what you store.

**Verify**

```sh
du -sh /home/ejs/services/immich/library               # close to the baseline
ls -la /home/ejs/services/immich/library               # backups encoded-video library profile thumbs upload
find /home/ejs/services/immich/library -maxdepth 2 -name .immich | wc -l    # 6
ls /home/ejs/services/immich/postgres 2>&1             # "No such file": expected
ls -l /home/ejs/services/traefik/data/acme.json        # -rw------- (Traefik refuses any other mode)
exit                                                   # leave the root shell
```

The six `.immich` files are markers Immich checks at startup. If any is
missing, Immich refuses to start rather than run against an empty folder.

---

## 7. Start Traefik

```sh
[ "$(hostname)" != homelab ] && docker network create proxy
cd /home/ejs/services/traefik
docker compose up -d
```

The restored `acme.json` already holds the wildcard certificate, so nothing is
requested from Let's Encrypt unless it has expired. If it has, Traefik renews
it over DNS-01 with the Cloudflare token in the restored `.env`; allow two
minutes.

Traefik writes its log to a file inside the container, so `docker logs` is
nearly empty:

```sh
docker exec traefik tail -n 20 /var/log/traefik/traefik.log
```

**Verify**

```sh
curl -sS -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}\n' \
  --resolve traefik-dashboard.local.ejsadiarin.com:443:127.0.0.1 \
  https://traefik-dashboard.local.ejsadiarin.com
#   401 tls=0   → Traefik answers (401 is the dashboard's password prompt)
#                 with a certificate curl trusts
```

---

## 8. Restore the database and start Immich

```sh
cd /home/ejs/services/immich
[ "$(hostname)" != homelab ] || echo "STOP: this is the live server"
```

### 8.1 Pin the version and rename the instance

Run the same Immich version that wrote the dump. The version is in the dump's
file name.

```sh
DUMP=$(ls -t library/backups/immich-db-backup-*.sql.gz | head -1)
VER=$(basename "$DUMP" | sed -E 's/.*-(v[0-9.]+)-pg.*/\1/')
echo "$DUMP  →  $VER"
gunzip -t "$DUMP" && echo "archive ok"

grep -q '^IMMICH_VERSION=' .env \
  && sed -i "s/^IMMICH_VERSION=.*/IMMICH_VERSION=$VER/" .env \
  || echo "IMMICH_VERSION=$VER" >> .env

sed -i 's/immich\.local\.ejsadiarin\.com/immich-restore.local.ejsadiarin.com/' docker-compose.yml
grep -n 'Host(' docker-compose.yml         # shows immich-restore.local.ejsadiarin.com
```

Check the two values the restore command uses:

```sh
grep -E '^DB_(USERNAME|DATABASE_NAME)=' .env     # postgres / immich
```

If they differ, substitute them in 8.2.

### 8.2 Restore

The database must be loaded before the Immich server ever starts. A server
that starts against an empty database creates a fresh schema, and the restore
then collides with it.

```sh
docker compose pull
docker compose create                      # creates containers, starts none
docker start immich_postgres
until docker exec immich_postgres psql -U postgres -d immich -Atc 'select 1' >/dev/null 2>&1; do sleep 2; done
sleep 5

[ "$(hostname)" != homelab ] && \
gunzip --stdout "$DUMP" \
  | sed "s/SELECT pg_catalog.set_config('search_path', '', false);/SELECT pg_catalog.set_config('search_path', 'public, pg_catalog', true);/g" \
  | docker exec -i immich_postgres psql --dbname=immich --username=postgres \
      --single-transaction --set ON_ERROR_STOP=on > /tmp/immich-restore.log 2>&1
echo "psql exit=$?"                        # 0
grep -ci error /tmp/immich-restore.log     # 0
```

This is Immich's documented command-line restore. It takes under a minute.
`--single-transaction` with `ON_ERROR_STOP` means a failure leaves the
database empty, not half-loaded: fix the cause and run it again.

### 8.3 Start

```sh
docker compose up -d
docker compose logs -f immich-server
#   wait for: "Successfully verified system mount folder checks"
#   and:      "Immich Server is listening on ..."
```

**Verify**

```sh
docker compose ps                          # four containers, server and database "healthy"
curl -sS --resolve immich-restore.local.ejsadiarin.com:443:127.0.0.1 \
  https://immich-restore.local.ejsadiarin.com/api/server/ping        # {"res":"pong"}
curl -sS --resolve immich-restore.local.ejsadiarin.com:443:127.0.0.1 \
  https://immich-restore.local.ejsadiarin.com/api/server/version     # the version in $VER
```

---

## 9. Verify

Four checks by command, then a look in the browser. All commands run in
`/home/ejs/services/immich` on the test box.

### 9.1 Row counts

```sh
docker exec immich_postgres psql -U postgres -d immich -At -c "
  select 'assets',  count(*) from asset
  union all select 'albums', count(*) from album
  union all select 'faces',  count(*) from asset_face
  union all select 'users',  count(*) from \"user\";"
```

Equal to the baseline from section 4.

### 9.2 Every original, byte for byte

Immich stores a SHA-1 of every file at upload time. Recompute it for every
restored original and compare:

```sh
docker exec immich_postgres psql -U postgres -d immich -At -c \
  "select encode(checksum,'hex') || '  ' || \"originalPath\" from asset where not \"isExternal\";" \
  | sed -E 's#  (/usr/src/app/upload|/data)/#  library/#' > /tmp/immich-sha1.txt
wc -l < /tmp/immich-sha1.txt               # the asset count
sudo sha1sum --quiet -c /tmp/immich-sha1.txt; echo "exit=$?"
```

`--quiet` prints only failures. **No output and `exit=0` means every photo and
video the database knows about exists and is identical to what was uploaded.**
This is the check that answers "are my images safe". Expect ten minutes on an
SSD, longer on a hard disk.

### 9.3 Thumbnails, previews, transcodes and sidecars

```sh
docker exec immich_postgres psql -U postgres -d immich -At -c 'select path from asset_file;' \
  | sed -E 's#^(/usr/src/app/upload|/data)/#library/#' \
  | sudo xargs -d '\n' sh -c 'for f; do [ -e "$f" ] || echo "$f"; done' sh \
  | wc -l                                                  # 0 missing
```

All 108,553 generated files were present on the live install on 2026-11-15.

### 9.4 Files the database does not know (informational)

```sh
sudo find library/library library/upload -type f ! -name .immich | sort > /tmp/on-disk.txt
{ docker exec immich_postgres psql -U postgres -d immich -At -c 'select "originalPath" from asset;'
  docker exec immich_postgres psql -U postgres -d immich -At -c 'select path from asset_file;'
} | sed -E 's#^(/usr/src/app/upload|/data)/#library/#' | sort -u > /tmp/in-db.txt
comm -23 /tmp/on-disk.txt /tmp/in-db.txt | wc -l
```

Not a failure. On 2026-11-15 the live install had 109 such files, all under
`upload/` (5.6 GB of leftovers from interrupted uploads). Expect that number
plus anything uploaded between the dump and the restic run.

### 9.5 In the browser

On the laptop only, point the drill name at the test box:

```sh
echo '<TEST_IP> immich-restore.local.ejsadiarin.com' | sudo tee -a /etc/hosts
```

Open `https://immich-restore.local.ejsadiarin.com` and log in with your normal
account.

1. The certificate is valid: no browser warning.
2. The timeline is complete; the newest item is from just before the dump.
3. Open one of the oldest photos, choose **Download**, and open the downloaded
   file in an image viewer.
4. Play a video from start to finish.
5. Open an album: all 44 are listed with their photos.
6. **Administration → Server Stats** matches the numbers noted in section 4.
7. Search for something by content ("beach"). The first search downloads the
   model again, so allow a few minutes.
8. Upload one test photo from the browser, see it appear, delete it.

### 9.6 Pass or fail

| Check | Pass |
|---|---|
| 3. Credentials | Obtained without `homelab` |
| 6. restic restore | Finished, `--verify` clean |
| 9.1 Row counts | Equal to baseline |
| 9.2 SHA-1 of originals | `exit=0`, no output |
| 9.3 Generated files | 0 missing |
| 9.5 Browser | All eight points |

Fill in the [drill log](#drill-log) either way.

---

## 10. Tear down

On the test box:

```sh
[ "$(hostname)" != homelab ] && {
  cd /home/ejs/services/immich  && docker compose down -v
  cd /home/ejs/services/traefik && docker compose down
  docker network rm proxy
  sudo rm -rf /home/ejs/services
  sudo shred -u /etc/restic/restic-env /etc/restic/restic-password
  rm -f /tmp/immich-*.txt /tmp/immich-restore.log /tmp/on-disk.txt /tmp/in-db.txt
}
docker image prune -a          # optional: reclaims the pulled images
```

On the laptop, remove the `immich-restore` line from `/etc/hosts`.

The restored `.env` files held the Cloudflare token and the database password;
`rm -rf` above removes them with everything else.

---

## 11. A real disaster

The same steps on the replacement machine, with these differences:

| Drill | Real recovery |
|---|---|
| Fresh backup and baseline first (section 4) | Not possible: use the newest snapshot. Everything uploaded after it is lost unless it is still on the phone |
| `--include` for Immich and Traefik | Restore the whole snapshot: drop both `--include` flags |
| Rename to `immich-restore` (8.1) | Skip the `sed` on `docker-compose.yml`; keep the real name |
| `/etc/hosts` on the laptop | Join the machine to the tailnet, then change the Cloudflare DNS record `homelab.local.ejsadiarin.com` to its new tailnet address |
| Tear down | Do not. Set up the backup on the new machine and run it |

After a real recovery, open the phone app and let it run a backup: it uploads
anything the server no longer has.

---

## 12. Gaps in the backup to close

Found while preparing this drill. None blocks the drill; each one weakens a
real recovery.

1. **The backup does not run on its own.** `homelab` has no cron job and no
   timer for it. A systemd timer at 03:00 fixes that, and also puts the file
   backup one hour after Immich's 02:00 database dump, which is the right
   order:

   ```ini
   # /etc/systemd/system/backup-homelab.service
   [Unit]
   Description=Homelab backup to B2 (restic)
   Wants=network-online.target
   After=network-online.target docker.service

   [Service]
   Type=oneshot
   User=ejs
   ExecStart=/home/ejs/vault/wizardry/scripts-magic-spells/,backup-homelab
   ```

   ```ini
   # /etc/systemd/system/backup-homelab.timer
   [Unit]
   Description=Nightly homelab backup

   [Timer]
   OnCalendar=*-*-* 03:00:00
   Persistent=true

   [Install]
   WantedBy=timers.target
   ```

   ```sh
   sudo systemctl daemon-reload && sudo systemctl enable --now backup-homelab.timer
   systemctl list-timers backup-homelab.timer
   ```

2. **The keys to the backup are inside the backup** (section 3).
3. **Image tags float.** Immich follows `release` and Traefik follows
   `latest`, so a restore pulls whatever is newest that day, not what was
   running. Pin both: `IMMICH_VERSION=v3.4.1` in Immich's `.env`, and a
   version tag on the Traefik image.
4. **`restic check` does not read the data.** The script runs it after every
   backup, which checks the repository's structure only. Once a month, run
   `restic check --read-data-subset=10%` to catch damaged files in B2.
5. **Nothing is ever removed from the repository.** There is no
   `restic forget`. That is safe, and it grows forever. When the B2 bill
   matters: `restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune`.

---

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `restic snapshots`: "wrong password or no key found" | Password file has a trailing space or the wrong line | Re-create `/etc/restic/restic-password` with the one line only |
| `restic snapshots`: 403 or "access denied" | B2 key lacks read or list on the bucket, or wrong region in the address | Check the key's scope in Backblaze; compare `RESTIC_REPOSITORY` with `homelab`'s |
| Restore stops with "no space left on device" | Less than 200 GB free | Free space or use a larger disk; re-run the same command, restic skips finished files |
| Traefik serves its default self-signed certificate | `acme.json` has the wrong mode, or the certificate expired and renewal failed | `chmod 600 data/acme.json`, restart; read `/var/log/traefik/traefik.log` in the container |
| `psql` restore: "relation already exists" | The Immich server ran before the restore | `docker compose down`, `sudo rm -rf postgres`, repeat 8.2 |
| `psql exit=0` but counts are 0 | The dump is empty or the wrong file | `gunzip -c "$DUMP" \| head -20`; pick the previous dump |
| Immich will not start: "Failed to read ... .immich" | A library folder is missing or empty | Section 6 verify; re-run the restore for `library` |
| Immich starts and the timeline is all grey squares | `thumbs` was not restored | Restore it, or **Administration → Job Queues → Generate Thumbnails → All** |
| 9.2 lists files as `FAILED open or read` | Those originals are not in the snapshot | Check the same paths on `homelab`; if present there, the backup is missing them: stop and investigate the backup script |
| 9.2 lists files as `FAILED` (checksum) | The file is damaged in the repository | `restic check --read-data` on the repository; compare with the copy on `homelab` |
| Browser shows the live instance | `/etc/hosts` line missing, or the browser cached DNS | Check the hosts line; the drill URL contains `immich-restore` |

### Restoring to a different path

If `/home/ejs/services` is taken on the test box, restore under another root:

```sh
restic restore "$SNAP" --target /srv/drill \
  --include /home/ejs/services/immich --include /home/ejs/services/traefik --verify
cd /srv/drill/home/ejs/services/immich
grep -E '^(UPLOAD_LOCATION|DB_DATA_LOCATION)=' .env
```

If those two values are relative (`./library`, `./postgres`), nothing else
changes: use `/srv/drill/home/ejs/services` wherever this guide says
`/home/ejs/services`. If they are absolute paths under `/home/ejs`, edit them
to the new location first.

---

## Drill log

Add a row after every drill.

| Date | Snapshot | Dump used | Immich | Restore time | Result | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
