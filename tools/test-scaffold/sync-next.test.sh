#!/usr/bin/env bash
# scaffold.sh's SYNC_NEXT reporter — "what does this run still need from the human?"
#
# WHAT THIS GUARDS. A sync writes things Claude Code only reads when a session starts (.claude/settings.json,
# .mcp.json, the hooks of plugins it just enabled) and things a container only reads when it is CREATED
# (everything under .devcontainer/). Neither can take effect mid-session, so the run has to SAY which boundary
# it needs. When that report regresses it does not fail loudly — it reports `none`, the run looks clean, and
# the human carries on in a session where the new settings silently are not in effect. That is the whole
# reason this reporter exists, so it gets a test.
#
# Two directions matter equally and are both covered below:
#   - UNDER-reporting is the dangerous one (a needed rebuild reported as `none`).
#   - OVER-reporting is the corrosive one (`restart-session` on every run trains everyone to ignore the line).
#
# HOW IT REACHES THE CODE. The reporter ships as a function inside scaffold.sh, at the end of a run that
# would otherwise require a real install, a migration ladder and a pile of generators to reach. So this
# extracts the marked block and evaluates it directly against real git repositories — the shipped text of the
# reporter, exercised on real `git diff` output, without the rest of the scaffolder. Its wiring into the run
# sequence stays covered by reading scaffold.sh (the call site passes $TARGET and $SYNC_BASE).
#
# The extraction FAILS LOUDLY when it finds nothing. An empty extraction would eval cleanly and every case
# below would pass while testing literally nothing — the same silent-success shape the reporter guards.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"

[ -f "$SCAFFOLD" ] || { echo "FATAL: scaffold.sh not found at $SCAFFOLD" >&2; exit 2; }

block="$(awk '/^# --->8--- SYNC_NEXT$/{f=1;next} /^# ---8<--- SYNC_NEXT$/{exit} f{print}' "$SCAFFOLD")"
if [ -z "$block" ]; then
  echo "FATAL: could not extract the SYNC_NEXT block from scaffold.sh." >&2
  echo "       Its markers moved or were removed. Refusing to run: an empty extraction would make every" >&2
  echo "       case below pass while testing nothing." >&2
  exit 2
fi
# Prove the extracted text is actually the reporter, not some other block between stray markers.
for needle in _sync_next rebuild-container restart-session SYNC_RELOAD; do
  case "$block" in
    *"$needle"*) ;;
    *) echo "FATAL: extracted block does not mention '$needle' — wrong block captured." >&2; exit 2 ;;
  esac
done
eval "$block"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-52s\n' "$1"; else printf '  FAIL %-52s (%s)\n' "$1" "${3:-}"; FAILED=1; fi }

# A repo at a known base, into which each case then writes. Returns the base sha on stdout.
fixture() {   # fixture <name> -> repo path on stdout (base sha written to <repo>/.base)
  local repo="$TMP/$1"
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  printf 'placeholder\n' > "$repo/README.md"
  mkdir -p "$repo/.devcontainer" "$repo/.claude"
  printf '{}\n' > "$repo/.devcontainer/devcontainer.json"
  printf '{}\n' > "$repo/.claude/settings.json"
  printf 'house\n' > "$repo/HOUSE.md"
  git -C "$repo" add -A >/dev/null 2>&1
  git -C "$repo" commit -qm base
  git -C "$repo" rev-parse HEAD > "$repo/.base"
  printf '.base\n' > "$repo/.git/info/exclude"
  printf '%s' "$repo"
}

check() {   # check <label> <repo> <expected-next> [expected-reload]
  local label="$1" repo="$2" want="$3" want_reload="${4-}"
  SYNC_NEXT=""; SYNC_RELOAD=""
  _sync_next "$repo" "$(cat "$repo/.base")"
  ok "$label" "$([ "$SYNC_NEXT" = "$want" ] && echo 1 || echo 0)" "got '$SYNC_NEXT', wanted '$want'"
  if [ -n "$want_reload" ]; then
    ok "$label — reload names $want_reload" "$([ "$SYNC_RELOAD" = "$want_reload" ] && echo 1 || echo 0)" "got '$SYNC_RELOAD'"
  fi
}

echo "SYNC_NEXT reporter"

# ── nothing that crosses a boundary ──────────────────────────────────────────────────────────────
r="$(fixture untouched)"
check "an untouched tree needs nothing" "$r" none

r="$(fixture ordinary)"
printf 'changed\n' > "$r/README.md"
check "an ordinary source change needs nothing" "$r" none

# ── the restart boundary ─────────────────────────────────────────────────────────────────────────
r="$(fixture settings)"
printf '{"enabledPlugins":{"x":true}}\n' > "$r/.claude/settings.json"
check "a modified .claude/settings.json wants a restart" "$r" restart-session

r="$(fixture mcp-new)"
printf '{"mcpServers":{}}\n' > "$r/.mcp.json"
check "a NEWLY CREATED .mcp.json wants a restart" "$r" restart-session

# The untracked half is the one a plain `git diff` misses, and a first retrofit creates most of these
# files rather than editing them — so this is the common case, not an edge one.
r="$(fixture settings-untracked)"
rm -rf "$r/.claude" && mkdir -p "$r/.claude"
git -C "$r" rm -q --cached .claude/settings.json >/dev/null 2>&1
git -C "$r" commit -qm "drop settings" >/dev/null 2>&1
git -C "$r" rev-parse HEAD > "$r/.base"
printf '{}\n' > "$r/.claude/settings.json"
check "an UNTRACKED .claude/settings.json wants a restart" "$r" restart-session

# ── the rebuild boundary, and its precedence ─────────────────────────────────────────────────────
r="$(fixture devcontainer)"
printf '{"image":"x"}\n' > "$r/.devcontainer/devcontainer.json"
check "a changed .devcontainer/ wants a rebuild" "$r" rebuild-container

r="$(fixture devcontainer-extra)"
printf 'echo hi\n' > "$r/.devcontainer/post-create.sh"
check "any NEW file under .devcontainer/ wants a rebuild" "$r" rebuild-container

# A rebuild IS a new session and its post-create reinstalls the plugins, so reporting both would be two
# boundaries where one will do — the precise thing this reporter exists to collapse.
r="$(fixture both)"
printf '{"image":"x"}\n' > "$r/.devcontainer/devcontainer.json"
printf '{"enabledPlugins":{"x":true}}\n' > "$r/.claude/settings.json"
check "a rebuild SUBSUMES a restart (never both)" "$r" rebuild-container

# ── near misses that must NOT trip it ────────────────────────────────────────────────────────────
r="$(fixture settings-local)"
printf '{}\n' > "$r/.claude/settings.local.json"
check "a machine-local settings file is not a boundary" "$r" none

r="$(fixture nested-name)"
mkdir -p "$r/docs/.devcontainer"
printf 'x\n' > "$r/docs/.devcontainer/notes.md"
check ".devcontainer NOT at the repo root is not a rebuild" "$r" none

# ── guidance files reload in-session; they are not a boundary ─────────────────────────────────────
r="$(fixture guidance)"
printf 'new house rules\n' > "$r/HOUSE.md"
printf 'directives\n' > "$r/HOUSE.rules.md"
check "changed house guidance is NOT a boundary" "$r" none "HOUSE.md HOUSE.rules.md"

r="$(fixture guidance-with-restart)"
printf 'new house rules\n' > "$r/HOUSE.md"
printf '{"enabledPlugins":{"x":true}}\n' > "$r/.claude/settings.json"
check "guidance is reported ALONGSIDE a boundary" "$r" restart-session "HOUSE.md"

# ── no base to compare against ────────────────────────────────────────────────────────────────────
r="$(fixture nobase)"
SYNC_NEXT=""; SYNC_RELOAD=""
_sync_next "$r" ""
ok "no git base reports 'unknown', never 'none'" "$([ "$SYNC_NEXT" = unknown ] && echo 1 || echo 0)" "got '$SYNC_NEXT'"

if [ "$FAILED" = 0 ]; then echo "  SYNC_NEXT reporter: all cases passed"; fi
exit "$FAILED"
