Resolve two design decisions under corefinance's recurring-rules redesign: ejsadiarin/corefinance#19 and ejsadiarin/corefinance#20. Both are labelled ready-for-human: the outcome is a recorded decision plus follow-up tickets, not code.

## Where things stand (2026-11-15)

- The redesign (corefinance#10, ADR-0001) is live in production. One `rules` table, one writer (the per-user materialize pass under an advisory lock), next-due scheduling, reconciling on a schedule change, and the "what's new" review feed (`GET /api/budget/rule-entries/feed`).
- #17 (the legacy columns and backfill) and the follow-up that dropped the compatibility views are merged and deployed. Neon corefinance is on migration 14. coregateway `rewrite-v2` points at corefinance and coreban `main`.
- Timezones (coregateway ADR-0005, amended 2026-11-15): the gateway owns the user's zone and puts it in the internal token's `tz` claim. corefinance and coreban each keep the last zone they saw, and their background jobs use it. Background jobs make no gateway calls and hold no API keys. This was chosen to avoid deploy churn.
- #10 stays open until #19 and #20 are resolved.

## Read first

- `/home/ejs/personal/coregateway/AGENTS.md`. Each `services/*` is a separate repo (a submodule) with its own issues, `CONTEXT.md` and `docs/adr/`.
- The issues: `gh issue view 19 -R ejsadiarin/corefinance --comments`, the same for 20, and #10's comments.
- ADRs:
  - coregateway `docs/adr/0001`, `0002`, `0004` and `0005`: Ed25519/JWKS internal tokens, fail-closed verification, gateway-owned API keys, the timezone claim.
  - corefinance `docs/adr/0001`.
  - coreban `docs/adr/0002`, `0003` and `0005`: reminders sent at most once, notes show their linked records live, every budget record has a note.
- Code to compare for #19:
  - corefinance `internal/materialize`: `DueDates`, `NextDueDate`, month-end clamping, whole dates.
  - coreban `internal/reminder`: `schedule.go` and `dispatcher.go`, with weekdays and times of day.
- For #20: coreban's notes sync (`POST /api/coreban/notes/sync`) and the web code that copies budget records into notes today (`web/src/lib/feed*.ts`).

## How to work

1. Explain each decision to me in plain terms first. I don't follow #19 and #20 yet. For each, give the problem, two or three real options with trade-offs, and your recommendation. Do #19 first, then #20.
2. Interview me until I decide. Ask one question at a time, with your recommendation first.
3. Record each decision as an ADR in the repo that owns it, or as a closing comment if it's small. Use the domain vocabulary in each repo's `CONTEXT.md`.
4. If a decision leads to work, file follow-up tickets as tracer-bullet vertical slices with blocking edges, cross-linked between corefinance and coreban, labelled `ready-for-agent`. Then close #19 and #20. Don't implement anything in this session.

## Constraints I care about

- **No churn.** Prefer designs that need no new env vars, keys or manual deploy steps, and that deploy in any order. This is why ADR-0005 was amended. Ask before anything that would change the internal token contract.
- **Production is mine.** Never run anything against Neon or remote databases. Give me the commands instead, including migrations and data checks.
- **Commits and pushes:** submodules commit to `main`, coregateway to `rewrite-v2`. Ask before pushing anything that isn't docs or tickets.
- Format with `gofmt` on the files you changed only. A repo-wide `gofmt -w` reformats unrelated files.
