#!/usr/bin/env bash
# `nx run firebase:reset` resets the data the stack in THIS tree actually reads.
#
# Both failures are silent. A reset that wipes `.emulator-data` in a worktree, whose stack reads `.emulator-data-<offset>`,
# reports success and changes nothing the developer will see. A reset under a running suite is undone when that suite
# exports on exit: the world the developer asked to throw away comes back. And a worktree has no seeds of its own, so a
# reset that looks only in this tree refuses there while a serve in the same tree primes happily from main's.
#
# HOW. The real emulator-data.sh and emulators.sh, rendered as the generator does, over the real dev engine, with a fake
# `firebase` that imports nothing and exports on a stop. A main clone and a worktree off it.
set -uo pipefail
unset CLAUDECODE   # a human runs these: an agent never takes the base ports
export DEV_OWNER=emulator-reset-test

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators"
TMP="$(mktemp -d)"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

SUITES=()
cleanup() {
  for pid in "${SUITES[@]:-}"; do [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null; done
  git -C "$TMP/main" worktree remove --force "$TMP/wt" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 143' INT TERM

mkdir -p "$TMP/bin"
cat > "$TMP/bin/firebase" <<'STUB'
#!/usr/bin/env bash
# The fake firebase-tools: up until stopped, then exports what it holds, as the real one does on a clean stop.
EXPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --export-on-exit) EXPORT="$2"; shift 2 ;;
    --export-on-exit=*) EXPORT="${1#*=}"; shift ;;
    *) shift ;;
  esac
done
stop() {
  if [ -n "$EXPORT" ]; then mkdir -p "$EXPORT"; echo '{"version":"the session the running suite held"}' > "$EXPORT/firebase-export-metadata.json"; fi
  echo "Export complete"
  exit 0
}
trap stop TERM INT
echo "All emulators ready"
while :; do sleep 0.1; done
STUB
chmod +x "$TMP/bin/firebase"

MAIN="$TMP/main"
mkdir -p "$MAIN/tools/emulator-seeds/default" "$MAIN/tools/emulator-seeds/other" "$MAIN/node_modules"
sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}||g' -e 's|{{functionsRoot}}|apps/fn|g' -e 's|{{functionsDist}}|dist/apps/fn|g' \
  "$GEN/emulators.sh.tpl" > "$MAIN/tools/emulators.sh"
node "$ROOT/tools/test-scaffold/render-engine.mjs" "$MAIN"
node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$MAIN"
chmod +x "$MAIN/tools/"*.sh
printf '{ "emulators": { "auth": { "port": 19099 }, "firestore": { "port": 18080 } } }\n' > "$MAIN/firebase.json"
printf '{"version":"default-seed"}\n' > "$MAIN/tools/emulator-seeds/default/firebase-export-metadata.json"
printf '{"version":"other-seed"}\n' > "$MAIN/tools/emulator-seeds/other/firebase-export-metadata.json"
printf 'tools/emulator-seeds/\n.emulator-data*/\n.firebase.offset-*\n.bespunky/run/\nnode_modules/\n' > "$MAIN/.gitignore"
git -C "$MAIN" init -q -b main
git -C "$MAIN" add -A >/dev/null 2>&1
git -C "$MAIN" commit -qm init
git -C "$MAIN" worktree add -q "$TMP/wt" -b feat/x 2>/dev/null
WT="$TMP/wt"
mkdir -p "$WT/node_modules"

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n' "$1"; [ -n "${3:-}" ] && printf '       %s\n' "$3"; FAILED=1; fi; }
world() { cat "$1/firebase-export-metadata.json" 2>/dev/null; }
is() { [ "$(world "$1")" = "{\"version\":\"$2\"}" ] && echo 1 || echo 0; }
dirty() { mkdir -p "$1"; echo '{"version":"dirty"}' > "$1/firebase-export-metadata.json"; }
reset() { ( cd "$1" && shift && env "${ENVS[@]:-_=_}" bash tools/emulator-data.sh reset "$@" 2>&1 ); }

start_suite() {   # start_suite <tree> <offset> — a suite of a direct run, in its own session; its pid in $pid
  cd "$1" || exit 2
  PATH="$TMP/bin:$PATH" PORT_OFFSET="$2" env --default-signal=INT,QUIT setsid bash tools/emulators.sh > "$TMP/suite-$2.log" 2>&1 < /dev/null &
  pid=$!
  cd "$ROOT" || exit 2
}
until_up() {   # until_up <tree> <key>
  local i
  for i in $(seq 1 100); do
    node "$1/tools/dev/dev.mjs" ps --json 2>/dev/null | grep -q "\"key\": \"$2\"" && grep -q 'All emulators ready' "$TMP/suite-${2#*@}.log" && return 0
    sleep 0.1
  done
  return 1
}

# ── A worktree's stack reads its own dir: that is what a reset must reach ─────────────────────────
ENVS=()
dirty "$WT/.emulator-data-6000"
out="$(reset "$WT")"; rc=$?
ok 'in a worktree with no seeds of its own, reset uses main'"'"'s, as a serve there does' "$([ "$rc" = 0 ] && echo 1 || echo 0)" "$out"
ok "reset reaches the data dir an isolated stack of this tree reads" "$(is "$WT/.emulator-data-6000" default-seed)" "$(world "$WT/.emulator-data-6000")"
ok 'it says which directories it reset' "$(case "$out" in *.emulator-data-6000*) echo 1 ;; *) echo 0 ;; esac)" "$out"
ok "main's seed is not touched by it" "$(is "$MAIN/tools/emulator-seeds/default" default-seed)"

# ── PORT_OFFSET names one stack ───────────────────────────────────────────────────────────────────
dirty "$WT/.emulator-data-6000"
dirty "$WT/.emulator-data-7000"
ENVS=(PORT_OFFSET=7000)
reset "$WT" other >/dev/null
ok 'PORT_OFFSET=<n> resets that stack, to the named seed' "$(is "$WT/.emulator-data-7000" other-seed)"
ok '…and leaves the others' "$(is "$WT/.emulator-data-6000" dirty)"
ENVS=()

# ── Without it, every data dir of THIS tree, and no other tree's ──────────────────────────────────
dirty "$MAIN/.emulator-data"
dirty "$WT/.emulator-data"
dirty "$WT/.emulator-data-6000"
dirty "$WT/.emulator-data-notanoffset"
reset "$WT" other >/dev/null
ok 'a named seed reaches every data dir of this tree' "$([ "$(is "$WT/.emulator-data" other-seed)$(is "$WT/.emulator-data-6000" other-seed)" = 11 ] && echo 1 || echo 0)"
ok "another tree's data is not touched" "$(is "$MAIN/.emulator-data" dirty)"
ok 'a directory that is no stack'"'"'s data is not touched' "$(is "$WT/.emulator-data-notanoffset" dirty)"

# ── A seed that does not exist destroys nothing ───────────────────────────────────────────────────
dirty "$WT/.emulator-data-6000"
out="$(reset "$WT" nosuch)"; rc=$?
ok 'an unknown seed is refused, and the data stays' "$([ "$rc" != 0 ] && [ "$(is "$WT/.emulator-data-6000" dirty)" = 1 ] && echo 1 || echo 0)" "$out"

# ── A running suite would export over it: refused, naming the stack and the stop ──────────────────
rm -rf "$WT/.emulator-data-"*
dirty "$WT/.emulator-data-6000"
start_suite "$WT" 6000; SUITES+=("$pid")
until_up "$WT" 'firebase@6000' || ok 'the suite came up' 0 "$(cat "$TMP/suite-6000.log")"
out="$(reset "$WT")"; rc=$?
ok 'reset under a running suite is refused' "$([ "$rc" != 0 ] && echo 1 || echo 0)" "$out"
ok '…the data is not touched' "$(is "$WT/.emulator-data-6000" dirty)" "$(world "$WT/.emulator-data-6000")"
ok '…and it names the stack and how to stop it' "$(case "$out" in *firebase@6000*'dev stop firebase --offset=6000'*) echo 1 ;; *) echo 0 ;; esac)" "$out"
ENVS=(PORT_OFFSET=7000)
dirty "$WT/.emulator-data-7000"
reset "$WT" >/dev/null; rc=$?
ok 'a reset of ANOTHER stack of this tree is not stopped by it' "$([ "$rc" = 0 ] && [ "$(is "$WT/.emulator-data-7000" default-seed)" = 1 ] && echo 1 || echo 0)"
ENVS=()
dirty "$MAIN/.emulator-data"
reset "$MAIN" >/dev/null; rc=$?
ok "a running suite of another tree stops nothing here" "$([ "$rc" = 0 ] && [ "$(is "$MAIN/.emulator-data" default-seed)" = 1 ] && echo 1 || echo 0)"

node "$WT/tools/dev/dev.mjs" stop firebase --offset=6000 --worktree="$WT" >/dev/null 2>&1
for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
ok 'the stopped suite exported, as a stop always does' "$(is "$WT/.emulator-data-6000" 'the session the running suite held')" "$(world "$WT/.emulator-data-6000")"
out="$(reset "$WT")"; rc=$?
ok 'once it has stopped, reset goes through, and the world is the seed' "$([ "$rc" = 0 ] && [ "$(is "$WT/.emulator-data-6000" default-seed)" = 1 ] && echo 1 || echo 0)" "$out"

# ── `ensure`, and the one place both ask where the data is ────────────────────────────────────────
rm -rf "$WT/.emulator-data-8000"
( cd "$WT" && PORT_OFFSET=8000 bash tools/emulator-data.sh ensure >/dev/null 2>&1 )
ok 'ensure primes an isolated stack from the resolved seed' "$(is "$WT/.emulator-data-8000" default-seed)"
ok 'dir answers for an isolated stack' "$([ "$(cd "$WT" && PORT_OFFSET=8000 bash tools/emulator-data.sh dir)" = "$WT/.emulator-data-8000" ] && echo 1 || echo 0)"
ok 'dir answers for the base stack' "$([ "$(cd "$WT" && PORT_OFFSET=0 bash tools/emulator-data.sh dir)" = "$WT/.emulator-data" ] && echo 1 || echo 0)"

exit "$FAILED"
