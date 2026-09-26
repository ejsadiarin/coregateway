#!/usr/bin/env bash
# check-refs.sh — verify that file paths and make targets referenced in
# README.md and Makefile actually exist.
#
# Usage: scripts/check-refs.sh [ROOT]   (default: this script's repo root)
#
# Checks:
#   1. `make <target>` mentions (README + Makefile help) resolve to a target.
#   2. Every .PHONY entry has a corresponding target (catches phantom entries).
#   3. Path-like tokens (./cmd/..., internal/..., *.http, compose.yml, ...)
#      resolve to files/dirs on disk. Skips URLs, Go module paths, templates
#      with {braces}, wildcards, and runtime-generated files.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
README="$ROOT/README.md"
MAKEFILE="$ROOT/Makefile"
fail=0

say()  { echo "$1"; }
bad()  { echo "  FAIL $1"; fail=1; }
ok()   { echo "  ok $1"; }

[ -f "$README" ]   || { echo "missing $README"; exit 1; }
[ -f "$MAKEFILE" ] || { echo "missing $MAKEFILE"; exit 1; }

echo "== make targets =="
# All `target:` definitions.
mapfile -t targets < <(grep -oE '^[A-Za-z0-9_.-]+:' "$MAKEFILE" | tr -d ':')
have_target() { local t="$1" w; for w in "${targets[@]}"; do [ "$w" = "$t" ] && return 0; done; return 1; }

# 1. `make X` mentions must resolve.
while IFS=: read -r line text; do
  for m in $(echo "$text" | grep -oE 'make [A-Za-z0-9_.-]+' | awk '{print $2}'); do
    if have_target "$m"; then :; else bad "$README:$line: 'make $m' has no such target"; fi
  done
done < <(grep -nE 'make [A-Za-z0-9_.-]+' "$README" || true)
while IFS=: read -r line text; do
  for m in $(echo "$text" | grep -oE 'make [A-Za-z0-9_.-]+' | awk '{print $2}'); do
    if have_target "$m"; then :; else bad "$MAKEFILE:$line: 'make $m' has no such target"; fi
  done
done < <(grep -nE 'make [A-Za-z0-9_.-]+' "$MAKEFILE" || true)

# 2. .PHONY entries must resolve (handles backslash continuations).
phony=$(tr '\\\n' '  ' < "$MAKEFILE" | grep -oE '\.PHONY:[^#]*' | sed 's/^\.PHONY://')
for p in $phony; do
  if have_target "$p"; then :; else bad "$MAKEFILE: .PHONY entry '$p' has no such target"; fi
done

echo "== file paths =="
# 3. Path-like tokens. A token is checked when it:
#      - starts with ./ or a known source prefix, or
#      - is a bare filename with a checkable extension.
#    Skipped: URLs, shell expansions ($), templates ({...}), wildcards (*),
#    Go module paths (@version or known hosts), runtime-generated files.
check_token() { # file line token
  local file="$1" line="$2" tok="$3" path="$tok" isdir=0
  case "$tok" in
    *'://'*|*'$'*|*'{'*|*'}'*|*'*'*|*'...'*|*'@'*|github.com/*|golang.org/*|go.*/*|honnef.co/*|raw.githubusercontent.com/*) return 0 ;;
    coverage.out|coverage.html|cpu.prof|mem.prof|api.log) return 0 ;;  # generated at runtime
    ./bin) return 0 ;;  # created by `make build`
  esac
  case "$path" in
    ./*) path="${path#./}" ;;
  esac
  case "$path" in
    */...) path="${path%/...}" ; isdir=1 ;;
  esac
  case "$tok" in
    ./*|internal/*|cmd/*|services/*|proto/*|docs/*|scripts/*|deploy/*|bin/*|openspec/*) ;;
    *.http|*.yml|*.yaml|*.sql|*.mod|*.sum|*.sh|*.json|*.md|*.toml) ;;
    *) return 0 ;;
  esac
  if [ "$isdir" = 1 ]; then
    [ -d "$ROOT/$path" ] || bad "$file:$line: dir '$tok' not found"
  elif [ "${tok%/}" != "$tok" ]; then
    [ -d "$ROOT/${path%/}" ] || bad "$file:$line: dir '$tok' not found"
  else
    [ -e "$ROOT/$path" ] || bad "$file:$line: file '$tok' not found"
  fi
}

TOKEN_RE='[A-Za-z0-9_.~+-]+(/[A-Za-z0-9_.~+-]+)+/?'
BARE_RE='[A-Za-z0-9_.-]+\.(http|yml|yaml|sql|mod|sum|sh|json|md|toml|example)'
# Strip URLs first (bare filenames inside them are not repo refs), and skip
# fenced code blocks in the README: those hold illustrative commands and
# hypothetical paths (e.g. the new-microservice runbook). The Makefile has no
# fences; every path there is a real reference and is always checked.
scan_file() { # file — emits orig_lineno:content for checkable lines
  local f="$1" line='' n=0 in_fence=0 fence_lang=''
  local stripped
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    if [ "$f" = "$README" ]; then
      case "$line" in
        '```'*)
          if [ "$in_fence" = 1 ]; then in_fence=0; fence_lang='';
          else in_fence=1; fence_lang="${line#\`\`\`}"; fi
          continue ;;
      esac
      # Skip language-tagged fences (commands, illustrative code); scan
      # unlabeled fences (repo listings, diagrams) as references.
      if [ "$in_fence" = 1 ] && [ -n "$fence_lang" ]; then continue; fi
    fi
    stripped=$(echo "$line" | sed -E 's|https?://[^ )"`]*||g')
    printf '%d:%s\n' "$n" "$stripped"
  done < "$f"
}
for f in "$README" "$MAKEFILE"; do
  while IFS=: read -r line text; do
    paths=$(echo "$text" | grep -oE "$TOKEN_RE" || true)
    bares=$(echo "$text" | grep -oE "$BARE_RE" || true)
    for tok in $paths; do
      check_token "$f" "$line" "$tok"
    done
    for tok in $bares; do
      # Skip a bare filename already covered by a full path on the same line
      # (e.g. `auth-flow.md` in `docs/auth-flow.md`).
      covered=0
      for p in $paths; do
        case "$p" in
          */"$tok") covered=1; break ;;
        esac
      done
      [ "$covered" = 1 ] || check_token "$f" "$line" "$tok"
    done
  done < <(scan_file "$f")
done

if [ "$fail" = 0 ]; then
  echo "check-refs: OK"
else
  echo "check-refs: FAILED"
  exit 1
fi
