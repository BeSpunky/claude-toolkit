#!/usr/bin/env bash
# `house.sh new` creates the project's OWN repository — even inside another one — and commits only into it.
#
# WHY THIS IS A TEST. Every bare `git` call finds its repository by walking UP. `new` into a folder inside an existing
# repository therefore saw that outer repository: create-nx-workspace ("already under version control") skipped its
# `git init`, and the scaffold's closing `git add -A && git commit` committed the whole new project — and anything the
# outer repo had staged — onto whatever branch the OUTER checkout had out, a protected line included. It surfaced as a
# scaffold under .claude/worktrees/ committing into the toolkit's own checkout, and passed unnoticed only because that
# folder is gitignored: silent by construction.
#
# The same question on an upgrade: a project in a folder its enclosing repository IGNORES is versioned by nothing —
# that repository's HEAD holds none of its files — so it is no restore point, and migrations must not commit there.
#
# What is asserted:
#   the WIRING   — on both hosts the rendered program makes the target its own repository right after the floor's
#                  `cd` (before nx init reads it), create-nx-workspace is told --skipGit, and no git init/add/commit
#                  is spelled anywhere outside the shipped functions;
#   the BEHAVIOUR — those functions, lifted from the rendered program and run in a subfolder of a scratch repo with a
#                  dirty tracked file and a staged one: a new repository at the target holding the scaffold commit on
#                  main, the outer HEAD and index byte-identical, the dirty file still unstaged; and the commit
#                  REFUSES in a folder that is not its repository's top;
#   the UPGRADE  — a project in an ignored folder of another repo is refused as unversioned (BACKUP_ABORT), one in a
#                  tracked subfolder is upgraded against that repository.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOUSE_SH="$ROOT/plugins/house/engine/house.sh"
[ -f "$HOUSE_SH" ] || { echo "FATAL: house.sh not found at $HOUSE_SH" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
FAILED=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAILED=1; }

# ── the wiring ────────────────────────────────────────────────────────────────────────────────────────────────────
mkdir -p "$TMP/work"
WRAPPER="$(bash "$HOUSE_SH" new --print-inner "$TMP/work/plain" 2>/dev/null)"
NODE="$(bash "$HOUSE_SH" new --print-inner --preset=angular "$TMP/work/shop" 2>/dev/null)"

# the program outside the shipped git functions (and comments)
outside() { printf '%s\n' "$1" | awk '/^(_is_own_repository|_own_repository|_commit_scaffold) \(\)/{f=1} f&&/^}/{f=0; next} !f' | grep -vE '^[[:space:]]*#'; }

for host in wrapper node; do
  echo "── new, $host host: the target becomes its own repository"
  if [ "$host" = wrapper ]; then prog="$WRAPPER"; else prog="$NODE"; fi
  cd_line="$(printf '%s\n' "$prog" | grep -n '^cd "\$HOUSE_PROJECT_DIR_NAME"' | head -1 | cut -d: -f1)"
  own_line="$(printf '%s\n' "$prog" | grep -n '^_own_repository$' | head -1 | cut -d: -f1)"
  nx_line="$(printf '%s\n' "$prog" | grep -nvE '^[[:space:]]*#' | grep -E 'nx(@latest)? init|^[0-9]+:\./nx |nx add ' | head -1 | cut -d: -f1)"
  if [ -n "$cd_line" ] && [ -n "$own_line" ] && [ "$own_line" -gt "$cd_line" ] && { [ -z "$nx_line" ] || [ "$own_line" -lt "$nx_line" ]; }; then
    ok "_own_repository runs after the floor's cd (line $cd_line → $own_line) and before any nx (${nx_line:-none})"
  else
    fail "_own_repository placement: cd ${cd_line:-none}, own ${own_line:-none}, first nx ${nx_line:-none}"
  fi
  if outside "$prog" | grep -qE '(^|[;&|[:space:]])git (init|add|commit)\b'; then
    fail "a git init/add/commit is spelled outside the shipped functions: $(outside "$prog" | grep -m1 -E 'git (init|add|commit)')"
  else
    ok "no git init/add/commit outside the shipped functions"
  fi
  printf '%s\n' "$prog" | grep -q "^_commit_scaffold '" && ok "the scaffold commit goes through _commit_scaffold" || fail "no _commit_scaffold call"
done
grep -E 'create.nx-workspace' <<< "$NODE" | grep -q -- '--skipGit=true' \
  && ok "create-nx-workspace is told --skipGit (its own check skips the init inside any enclosing repo)" \
  || fail "create-nx-workspace runs without --skipGit: $(grep -m1 -E 'create.nx-workspace' <<< "$NODE")"

# ── the behaviour ─────────────────────────────────────────────────────────────────────────────────────────────────
echo "── new into a subfolder of a repository with a dirty and a staged file"
FNS="$TMP/fns.sh"
printf '%s\n' "$NODE" | awk '/^(_is_own_repository|_own_repository|_commit_scaffold) \(\)/{f=1} f{print} f&&/^}/{f=0}' > "$FNS"
[ "$(grep -c ' () $' "$FNS")" = 3 ] || fail "could not lift the three git functions from the rendered program"

OUTER="$TMP/outer"
git init -q -b development "$OUTER"
printf 'v1\n' > "$OUTER/tracked.txt"; printf 'a\n' > "$OUTER/staged.txt"
git -C "$OUTER" add -A && git -C "$OUTER" commit -qm init
printf 'v2\n' > "$OUTER/tracked.txt"                                   # dirty, unstaged
printf 'b\n' > "$OUTER/staged.txt"; git -C "$OUTER" add staged.txt     # staged
head_before="$(git -C "$OUTER" rev-parse HEAD)"
index_before="$(git -C "$OUTER" ls-files -s --debug | sha1sum)"
mkdir -p "$OUTER/nested"

out="$(cd "$OUTER/nested" && mkdir proj && cd proj && bash -c "set -e; . '$FNS'; _own_repository; printf x > nx.json; _commit_scaffold 'chore: scaffold'" 2>&1)"; rc=$?
P="$OUTER/nested/proj"
[ "$rc" -eq 0 ] && ok "the scaffold's git steps succeed" || fail "the scaffold's git steps failed (rc=$rc): $out"
[ "$(cd "$(git -C "$P" rev-parse --show-toplevel)" && pwd -P)" = "$(cd "$P" && pwd -P)" ] && ok "a new repository at the target" || fail "the target is not its own repository"
[ "$(git -C "$P" rev-parse --abbrev-ref HEAD 2>/dev/null)" = main ] && ok "on main (nx.json's defaultBase), not the machine's default" || fail "branch is '$(git -C "$P" rev-parse --abbrev-ref HEAD 2>/dev/null)'"
[ "$(git -C "$P" log --format=%s 2>/dev/null)" = "chore: scaffold" ] && git -C "$P" ls-files --error-unmatch nx.json >/dev/null 2>&1 \
  && ok "the scaffold commit is in the project's repository" || fail "the project's repository lacks the scaffold commit"
[ "$(git -C "$OUTER" rev-parse HEAD)" = "$head_before" ] && ok "the outer HEAD is untouched" || fail "the outer HEAD moved: $(git -C "$OUTER" log --oneline -1)"
[ "$(git -C "$OUTER" ls-files -s --debug | sha1sum)" = "$index_before" ] && ok "the outer index is untouched" || fail "the outer index changed"
git -C "$OUTER" diff --name-only | grep -qx tracked.txt && ! git -C "$OUTER" diff --cached --name-only | grep -qx tracked.txt \
  && ok "the dirty file is still unstaged" || fail "the dirty file's state changed"
git -C "$OUTER" diff --cached --name-only | grep -qx staged.txt && ok "the staged file is still staged, uncommitted" || fail "the staged file's state changed"

echo "── the commit refuses a folder that is not its repository's top"
mkdir -p "$OUTER/loose"
out="$(cd "$OUTER/loose" && printf y > f && bash -c ". '$FNS'; _commit_scaffold 'chore: scaffold'" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && grep -q 'refusing to commit' <<< "$out" && [ "$(git -C "$OUTER" rev-parse HEAD)" = "$head_before" ] \
  && ok "refused, outer HEAD untouched" || fail "not refused (rc=$rc): $out"

echo "── _own_repository leaves an existing repository alone"
out="$(cd "$P" && bash -c ". '$FNS'; _own_repository" 2>&1)"
[ -z "$out" ] && [ "$(git -C "$P" log --format=%s)" = "chore: scaffold" ] && ok "no re-init of a repository's top" || fail "re-initialised: $out"

# ── the upgrade ───────────────────────────────────────────────────────────────────────────────────────────────────
echo "── upgrade of a project nested in another repository"
U="$TMP/u"
git init -q -b feat "$U"
printf 'ignored/\n' > "$U/.gitignore"
for d in ignored/proj tracked/proj; do mkdir -p "$U/$d"; printf '{}\n' > "$U/$d/nx.json"; printf '{"name":"x","private":true}\n' > "$U/$d/package.json"; done
git -C "$U" add -A && git -C "$U" commit -qm init
out="$(bash "$HOUSE_SH" upgrade --print-inner "$U/ignored/proj" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && grep -q 'BACKUP_ABORT: .* is not versioned by git' <<< "$out" \
  && ok "a folder the enclosing repository ignores is refused as unversioned" || fail "an ignored folder was not refused (rc=$rc): $(grep -m1 BACKUP <<< "$out")"
out="$(bash "$HOUSE_SH" upgrade --print-inner "$U/tracked/proj" 2>&1)"
grep -qF "BACKUP_OK: working tree clean — the pre-upgrade restore point is HEAD($(git -C "$U" rev-parse --short=7 HEAD))" <<< "$out" \
  && ok "a tracked subfolder is upgraded against its repository" || fail "a tracked subfolder: $(grep -m1 -E 'BACKUP|ERROR' <<< "$out")"
grep -q '^_git_versions ()' <<< "$out" && ! grep -qE '^ *if git rev-parse --git-dir' <<< "$out" \
  && ok "the upgrade program asks _git_versions, never a bare walk-up" || fail "the upgrade program still detects git by a bare walk-up"

exit "$FAILED"
