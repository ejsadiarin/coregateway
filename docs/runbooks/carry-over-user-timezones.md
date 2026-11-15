# Runbook: carry users' timezones over to the gateway

Before ADR-0005, coreban (`coreban.owner_settings.timezone`) and corefinance
(`corefinance.user_settings.timezone`) each kept their own copy of a user's
timezone. The gateway now owns it (`coregateway.users.timezone`, migration
`004_user_timezone.sql`, issue #16). This copies the existing values over,
once per environment.

The gateway can't read other services' schemas, so a human runs this as the
database owner. Nothing here runs automatically.

## When

1. After the gateway release with migration `004_user_timezone.sql` is
   deployed (the `timezone` column must exist).
2. **Before** the web release that stops saving the timezone to coreban and
   corefinance. That web adopts the device's zone for any user the gateway
   has no timezone for; running this first keeps the zone the user already
   chose instead.

3. **Before** corefinance migration `00012_user-timezones-observed.sql`
   (corefinance#18) and coreban migration `00016` (coreban#26): corefinance's
   renames `user_settings` to `user_timezones` (and `updated_at` to
   `seen_at`), and coreban's drops `owner_settings.timezone`. If corefinance
   00012 has already run, read `corefinance.user_timezones` (`seen_at`) in
   place of `corefinance.user_settings` (`updated_at`) below; its rows are the
   zones users saved in corefinance until the worker's first lookup replaces
   them.

Running it later is still safe: it only fills users whose gateway timezone
is still unset, so it never overwrites one saved through the gateway.

## Who and how

Connect over the **direct** (not pooler) host as the owner role, the same
connection `MIGRATION_URL` uses (`neondb_owner`), so all three schemas are
readable. The service roles (`coreban_role`, `corefinance_role`) can't see
`coregateway`, and the gateway's role can't see the others.

```sh
psql "postgresql://neondb_owner:<pw>@<direct-host>/coredb?sslmode=require&channel_binding=require"
```

## Rules

- When a user has a timezone in both services, the one updated most recently
  wins (both tables keep `updated_at`).
- Only IANA zones Postgres knows (`pg_timezone_names`) are copied; `''` and
  `Local` never are. Anything skipped shows up in step 1.
- Users the gateway doesn't know (a downstream row for a deleted user) are
  skipped.
- Users who already have a gateway timezone are left alone.

## 1. Preview

```sql
WITH downstream AS (
    SELECT owner_id AS user_id, timezone, updated_at, 'coreban' AS source
    FROM coreban.owner_settings
    UNION ALL
    SELECT user_id, timezone, updated_at, 'corefinance'
    FROM corefinance.user_settings
),
latest AS (
    SELECT DISTINCT ON (user_id) user_id, timezone, source, updated_at
    FROM downstream
    ORDER BY user_id, updated_at DESC
)
SELECT l.user_id, u.email, l.timezone AS carried, l.source, u.timezone AS gateway_now,
       CASE
           WHEN u.id IS NULL THEN 'skip: no gateway user'
           WHEN u.timezone IS NOT NULL THEN 'skip: gateway already set'
           WHEN l.timezone IN ('', 'Local')
             OR l.timezone NOT IN (SELECT name FROM pg_timezone_names) THEN 'skip: not an IANA zone'
           ELSE 'copy'
       END AS action
FROM latest l
LEFT JOIN coregateway.users u ON u.id = l.user_id
ORDER BY action, u.email;
```

Read the `action` column. If a user's two services disagree, the preview
shows the winner only; to see both, run
`SELECT * FROM downstream WHERE user_id = '<uuid>'` with the same `WITH`.

## 2. Copy

```sql
BEGIN;

WITH downstream AS (
    SELECT owner_id AS user_id, timezone, updated_at FROM coreban.owner_settings
    UNION ALL
    SELECT user_id, timezone, updated_at FROM corefinance.user_settings
),
latest AS (
    SELECT DISTINCT ON (user_id) user_id, timezone
    FROM downstream
    ORDER BY user_id, updated_at DESC
)
UPDATE coregateway.users u
SET timezone = l.timezone, updated_at = NOW()
FROM latest l
WHERE u.id = l.user_id
  AND u.timezone IS NULL
  AND l.timezone NOT IN ('', 'Local')
  AND l.timezone IN (SELECT name FROM pg_timezone_names);

-- The row count should match the 'copy' rows from step 1.
COMMIT;   -- or ROLLBACK if it doesn't
```

## 3. Check

```sql
SELECT count(*) FILTER (WHERE timezone IS NOT NULL) AS with_timezone,
       count(*) AS users
FROM coregateway.users;
```

Then, as one of the carried users, `GET /api/users/<id>/timezone` should
answer `{"timezone":"<their zone>","saved":true}`.

## Afterwards

Leave the coreban and corefinance columns in place. Each service drops its
copy in its own repo once it reads the timezone from the internal token
(`tz` claim) and the gateway lookup (coreban#26, corefinance#18).

## Undo

The copy only fills `NULL`s, so there is no earlier value to restore. To
clear what it wrote before anyone has saved a zone through the gateway:

```sql
UPDATE coregateway.users SET timezone = NULL WHERE timezone IS NOT NULL;
```
