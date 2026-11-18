Implement the next ticket of coreban's Feed: ejsadiarin/coreban#13 (spec).

## Pick the ticket

1. Read the spec: `gh issue view 13 -R ejsadiarin/coreban --comments`. Its checklist lists the slices in order.
2. Take the first slice whose issue is open and has no open blocker. Check with `gh api repos/ejsadiarin/<repo>/issues/<n> --jq .issue_dependencies_summary` and the "Blocked by" line in the body. Order: coreban#14 → coreban#15 → corefinance#2 (can run in parallel with #14 or #15) → coreban#16 → coreban#17. coreban#18 is deferred and needs triage, so skip it.
   If I named a ticket when starting this session, do that one instead.
3. Read that issue with its comments. It is the scope. Don't start the next slice in the same session.

## Read before you code

- `/home/ejs/personal/coregateway/AGENTS.md`. Each repo under `services/` is a separate repo (a git submodule) with its own issues, `CONTEXT.md` and `docs/adr/`.
- `services/coreban/CONTEXT.md`. Use its words in code, UI copy and commits: **Note**, **Feed**, **Linked record**, **Archived** (kept, can be restored) versus deleted (permanent). Never call a note a "message": in coreban, "message" belongs to Reminder.
- `services/coreban/docs/adr/0003-notes-show-linked-records-live.md`, plus 0001 and 0002. A linked note keeps no content of its own. It shows its record live and stores a snapshot only once the record is gone. Across services, the record is deleted before the note is archived.
- For corefinance#2, read `services/corefinance`'s own docs and code first.
- The web follows `web/DESIGN.md`. Copy the existing Kanban pages (`web/src/pages/dashboard/kanban/`) for patterns: React Query keys, `min-h-11` touch targets, error copy, and `usePageTitle` for the breadcrumb.

## How to work

- Test first. In coreban, write HTTP-level tests through `internal/testharness`. They run against a disposable Postgres via testcontainers, so Docker must be running: `make test` (`make test-unit` runs without Docker). Web logic goes in pure functions with Vitest tests next to them (`pnpm vitest run`).
- coreban schema: add goose migrations in `services/coreban/internal/db/migrations/` (next number after `00009`), queries in `internal/db/queries/`, then `make sqlc` (sqlc is in `~/go/bin`).
- `goose` isn't installed. Install it once with `GOBIN=$HOME/go/bin go install github.com/pressly/goose/v3/cmd/goose@v3.26.0` and make sure `~/go/bin` is on PATH.
- The gateway already proxies `/api/coreban/*` to coreban and `/api/budget/*` to corefinance (`internal/server/routes.go`), so new routes need no gateway changes. Mirror coreban's existing scope rules: GET/HEAD need `coreban:read`, everything else needs `coreban:write`.
- Before calling it done, run `go vet ./... && go test ./...` in each Go repo you touched, and `pnpm lint && npx tsc -b && pnpm vitest run` in `web/`.

## Try it on the phone

From the coregateway root:

```
E2E_HOST=$(tailscale ip -4) scripts/e2e-up.sh   # web at http://<tailnet-ip>:3001
scripts/e2e-down.sh                              # stop
```

This is a disposable stack with an empty database. Log in as `admin@e2e.local` / `e2e-admin-pass-123`. The web is a production build, so after a web change, rerun the script or rebuild into `.e2e/web`. Also check the new UI at a 390px-wide viewport with the Playwright MCP, and look at the screenshot. The Playwright e2e suite (`cd web && pnpm e2e`) needs `pnpm install && npx playwright install chromium` first. Add an e2e spec for the Feed in `web/e2e/` when a slice adds UI.

## Finish

1. Show me the change and the test results, then wait for my go-ahead before committing.
2. Commit in each submodule repo on its `main` (Conventional Commits, with `Closes #<n>` in the coreban or corefinance commit) and push.
3. In coregateway, on branch `rewrite-v2`, commit the web change and the submodule bump(s), then push.
4. Close the issue with a comment naming the commits. Tick its box in the spec (coreban#13) and in the cross-link (ejsadiarin/coregateway#9). If every slice is done, close #9 and #13.
5. If the work changed the domain language or a design decision, update `CONTEXT.md` or add an ADR in the same commit. Note anything you deferred as a comment on the next slice's issue.
