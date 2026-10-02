#!/usr/bin/env bash
# A sync names the project after the PROJECT, not after the directory it happens to run in.
#
# WHY THIS IS A TEST. The house sync opens its own git worktree (`house-sync-<date>`) when it starts on a protected
# branch, and `PROJECT="$(basename "$TARGET")"` then told every generator the project was called
# `house-sync-2026-10-02`: house-doc, the window identity, and — whenever the app can't be inferred (no app, or
# more than one) — the app the per-app steps run on. Nothing fails; the date slug is simply written into the
# project as its name. The fix separates the two concepts: the DIRECTORY (every path use, handed to the program as
# environment) and the IDENTITY (the name the same directory has in the repository's main worktree).
#
# What is asserted: a linked worktree `house-sync-2026-10-02` of `myrepo` renders a program that names `myrepo`
# everywhere a name is passed and never names the worktree; the program reaches its directory only through the
# environment; and the shipped identity rule (lifted out of scaffold.sh) answers correctly for the main worktree,
# a linked one, a workspace in a SUBDIRECTORY of its repository (named after the subdirectory, in any worktree),
# and a directory outside git (its own name, as before).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"
[ -f "$SCAFFOLD" ] || { echo "FATAL: scaffold.sh not found at $SCAFFOLD" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# myrepo (main worktree, on main) + a linked worktree named the way the house sync names its own.
REPO="$TMP/myrepo"
mkdir -p "$REPO/web"
printf '{ "name": "myrepo", "private": true }\n' > "$REPO/package.json"
printf '{}\n' > "$REPO/nx.json"
printf '{ "name": "web", "private": true }\n' > "$REPO/web/package.json"
printf '{}\n' > "$REPO/web/nx.json"
git -C "$REPO" init -q -b main && git -C "$REPO" add -A && git -C "$REPO" commit -qm init
WT="$TMP/worktrees/house-sync-2026-10-02"
mkdir -p "$TMP/worktrees"
git -C "$REPO" worktree add -q -b chore/house-sync-2026-10-02 "$WT" 2>/dev/null \
  || { echo "FATAL: could not create the linked worktree fixture." >&2; exit 2; }

# ── the rendered program ────────────────────────────────────────────────────────────────────────────────────────
echo "── a sync inside a linked worktree names the repository, not the worktree"
_prog="$(bash "$SCAFFOLD" --print-inner --sync --yes "$WT" 2>/dev/null)"
[ -n "$_prog" ] || { echo "FATAL: the sync did not render (see render.test.sh)." >&2; exit 2; }
grep -qF -- '--project=myrepo' <<< "$_prog" \
  && ok "the plan is told --project=myrepo" || fail "the plan is not told --project=myrepo"
grep -qF -- "_resolve_sync_app 'node_modules/@bespunky/nx-tools' '' 'myrepo'" <<< "$_prog" \
  && ok "the fallback app name is myrepo" || fail "the fallback app name is not myrepo"
if grep -q 'house-sync-2026-10-02' <<< "$_prog"; then
  fail "the program names the worktree directory: $(grep -m1 'house-sync-2026-10-02' <<< "$_prog")"
else
  ok "the worktree's directory name appears nowhere in the program"
fi
grep -qF 'cd "$SCAFFOLD_WORK_ROOT/$SCAFFOLD_PROJECT_DIR_NAME"' <<< "$_prog" \
  && ok "the program reaches its directory through the environment" \
  || fail "the program does not cd through \$SCAFFOLD_PROJECT_DIR_NAME"

# ── the identity rule ───────────────────────────────────────────────────────────────────────────────────────────
echo "── the identity is the directory's name in the main worktree"
FN="$(sed -n '/^_project_identity() {/,/^}/p' "$SCAFFOLD")"
[ -n "$FN" ] || { echo "FATAL: could not lift _project_identity out of scaffold.sh — the markers moved." >&2; exit 2; }
eval "$FN"
id_case() {   # <label> <dir> <expected>
  local got; got="$(_project_identity "$2")"
  [ "$got" = "$3" ] && ok "$1 → $3" || fail "$1 — expected '$3', got '$got'"
}
NOGIT="$TMP/plain-dir"; mkdir -p "$NOGIT"
id_case 'the main worktree'                 "$REPO"     myrepo
id_case 'a linked worktree'                 "$WT"       myrepo
id_case 'a subdirectory workspace (main)'   "$REPO/web" web
id_case 'a subdirectory workspace (linked)' "$WT/web"   web
id_case 'a directory outside git'           "$NOGIT"    plain-dir

[ "$FAILED" -eq 0 ] && echo "a sync names the project, not its directory"
exit "$FAILED"
