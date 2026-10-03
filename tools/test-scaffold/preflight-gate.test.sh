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
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/text.sh"  # in_text: grep captured output without a SIGPIPE race
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAFFOLD="$ROOT/plugins/project-starter/skills/new-project/assets/scaffold.sh"
NX_TOOLS_VERSION=9.9.9   # render-time substitution; the gate only echoes it

[ -f "$SCAFFOLD" ] || { echo "FATAL: scaffold.sh not found at $SCAFFOLD" >&2; exit 2; }

extract() {   # extract <assignment marker> [<closing line>] — the block from its opening line to its closing line (`fi"`)
  local marker="$1" end="${2:-fi\"}" out
  out="$(awk -v s="$marker" -v e="$end" 'index($0,s)==1{f=1} f{print} f&&$0==e{exit}' "$SCAFFOLD")"
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
# The gate renders the shared mount-point functions in by value (scaffold.sh does the same `declare -f`), so the
# extracted assignment needs them defined before it is evaluated.
# shellcheck source=../../plugins/project-starter/skills/new-project/assets/house-mounts.sh
. "$ROOT/plugins/project-starter/skills/new-project/assets/house-mounts.sh"
HOUSE_MOUNTS_FNS="$(declare -f house_mount_points house_unwritable_mounts house_post_create)"
# The branch-model reader, rendered in by value the same way.
# shellcheck source=../../plugins/project-starter/skills/new-project/assets/house-branches.sh
. "$ROOT/plugins/project-starter/skills/new-project/assets/house-branches.sh"
HOUSE_BRANCHES_FNS="$(house_branches_fns)"
# The branch model is resolved once, above the gate, and the gate embeds that block — so it is extracted first.
model_src="$(extract 'BRANCH_MODEL_BLOCK="' 'esac"')" || exit 2
eval "$model_src"
checks_src="$(extract 'PREFLIGHT_CHECKS="')"   || exit 2
verdict_src="$(extract 'PREFLIGHT_VERDICT="')" || exit 2
# `--staging` is substituted at RENDER time, so a case that passes it re-renders the checks (render_checks 1).
render_checks() { STAGING="$1"; eval "$checks_src"; }
render_checks 0
eval "$verdict_src"

# Belt and braces: prove the extracted text is actually the gate, not some other block that happens to end
# in `fi"`. Without this, a marker collision degrades to a vacuous pass exactly like an empty extraction.
for needle in dirty-tree protected-branch detached-head branch-model-unreadable staging-without-stage \
    'branch-model: undeclared' unwritable-mounts; do
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
# Root-owned fixtures (the unwritable-mounts cases) may not be removable by this user; sudo cleans those up.
trap 'rm -rf "$TMP" 2>/dev/null || sudo -n rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

mkrepo()  { local d="$TMP/$1"; mkdir -p "$d"; git -C "$d" init -q -b main; echo "$d"; }
commit()  { echo x > "$1/f.txt"; git -C "$1" add -A; git -C "$1" commit -qm init; }

# Run the gate in <dir> and reduce it to its verdict line(s), or PASS when it lets the run through.
gate() {
  local out
  out="$( cd "$1" && ( set -e; MIGRATE_FROM=''; _stage() { :; }; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT"; echo '__PASS__' ) 2>&1 )"
  if in_text "$out" -q '__PASS__'; then echo 'PASS'
  else printf '%s\n' "$out" | grep -E '^SYNC_REFUSED:' | tr '\n' ' ' | sed 's/ *$//'; fi
}
# The branch-model SIGNAL the gate prints (blocking nothing by itself), reduced to its state word, or NONE.
signal() {
  local out
  out="$( cd "$1" && ( set -e; MIGRATE_FROM=''; _stage() { :; }; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT" ) 2>&1 )"
  printf '%s\n' "$out" | sed -n 's/^\[preflight\] branch-model: \([a-z]*\).*/\1/p' | head -1 | grep . || echo NONE
}

FAILED=0
# What the gate SAYS, not only what it decides: a refusal whose remedy names the wrong base, or a "protected" list
# naming branches the repo does not have, passes every verdict check and still sends the reader the wrong way.
says() {   # says <label> <dir> <needle>… — each needle must appear; a needle starting with '!' must NOT
  local out n ok=1
  out="$( cd "$2" && ( set -e; MIGRATE_FROM=''; _stage() { :; }; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT" ) 2>&1 )"
  local label="$1"; shift 2
  for n in "$@"; do
    case "$n" in
      '!'*) case "$out" in *"${n#!}"*) ok=0; printf '  FAIL %-32s says [%s]\n' "$label" "${n#!}" ;; esac ;;
      *)    case "$out" in *"$n"*) ;; *) ok=0; printf '  FAIL %-32s missing [%s]\n' "$label" "$n" ;; esac ;;
    esac
  done
  if [ "$ok" = 1 ]; then printf '  ok   %-32s\n' "$label"; else printf '%s\n' "$out" | sed 's/^/         /'; FAILED=1; fi
}
check() {   # check <label> <expected> <dir> [<expected branch-model signal>]
  local got; got="$(gate "$3")"
  [ $# -ge 4 ] && got="$got | $(signal "$3")" && set -- "$1" "$2 | $4" "$3"
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

upstream0() {   # upstream0 <name> <branch> — a clone whose only §3 name lives on origin (no local branch of it)
  local seed="$TMP/$1-seed" bare="$TMP/$1.git" clone="$TMP/$1"
  mkdir -p "$seed"; git -C "$seed" init -q -b "$2"; commit "$seed"
  git clone -q --bare "$seed" "$bare"; git clone -q "$bare" "$clone" 2>/dev/null
  git -C "$clone" checkout -q -b tmp-x; git -C "$clone" branch -q -D "$2"
  echo "$clone"
}

# ── The branch model: UNDECLARED ────────────────────────────────────────────────────────────────────────────
# No .bespunky/branches.json: the gate SIGNALS it (the /sync session investigates and asks) and, meanwhile,
# protects every name the toolkit ever forced plus gitflow's. A lone `main` used to be an ASK about this one run;
# its ambiguity is now resolved by declaring the model, and the run is kept off `main` until then.
d="$(mkrepo lone)"; commit "$d"
check 'undeclared, lone main' 'SYNC_REFUSED: protected-branch' "$d" undeclared
# Only the §3 names that EXIST are reported — master/develop/... are not branches here.
says 'undeclared names only existing' "$d" 'every branch named main is protected' '!master' "!'develop'" '!staging'
git -C "$d" checkout -q -b develop
check 'undeclared, on develop' 'SYNC_REFUSED: protected-branch' "$d" undeclared
git -C "$d" checkout -q -b fix/x
check 'undeclared, feature branch' 'PASS' "$d" undeclared

# `development` existing is no longer evidence of anything: same verdicts, still undeclared.
d="$(mkrepo prot)"; commit "$d"; git -C "$d" branch development
check 'undeclared, development exists' 'SYNC_REFUSED: protected-branch' "$d" undeclared
git -C "$d" checkout -q -b feat/y
check 'undeclared, development, feat' 'PASS' "$d" undeclared
says 'undeclared lists main+development' "$d" 'every branch named main, development is protected'
# A §3 name that exists only on origin is still a line someone has — it is listed.
c="$(upstream0 up-only staging)"; git -C "$c" checkout -q -b feat/o
says 'undeclared, origin-only staging' "$c" 'every branch named staging is protected'

# ── The branch model: DECLARED ──────────────────────────────────────────────────────────────────────────────
# Only the PROJECTION is read (CONTRACT §2). Fixtures carry just enough of the rest to be honest JSON.
declare_model() {   # declare_model <dir> <schema> <integration> <chain csv> <production csv> <patterns csv>
  local d="$1" q
  q() { [ -z "$1" ] && { printf '[]'; return; }; printf '["%s"]' "$(printf '%s' "$1" | sed 's/,/","/g')"; }
  mkdir -p "$d/.bespunky"
  cat > "$d/.bespunky/branches.json" <<JSON
{
  "schema": 1,
  "integration": { "branch": "$3", "baseline": null },
  "projection": {
    "schema": $2,
    "integration": "$3",
    "production": $(q "$5"),
    "productionPatterns": [],
    "chain": $(q "$4"),
    "protected": $(q "$4"),
    "protectedPatterns": $(q "$6"),
    "workBase": "$3",
    "summary": "$(printf '%s' "$4" | sed 's/,/ → /g')"
  }
}
JSON
}

# gitflow-ish: develop → main, release/* protected by glob. The model lands on the integration line's tip.
d="$(mkrepo gf)"; commit "$d"; git -C "$d" checkout -q -b develop
declare_model "$d" 1 develop develop,main main 'release/*'
git -C "$d" add -A && git -C "$d" commit -qm 'declare model'
check 'declared, on develop' 'SYNC_REFUSED: protected-branch' "$d" declared
git -C "$d" checkout -q main
check 'declared, on main (no copy here)' 'SYNC_REFUSED: protected-branch' "$d" declared
git -C "$d" checkout -q -b release/1.2 develop
check 'declared, glob release/1.2' 'SYNC_REFUSED: protected-branch' "$d" declared
# A release line's refusal points at integration — and says WHY that is the right base for a sync.
says 'release line: base + why' "$d" "Open a worktree off 'develop' (the integration line)" \
  'a sync is toolkit maintenance' "a fix meant for 'release/1.2' itself goes through the branch-and-release skill"
# `staging` is protected only while undeclared — a declared model that has no `staging` line does not own it.
git -C "$d" checkout -q -b staging develop
check 'declared, unlisted staging' 'PASS' "$d" declared
git -C "$d" checkout -q -b feat/z develop
check 'declared, work branch' 'PASS' "$d" declared
# A file `release/x` on disk must not turn the glob into a filesystem expansion.
mkdir -p "$d/release" && touch "$d/release/x" && git -C "$d" add -A && git -C "$d" commit -qm r
git -C "$d" checkout -q -b release/2.0
check 'declared, glob vs on-disk path' 'SYNC_REFUSED: protected-branch' "$d" declared

# A declaration that has not LANDED on its integration line is not in force (CONTRACT §1): the branch proposing
# it is still undeclared, and protection falls back to the undeclared names.
d="$(mkrepo prop)"; commit "$d"; git -C "$d" checkout -q -b chore/model
declare_model "$d" 1 main main main ''
git -C "$d" add -A && git -C "$d" commit -qm 'propose model'
check 'declared on a branch, not landed' 'PASS' "$d" undeclared

# ── Resolution (CONTRACT Amendment 2) — the same scenario list the engine's suite runs ─────────────────────────
# Asserts the resolver's own verdict (state + the ref it read) beside the gate's, because the gate's PASS/REFUSE
# alone cannot tell "declared from origin/dev" from "undeclared, but the name happens to be protected anyway".
resolves() {   # resolves <label> <dir> <want state> <want source|-> [<want note substring>]
  local out st src
  out="$(cd "$2" && house_branch_model)"
  st="$(printf '%s\n' "$out" | sed -n 's/^state=//p')"
  src="$(printf '%s\n' "$out" | sed -n 's/^source=//p')"; src="${src:--}"
  if [ "$st|$src" = "$3|$4" ] && { [ -z "${5:-}" ] || in_text "$out" -q "^note=.*$5"; }; then
    printf '  ok   %-32s %s\n' "$1" "$st via $src"
  else
    printf '  FAIL %-32s got:[%s via %s] want:[%s via %s%s]\n' "$1" "$st" "$src" "$3" "$4" "${5:+, note ~ $5}"
    printf '%s\n' "$out" | sed 's/^/         /'; FAILED=1
  fi
}
# A shared upstream: a bare `origin` and a clone of it. <name> names both.
upstream() {   # upstream <name> <first branch> — prints the CLONE's path; the seed repo is <name>-seed
  local seed="$TMP/$1-seed" bare="$TMP/$1.git" clone="$TMP/$1"
  mkdir -p "$seed"; git -C "$seed" init -q -b "$2"; commit "$seed"
  git clone -q --bare "$seed" "$bare"; git -C "$seed" remote add origin "$bare"; git -C "$seed" fetch -q origin
  git clone -q "$bare" "$clone" 2>/dev/null
  echo "$clone"
}
seed() { echo "$TMP/$1-seed"; }

# THE REPRODUCED BUG. Two-line `dev → prod`; this clone's LOCAL `dev` is stale (predates the declaration), the
# remote's carries it, HEAD is on `prod`. Stopping at the first ref found said "undeclared" and protected only the
# fallback names — so `prod`, the production line, let a sync commit onto it.
c="$(upstream up-stale dev)"; s_="$(seed up-stale)"
git -C "$s_" branch prod; git -C "$s_" push -q origin dev prod
git -C "$c" fetch -q; git -C "$c" checkout -q dev 2>/dev/null; git -C "$c" checkout -q -b prod origin/prod
declare_model "$s_" 1 dev dev,prod prod ''
git -C "$s_" add -A && git -C "$s_" commit -qm 'declare dev → prod'; git -C "$s_" branch -f prod dev
git -C "$s_" push -q origin dev prod
git -C "$c" fetch -q; git -C "$c" merge -q --ff-only origin/prod
resolves 'stale local dev, fresh origin' "$c" declared refs/remotes/origin/dev
check 'stale local dev, HEAD on prod' 'SYNC_REFUSED: protected-branch' "$c" declared

# NOT LANDED: the working copy declares lines the integration tip does not carry yet. Undeclared — but never with
# fewer protections than the copy itself declares: its `prod` and its `rel/*` stay protected beside the §3 names.
d="$(mkrepo notlanded)"; commit "$d"; git -C "$d" branch dev; git -C "$d" checkout -q -b prod
declare_model "$d" 1 dev dev,prod prod 'rel/*'
git -C "$d" add -A && git -C "$d" commit -qm 'propose dev → prod'
resolves 'not landed' "$d" undeclared - 'not in force until it lands'
check 'not landed, HEAD on its prod' 'SYNC_REFUSED: protected-branch' "$d" undeclared
# The refusal names the declaration's own integration line as the base — never HEAD, never "declares no model".
says 'not landed: base is its dev' "$d" "names 'dev' as its integration line but has not landed" \
  "Land the declaration on 'dev' first" "open a worktree off 'dev' and sync there" \
  'every branch named main, dev, prod, rel/* is protected' 'undeclared (not landed)' \
  "!Open a worktree off 'prod'" '!declares no branch model' '!master'
git -C "$d" checkout -q -b rel/1
check 'not landed, its glob rel/1' 'SYNC_REFUSED: protected-branch' "$d" undeclared
git -C "$d" checkout -q -b chore/m
check 'not landed, work branch' 'PASS' "$d" undeclared

# BOTH HOLD IT. Identical → either; one descends from the other → the descendant (here origin/dev, which added `qa`);
# diverged → the local one, said out loud.
c="$(upstream up-both dev)"; s_="$(seed up-both)"
declare_model "$s_" 1 dev dev,prod prod ''
git -C "$s_" add -A && git -C "$s_" commit -qm 'declare'; git -C "$s_" push -q origin dev
git -C "$c" pull -q --ff-only
resolves 'both hold, identical' "$c" declared refs/heads/dev
declare_model "$s_" 1 dev dev,qa,prod prod ''
git -C "$s_" add -A && git -C "$s_" commit -qm 'add qa'; git -C "$s_" push -q origin dev
git -C "$c" fetch -q; git -C "$c" checkout -q -b qa
resolves 'both hold, origin descends' "$c" declared refs/remotes/origin/dev
check 'both hold, origin adds qa' 'SYNC_REFUSED: protected-branch' "$c" declared
git -C "$c" checkout -q dev; git -C "$c" merge -q --ff-only origin/dev
declare_model "$c" 1 dev dev,qa,stg,prod prod ''
git -C "$c" add -A && git -C "$c" commit -qm 'local adds stg'; git -C "$c" checkout -q -b feat/z
resolves 'both hold, local descends' "$c" declared refs/heads/dev
declare_model "$s_" 1 dev dev,uat,prod prod ''
git -C "$s_" add -A && git -C "$s_" commit -qm 'remote adds uat'; git -C "$s_" push -q origin dev; git -C "$c" fetch -q
resolves 'both hold, diverged' "$c" declared refs/heads/dev 'diverged'

# SELF-CONFIRMING SEARCH through the remote only: no working copy (the branch was cut before the declaration), the
# local `development` stale, origin/development carrying a copy that names itself — found, and its `prod` protected.
c="$(upstream up-selfc development)"; s_="$(seed up-selfc)"
git -C "$s_" branch prod; git -C "$s_" push -q origin prod
git -C "$c" fetch -q; git -C "$c" checkout -q -b prod origin/prod
declare_model "$s_" 1 development development,prod prod ''
git -C "$s_" add -A && git -C "$s_" commit -qm 'declare'; git -C "$s_" push -q origin development; git -C "$c" fetch -q
resolves 'self-confirm via origin only' "$c" declared refs/remotes/origin/development
check 'self-confirm, HEAD on prod' 'SYNC_REFUSED: protected-branch' "$c" declared

# UNREADABLE: a working copy that is not JSON is refused — never skipped into the self-confirming search, which
# would read some other branch's copy and act on it.
d="$(mkrepo badjson)"; commit "$d"; git -C "$d" checkout -q -b fix/j
mkdir -p "$d/.bespunky"; echo '{ not json' > "$d/.bespunky/branches.json"
git -C "$d" add -A && git -C "$d" commit -qm 'broken'
resolves 'unparseable working copy' "$d" unreadable working-tree
check 'unparseable working copy' 'SYNC_REFUSED: branch-model-unreadable' "$d"
# …and a readable working copy whose integration TIP carries a schema this toolkit does not know: unreadable,
# read from the tip.
d="$(mkrepo tipschema)"; commit "$d"; git -C "$d" checkout -q -b dev
declare_model "$d" 2 dev dev,prod prod ''
git -C "$d" add -A && git -C "$d" commit -qm 'future'; git -C "$d" checkout -q -b fix/t
declare_model "$d" 1 dev dev,prod prod ''
git -C "$d" add -A && git -C "$d" commit -qm 'older copy'
resolves 'tip schema unknown' "$d" unreadable refs/heads/dev
# A schema MINOR is additive: 1.1 reads as 1.
d="$(mkrepo minor)"; commit "$d"; git -C "$d" checkout -q -b dev
declare_model "$d" '"1.1"' dev dev,prod prod ''
git -C "$d" add -A && git -C "$d" commit -qm 'minor'; git -C "$d" checkout -q -b feat/m
resolves 'schema 1.1 accepted' "$d" declared refs/heads/dev

# An unknown projection schema MAJOR is refused, never guessed past — it is what decides where commits land.
d="$(mkrepo schema)"; commit "$d"
declare_model "$d" 2 main main main ''
git -C "$d" add -A && git -C "$d" commit -qm 'future model'; git -C "$d" checkout -q -b fix/s
check 'unknown projection schema' 'SYNC_REFUSED: branch-model-unreadable' "$d"

# --staging needs a PRE-PRODUCTION stage to bind to. trunk/two-line have none; three-line has `staging`.
render_checks 1
d="$(mkrepo stg2)"; commit "$d"; git -C "$d" checkout -q -b development
declare_model "$d" 1 development development,main main ''
git -C "$d" add -A && git -C "$d" commit -qm 'two-line'; git -C "$d" checkout -q -b feat/s
check '--staging, two-line' 'SYNC_REFUSED: staging-without-stage' "$d" declared
d="$(mkrepo stg3)"; commit "$d"; git -C "$d" checkout -q -b development
declare_model "$d" 1 development development,staging,main main ''
git -C "$d" add -A && git -C "$d" commit -qm 'three-line'; git -C "$d" checkout -q -b feat/s
check '--staging, three-line' 'PASS' "$d" declared
d="$(mkrepo stgu)"; commit "$d"; git -C "$d" checkout -q -b feat/s
check '--staging, undeclared' 'PASS' "$d" undeclared
render_checks 0

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
counts="$( cd "$d" && ( set -e; MIGRATE_FROM=''; _stage() { :; }; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT" ) 2>&1 \
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

# ── Unwritable mount points: a root-owned node_modules / volume mount refuses before anything is written ─────
# Docker creates a named volume's mount point ROOT-OWNED; unless post-create reclaims it, every install into it
# dies with EACCES — the sync's own included. The fixtures need a directory this user cannot write, so they need
# sudo and a non-root user; where either is missing the cases are skipped, said out loud, never passed.
if [ "$(id -u)" = 0 ] || ! sudo -n true 2>/dev/null; then
  echo "  skip unwritable-mounts cases — need a non-root user with passwordless sudo"
else
  d="$(mkrepo vol)"; commit "$d"; git -C "$d" branch development; git -C "$d" checkout -q -b fix/v
  check 'writable node_modules' 'PASS' "$d"
  sudo -n mkdir "$d/node_modules"
  before="$(git -C "$d" status --porcelain -uall; ls -A "$d")"
  check 'root-owned node_modules' 'SYNC_REFUSED: unwritable-mounts' "$d"
  [ "$(git -C "$d" status --porcelain -uall; ls -A "$d")" = "$before" ] \
    && printf '  ok   %-32s\n' 'refusal wrote nothing' \
    || { printf '  FAIL %-32s\n' 'refusal wrote nothing'; FAILED=1; }

  # The mount points come from the PROJECT's devcontainer.json — a layer's volume (here .angular) is covered
  # with no list to update — and the remedy names every path, its owner, and the post-create to re-run.
  mkdir -p "$d/.devcontainer"
  cat > "$d/.devcontainer/devcontainer.json" <<'JSON'
{
  "mounts": [
    // "source=x-old,target=${containerWorkspaceFolder}/commented-out,type=volume",
    "source=x-nm,target=${containerWorkspaceFolder}/node_modules,type=volume",
    "source=x-ng,target=${containerWorkspaceFolder}/.angular,type=volume",
    "source=x-pw,target=/home/node/.cache/ms-playwright,type=volume"
  ]
}
JSON
  echo 'echo hi' > "$d/.devcontainer/post-create.sh"
  git -C "$d" add -A && git -C "$d" commit -qm dc
  sudo -n mkdir "$d/.angular" "$d/commented-out"
  out="$( cd "$d" && ( set -e; MIGRATE_FROM=''; _stage() { :; }; eval "$PREFLIGHT_CHECKS"; eval "$PREFLIGHT_VERDICT" ) 2>&1 )"
  want_all=1
  for needle in 'SYNC_REFUSED: unwritable-mounts' '.angular' 'owner: root' \
      'sudo chown -R "$(id -un):$(id -gn)" .angular node_modules' 'bash .devcontainer/post-create.sh'; do
    case "$out" in *"$needle"*) ;; *) want_all=0; printf '  FAIL %-32s missing [%s]\n' 'remedy names paths + fix' "$needle" ;; esac
  done
  case "$out" in *commented-out*) want_all=0; printf '  FAIL %-32s\n' 'a commented-out mount was read' ;; esac
  [ "$want_all" = 1 ] && printf '  ok   %-32s\n' 'remedy names paths + fix' || FAILED=1
fi

exit "$FAILED"
