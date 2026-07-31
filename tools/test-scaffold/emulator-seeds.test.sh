#!/usr/bin/env bash
# Where an ISOLATED emulator stack gets its starting world from.
#
# THE RULE. Seeds are shared from the main worktree; data is isolated per stack. Emulator seeds are
# BUILT artifacts and gitignored, so a freshly-created git worktree receives none — and an isolated
# stack that found no seed would silently begin from an empty world (no users, no fixtures, and a
# confusing morning). So the seed resolves: this tree's own first, else the main worktree's, copied
# in. A worktree that builds or edits its own seeds shadows main's from then on, and because priming
# is a COPY it can never reach back and alter what main holds.
#
# Both halves fail silently if they regress — an empty world looks like a fresh start, and a worktree
# quietly reading main's seeds looks fine right up until it edits them.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/plugins/project-starter/skills/new-project/assets/nx-tools/src/generators/firebase-emulators/emulators.sh.tpl"

[ -f "$TPL" ] || { echo "FATAL: emulators.sh.tpl not found at $TPL" >&2; exit 2; }
grep -q 'seed_dir' "$TPL" || {
  echo "FATAL: emulators.sh.tpl no longer defines seed_dir — the seed cascade moved or was removed." >&2
  exit 2
}

TMP="$(mktemp -d)"
trap 'git -C "$TMP/main" worktree remove --force "$TMP/wt" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/bin/firebase"
chmod +x "$TMP/bin/firebase"

# ── A main clone with seeds, and a worktree off it with none ────────────────────────────────────
MAIN="$TMP/main"
mkdir -p "$MAIN/tools/emulator-seeds/default"
sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}|apps/demo/src/environments/environment.ts|g' \
  "$TPL" > "$MAIN/tools/emulators.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$MAIN/tools/reap-emulators.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$MAIN/tools/emulator-data.sh"
chmod +x "$MAIN/tools/"*.sh
printf '{ "emulators": { "auth": { "port": 9099 } } }\n' > "$MAIN/firebase.json"
# The seed itself: the metadata file is what both the script and firebase treat as "this is a world".
printf '{"version":"main-seed"}\n' > "$MAIN/tools/emulator-seeds/default/firebase-export-metadata.json"

git -C "$MAIN" init -q -b main
# Seeds are gitignored in a real house project — which is exactly why a worktree gets none.
printf 'tools/emulator-seeds/\n.emulator-data*/\n' > "$MAIN/.gitignore"
git -C "$MAIN" add -A >/dev/null 2>&1
git -C "$MAIN" commit -qm init
git -C "$MAIN" worktree add -q "$TMP/wt" -b feat/x 2>/dev/null
WT="$TMP/wt"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-46s\n' "$1"; else printf '  FAIL %-46s\n' "$1"; FAILED=1; fi }

run_isolated() {   # run_isolated <dir> -> stderr of an isolated (offset) run
  ( cd "$1" && PATH="$TMP/bin:$PATH" PORT_OFFSET=6000 bash tools/emulators.sh 2>&1 >/dev/null )
}

# The worktree really has no seeds of its own — the premise of the whole cascade.
ok 'worktree starts with no seeds of its own' \
   "$([ ! -e "$WT/tools/emulator-seeds/default" ] && echo 1 || echo 0)"

# ── Borrows the main worktree's seed ────────────────────────────────────────────────────────────
out="$(run_isolated "$WT")"
case "$out" in *"main worktree's 'default' seed"*) ok 'primes from the main worktree seed' 1 ;; *) ok 'primes from the main worktree seed' 0 ;; esac
ok 'isolated data dir now holds that world' \
   "$([ "$(cat "$WT/.emulator-data-6000/firebase-export-metadata.json" 2>/dev/null)" = '{"version":"main-seed"}' ] && echo 1 || echo 0)"

# Priming is a COPY: the worktree's data is its own from here, and main is untouched by anything
# that happens to it.
printf '{"version":"worktree-changed-this"}\n' > "$WT/.emulator-data-6000/firebase-export-metadata.json"
ok 'main seed unaffected by the worktree' \
   "$([ "$(cat "$MAIN/tools/emulator-seeds/default/firebase-export-metadata.json")" = '{"version":"main-seed"}' ] && echo 1 || echo 0)"

# ── Its OWN seed wins once it has one ───────────────────────────────────────────────────────────
mkdir -p "$WT/tools/emulator-seeds/default"
printf '{"version":"worktree-seed"}\n' > "$WT/tools/emulator-seeds/default/firebase-export-metadata.json"
rm -rf "$WT/.emulator-data-6000"          # re-prime, as a fresh isolated stack would
out="$(run_isolated "$WT")"
case "$out" in *"this tree's 'default' seed"*) ok "this tree's own seed shadows main's" 1 ;; *) ok "this tree's own seed shadows main's" 0 ;; esac
ok 'primed from the worktree seed, not main' \
   "$([ "$(cat "$WT/.emulator-data-6000/firebase-export-metadata.json" 2>/dev/null)" = '{"version":"worktree-seed"}' ] && echo 1 || echo 0)"

# ── Already primed: never re-primed over live data ──────────────────────────────────────────────
printf '{"version":"session-in-progress"}\n' > "$WT/.emulator-data-6000/firebase-export-metadata.json"
run_isolated "$WT" >/dev/null
ok 'an existing data dir is left alone' \
   "$([ "$(cat "$WT/.emulator-data-6000/firebase-export-metadata.json")" = '{"version":"session-in-progress"}' ] && echo 1 || echo 0)"

exit "$FAILED"
