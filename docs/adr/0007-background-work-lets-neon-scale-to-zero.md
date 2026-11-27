# Background work lets Neon scale to zero

The shared database is Neon on the Free plan: 100 compute-hours a month, and the compute suspends only after 5 minutes with no queries. A 0.25 CU compute that never sleeps uses about 183 compute-hours a month, and past the limit Neon suspends it until the next month, so every service stops. It was never sleeping: the monitor read the service list every second and wrote a history row per check, corefinance's `/health` pinged the database, and its worker passed every minute. By 2026-11-27, 80% of the month's allowance was gone. So the rule is: **nothing in the background may query the database on a short interval.** Only users' own requests, and rare scheduled jobs, wake it.

What follows from that:

- **Health checks are kept in memory, not the database.** Every active monitored service is checked once a round, every 5 minutes; the round is the only time the list is read. Services that fail are rechecked every 30 seconds from the list already in memory, since downstreams start after the gateway. Only the latest check is kept, so the uptime history, percentages and per-service interval are gone (migration 008).
- **Health checks probe liveness only.** Every downstream's `/health` answers without the database. Readiness (corefinance's `/ready`) exists for on-demand checks and is never polled.
- **Database failures are seen passively, from real traffic.** A liveness check can be green while a downstream can't reach its database, so the gateway marks a built-in service **degraded** for 10 minutes after a proxied request fails (5xx, or the downstream unreachable). When nobody uses the app, nothing needs the database, so nothing checks it.
- **corefinance's worker sleeps until the next due rule, at most 6 hours** (15 minutes after a failure). Saving a rule already fills its due entries, so the cap only delays the first future entry of a rule saved while the worker sleeps, by a few hours on its own day.
- **The gateway's Docker healthcheck runs once a minute after startup.** It never touched the database, but every 5 seconds was noise.

**Considered options**: paying for Neon (removes the limit, not the waste); keeping history in a table but writing less often (still wakes the database every round); readiness probes that ping the database (the simplest honest signal, but wakes Neon on every probe); Postgres LISTEN/NOTIFY to wake the worker on rule saves (needs a held direct connection, which may itself keep the compute awake).

**Consequences**: the dashboard can't say how reliable a service has been, only how it is now and whether real requests failed in the last 10 minutes. After a restart every service is unknown until the first round. Remaining background wake-ups are the hourly session cleanup, the nightly backup and the worker; anything new that runs on a timer must justify its own wake-ups against this budget.
