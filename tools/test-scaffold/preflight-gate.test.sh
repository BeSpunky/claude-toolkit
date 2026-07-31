#!/usr/bin/env bash
# scaffold.sh's PREFLIGHT GATE, exercised against real git repositories.
#
# WHAT THIS GUARDS. The gate is the only thing standing between a sync and an irreversible git act on a
# repository that was not ready — `nx migrate --run-migrations --create-commits` stages with `git add -A` and
# commits onto whatever branch HEAD is. When a gate like that regresses it does not fail loudly; it simply
# stops refusing, and the next sync quietly commits someone's in-flight work under a migration's name. That is
# the exact failure this repo already shipped once, which is why the gate has a test at all.
#
# HOW IT REACHES THE CODE, AND THE HONEST COST. The gate ships as shell rendered into a string inside
# scaffold.sh, executed in the project (sometimes inside Docker). Running the whole scaffolder in CI to reach
# it would drag in argument parsing, runtime selection, Docker and a real install — heavy, slow, and testing
# mostly other things. So this extracts the two blocks by their markers and evaluates them directly. That
# tests the SHIPPED TEXT of the gate, but not its wiring into the run sequence; wiring stays covered by
# reading the rendered order in scaffold.sh.
#
# The extraction is the fragile part, so it FAILS LOUDLY when it finds nothing. An empty extraction would eval
# cleanly, every fixture would report PASS, and the suite would go green while testing literally nothing —
# the same shape of silent success the gate itself exists to prevent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"
NX_TOOLS_VERSION=9.9.9   # render-time substitution; the gate only echoes it

[ -f "$SCAFFOLD" ] || { echo "FATAL: scaffold.sh not found at $SCAFFOLD" >&2; exit 2; }

extract() {   # extract <assignment marker> — the block from its opening line to its closing `fi"`
  local marker="$1" out
  out="$(awk -v s="$marker" 'index($0,s)==1{f=1} f{print} f&&/^fi"$/{exit}' "$SCAFFOLD")"
  if [ -z "$out" ]; then
    echo "FATAL: could not extract '$marker' from scaffold.sh." >&2
    echo "       The block moved or its closing marker changed. Refusing to run: an empty extraction" >&2
    echo "       would make every case below pass while testing nothing." >&2
    return 2
  fi
  printf '%s\n' "$out"
}

# Captured, checked, THEN evaluated — deliberately not `eval "$(extract ...)"`. A failure inside a command
# substitution exits only the subshell, so the inline form would print the fatal message and carry on with an
# empty block. Caught in testing by the assertions below, which is precisely why they are also here.
checks_src="$(extract 'PREFLIGHT_CHECKS="')"   || exit 2
verdict_src="$(extract 'PREFLIGHT_VERDICT="')" || exit 2
eval "$checks_src"
eval "$verdict_src"

# Belt and braces: prove the extracted text is actually the gate, not some other block that happens to end
# in `fi"`. Without this, a marker collision degrades to a vacuous pass exactly like an empty extraction.
for needle in dirty-tree protected-branch detached-head no-branch-model; do
  case "${PREFLIGHT_CHECKS:-}" in
    *"$needle"*) ;;
    *) echo "FATAL: extracted PREFLIGHT_CHECKS does not mention '$needle' — wrong block?" >&2; exit 2 ;;
  esac
done
case "${PREFLIGHT_VERDICT:-}" in
  *SYNC_REFUSED*) ;;
  *) echo "FATAL: extracted PREFLIGHT_VERDICT does not emit SYNC_REFUSED — wrong block?" >&2; exit 2 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

mkrepo()  { local d="$TMP/$1"; mkdir -p "$d"; git -C "$d" init -q -b main; echo "$d"; }
commit()  { echo x > "$1/f.txt"; git -C "$1" add -A; git -C "$1" commit -qm init; }

# Run the gate in <dir> and reduce it to its verdict line(s), or PASS when it lets the run through.
gate() {
  local out
  out="$( cd "$1" && ( set -e; MIGRATE_FROM=''; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT"; echo '__PASS__' ) 2>&1 )"
  if printf '%s' "$out" | grep -q '__PASS__'; then echo 'PASS'
  else printf '%s\n' "$out" | grep -E '^SYNC_(REFUSED|ASK):' | tr '\n' ' ' | sed 's/ *$//'; fi
}

FAILED=0
check() {   # check <label> <expected> <dir>
  local got; got="$(gate "$3")"
  if [ "$got" = "$2" ]; then printf '  ok   %-32s %s\n' "$1" "$got"
  else printf '  FAIL %-32s got:[%s] want:[%s]\n' "$1" "$got" "$2"; FAILED=1; fi
}

# ── No repository, or no history: nothing to protect ────────────────────────────────────────────────────────
d="$TMP/plain"; mkdir -p "$d"
check 'not a git repo' 'PASS' "$d"

# A repository with no commits is NEW, not ambiguous — being asked about a branch model while creating an
# empty project would be absurd.
d="$(mkrepo empty)"
check 'git repo, no commits' 'PASS' "$d"

# ── The branch model ────────────────────────────────────────────────────────────────────────────────────────
# Real history on a lone `main`: genuinely ambiguous, and the one case the gate ASKS rather than deciding.
d="$(mkrepo lone)"; commit "$d"
check 'lone main with history' 'SYNC_ASK: no-branch-model' "$d"

# ONLY PROTECT WHAT EXISTS: the refusal is derived from the repo's own state — a `development` branch is the
# evidence the model was adopted. Same `main`, opposite verdict, purely because of that branch.
d="$(mkrepo prot)"; commit "$d"; git -C "$d" branch development
check 'on main, development exists' 'SYNC_REFUSED: protected-branch' "$d"
git -C "$d" checkout -q development
check 'on development' 'SYNC_REFUSED: protected-branch' "$d"

d="$(mkrepo feat)"; commit "$d"; git -C "$d" branch development; git -C "$d" checkout -q -b fix/x
check 'feature branch, clean' 'PASS' "$d"

# Commits made on a detached HEAD belong to no branch and are unreachable the moment anything is checked out.
d="$(mkrepo det)"; commit "$d"; git -C "$d" checkout -q --detach HEAD
check 'detached HEAD' 'SYNC_REFUSED: detached-head' "$d"

# ── The dirty tree, and the count that must not lie ─────────────────────────────────────────────────────────
d="$(mkrepo dirty)"; commit "$d"; git -C "$d" branch development; git -C "$d" checkout -q -b fix/y
echo change >> "$d/f.txt"                                     # modified
mkdir -p "$d/libs/keeper/src" "$d/libs/inquiry"               # untracked DIRECTORIES
echo n > "$d/libs/keeper/src/a.ts"; echo n > "$d/libs/keeper/index.ts"; echo n > "$d/libs/inquiry/b.ts"
echo s > "$d/staged.txt"; git -C "$d" add staged.txt          # staged
check 'dirty tree, feature branch' 'SYNC_REFUSED: dirty-tree' "$d"

# Git COLLAPSES an untracked directory to one porcelain entry, so without `-uall` three files across two new
# libraries report as `untracked=1` — the figure a reader skims past, for the work least likely to be
# reconstructable. This asserts the count is per FILE.
counts="$( cd "$d" && ( set -e; MIGRATE_FROM=''; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT" ) 2>&1 \
  | grep -oE 'staged=[0-9]+  modified=[0-9]+  untracked=[0-9]+' )"
if [ "$counts" = 'staged=1  modified=1  untracked=3' ]; then
  printf '  ok   %-32s %s\n' 'untracked counted per file' "$counts"
else
  printf '  FAIL %-32s got:[%s] want:[staged=1  modified=1  untracked=3]\n' 'untracked counted per file' "$counts"
  FAILED=1
fi

# ── Aggregation: every check runs, one verdict reports them all ─────────────────────────────────────────────
# The reason the gate exists as a gate rather than three inline exits. A run wrong in two ways must say so
# once, not over two round trips.
d="$(mkrepo both)"; commit "$d"; git -C "$d" branch development; git -C "$d" checkout -q development
echo change >> "$d/f.txt"
check 'dirty + protected together' 'SYNC_REFUSED: dirty-tree protected-branch' "$d"

exit "$FAILED"
