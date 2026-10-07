#!/usr/bin/env bash
# `tools/emulators.sh` — a STOP always saves the emulator data, however it arrives.
#
# WHAT THIS GUARDS. firebase-tools exports on exit only when IT is told to stop while its emulators are still up.
# A signal that reaches an emulator JVM first makes it read "Firestore Emulator has exited with code: 143" as a
# fatal error and stop WITHOUT exporting. Every real supervisor does that: Nx stops a task with a leaf-first tree
# kill (the JVMs are the leaves) and SIGKILLs what is left after ~5 s; a terminal's Ctrl+C reaches the whole
# foreground group. Both lost every stack's data (`tools/dev/dev stop`, Ctrl+C on `nx serve`) while a lone
# `kill <pid>` of the script exported fine — so a test that only sends one polite signal proves nothing.
#
# HOW. The shipped template, rendered with stub reaper/data scripts and a fake `firebase` that behaves like the
# real one where it matters: it spawns a child "JVM"; a signal to that child is FATAL (exit 1, no export); a
# SIGTERM to firebase itself exports (slowly) and exits. Each stop below is delivered the way its real sender
# delivers it, including Nx's: every leaf of the script's tree first, then the parents, then SIGKILL after 1 s.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TPL="$ROOT/plugins/house/engine/nx-tools/src/generators/firebase-emulators/emulators.sh.tpl"
[ -f "$TPL" ] || { echo "FATAL: emulators.sh.tpl not found at $TPL" >&2; exit 2; }
command -v setsid >/dev/null 2>&1 || { echo "  skip  setsid unavailable"; exit 0; }

TMP="$(mktemp -d)"
STARTED=()
cleanup() {
  for pid in "${STARTED[@]}"; do kill -KILL -- "-$pid" 2>/dev/null; done
  # A keeper is detached by design, in its own process group with the fake suite under it: stop each one by the
  # PID it recorded — never by name.
  for entry in "$TMP"/*/.bespunky/run/*/detached/emulators.json; do
    [ -f "$entry" ] || continue
    pid="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid))' "$entry" 2>/dev/null)"
    [ -n "$pid" ] && kill -KILL -- "-$pid" 2>/dev/null
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

FAILED=0
ok() { if [ "$2" = 1 ]; then printf '  ok   %-78s\n' "$1"; else printf '  FAIL %-78s\n' "$1"; FAILED=1; fi }

mkdir -p "$TMP/bin"
cat > "$TMP/bin/firebase" <<'STUB'
#!/usr/bin/env bash
# A firebase-tools stand-in. Records every signal it gets; a signal to its "JVM" child is fatal (no export).
EXPORT=''
while [ "$#" -gt 0 ]; do [ "$1" = --export-on-exit ] && EXPORT="$2"; shift; done
REC="$PWD/.fake-firebase-signals"
: > "$REC"
# The "JVM": a signal that reaches it before firebase-tools has finished its export is the bug — it records that.
DONE="$PWD/.fake-firebase-exported"
rm -f "$DONE"
bash -c 'trap "[ -f \"$1\" ] || echo JVM-KILLED >> \"$2\"; exit 143" TERM INT HUP; while :; do sleep 0.1; done' jvm "$DONE" "$REC" &
JVM=$!
stop() {
  echo "$1" >> "$REC"
  [ "$(wc -l < "$REC")" -gt 1 ] && return   # firebase-tools: a second signal means force quit — keep exporting here
  echo "Received $1 — exporting…"
  sleep 1.5
  if [ -n "$EXPORT" ]; then mkdir -p "$EXPORT"; echo '{}' > "$EXPORT/firebase-export-metadata.json"; fi
  : > "$DONE"
  kill -TERM "$JVM" 2>/dev/null; wait "$JVM" 2>/dev/null
  echo "Export complete"
  exit 0
}
trap 'stop TERM' TERM
trap 'stop INT' INT
echo "All emulators ready"
while :; do
  wait "$JVM"
  # The "JVM" died without us stopping it: a signal reached it directly. firebase-tools calls that fatal.
  echo "Firestore Emulator has exited with code: 143, stopping all running emulators"; exit 1
done
STUB
chmod +x "$TMP/bin/firebase"

mkws() {   # mkws <name> — a workspace with the rendered script, stubs and a full (exporting) emulator set
  local d="$TMP/$1"
  mkdir -p "$d/tools" "$d/node_modules"
  sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}||g' -e 's|{{functionsRoot}}|apps/fn|g' -e 's|{{functionsDist}}|dist/apps/fn|g' "$TPL" > "$d/tools/emulators.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/tools/reap-emulators.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/tools/emulator-data.sh"
  node "$ROOT/tools/test-scaffold/emulator-ports.mjs" "$d"
  printf '{ "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 } } }\n' > "$d/firebase.json"
  printf '%s' "$d"
}

start() {   # start <ws> — in its own session under a shell, as Nx's run-commands spawns it; echoes the session's pid
  # `env --default-signal`: a background job of a non-interactive shell (this test) starts with SIGINT IGNORED, and
  # an ignored-on-entry signal cannot be trapped — no real launcher (Nx, a terminal) does that to it.
  ( cd "$1" || exit 1
    PATH="$TMP/bin:$PATH" EMULATORS_STOP_TIMEOUT=20 NX_INVOCATION_ROOT_PID="${INVOKER:-}" env --default-signal=INT,QUIT setsid bash -c 'bash tools/emulators.sh > out.log 2>&1; echo $? > rc' < /dev/null > /dev/null 2>&1 &
    echo $! )
}
rc() { cat "$1/rc" 2>/dev/null; }
script() { pgrep -P "$1" -f 'tools/emulators.sh'; }   # the script itself, under its session's shell
ready() { for _ in $(seq 1 100); do grep -q 'All emulators ready' "$1/out.log" 2>/dev/null && return 0; sleep 0.1; done; return 1; }
descendants() { local c; for c in $(pgrep -P "$1"); do descendants "$c"; echo "$c"; done; }
gone() { for _ in $(seq 1 "${2:-100}"); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done; return 1; }
exported() { [ -f "$1/.emulator-data/firebase-export-metadata.json" ]; }
signals() { grep -vx JVM-KILLED "$1/.fake-firebase-signals" | tr '\n' ' ' | sed 's/ $//'; }
keeper_gone() {   # the detached keeper finished on its own — it records its result, and (run directly, with no script
  # left to read it) releases the state dir
  for _ in $(seq 1 100); do
    grep -q '"status": "exited"' "$1/.bespunky/run/firebase@0/detached/emulators.json" 2>/dev/null && return 0
    [ -d "$1/.bespunky/run/firebase@0" ] || return 0
    sleep 0.1
  done
  return 1
}

# ── 1. Nx's stop: leaf-first tree kill, then SIGKILL after a 1 s grace ─────────────────────────────
# The invoking nx (NX_INVOCATION_ROOT_PID) — a stand-in whose stderr is a file it APPENDS to (`>>`, a terminal or a
# pipe behave the same): the line is written at once.
sleep 300 2>>"$TMP/invoker.err" & INVOKER=$!
W="$(mkws nx)"; P="$(start "$W")"; STARTED+=("$P")
ok "nx: the suite came up" "$(ready "$W" && echo 1 || echo 0)"
mapfile -t TREE < <(descendants "$P"; echo "$P")
for pid in "${TREE[@]}"; do kill -TERM "$pid" 2>/dev/null; done   # deepest first, as killProcessTreeGraceful does
sleep 1
for pid in "${TREE[@]}"; do kill -KILL "$pid" 2>/dev/null; done
ok "nx: no emulator child was in the script's tree to be signalled" "$(grep -q JVM-KILLED "$W/.fake-firebase-signals" && echo 0 || echo 1)"
ok "nx: the suite finished its save after its supervisor was SIGKILLed" "$(keeper_gone "$W" && exported "$W" && echo 1 || echo 0)"
ok "nx: firebase-tools got exactly ONE SIGTERM (got: $(signals "$W"))" "$([ "$(signals "$W")" = TERM ] && echo 1 || echo 0)"
ok "nx: run directly, its state dir is released once the save is done" "$([ ! -d "$W/.bespunky/run/firebase@0" ] && echo 1 || echo 0)"
ok "nx: the stop was announced while it ran" "$(grep -q 'stopping — exporting emulator data' "$W/out.log" && echo 1 || echo 0)"
ok "nx: the invoker's terminal got 'saving emulator data in the background' at once" "$(grep -q 'saving emulator data in the background' "$TMP/invoker.err" && echo 1 || echo 0)"
kill "$INVOKER" 2>/dev/null; INVOKER=''

# ── 1b. The invoker's stderr is a file it did NOT open for appending (`nx serve > log 2>&1`): Nx writes at its own
# offset, over anything appended — the line is queued and appended once the invoker has exited.
sleep 300 2>"$TMP/invoker-trunc.err" & INVOKER=$!
W="$(mkws capture)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -INT -- "-$P"; gone "$P" 100
ok "> file: nothing is appended while the invoker still writes" "$(grep -q 'saving emulator data' "$TMP/invoker-trunc.err" && echo 0 || echo 1)"
kill "$INVOKER" 2>/dev/null; INVOKER=''
for _ in $(seq 1 50); do grep -q 'saving emulator data' "$TMP/invoker-trunc.err" && break; sleep 0.1; done
ok "> file: the line follows the invoker's last write" "$(grep -q 'saving emulator data in the background' "$TMP/invoker-trunc.err" && echo 1 || echo 0)"

# ── 2. A terminal's Ctrl+C: SIGINT to the whole process group ──────────────────────────────────────
W="$(mkws ctrlc)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -INT -- "-$P"
gone "$P" 100
ok "Ctrl+C: the script waits for the save and exits 0 (got $(rc "$W"))" "$(exported "$W" && grep -q 'done in .*exported to' "$W/out.log" && [ "$(rc "$W")" = 0 ] && echo 1 || echo 0)"
ok "Ctrl+C: firebase-tools got exactly ONE SIGTERM, no SIGINT (got: $(signals "$W"))" "$([ "$(signals "$W")" = TERM ] && echo 1 || echo 0)"
ok "Ctrl+C: run directly, the script read the result, then released the state dir" "$([ ! -d "$W/.bespunky/run/firebase@0" ] && echo 1 || echo 0)"

# ── 3. A plain kill of the script: it waits, shows progress, says done ─────────────────────────────
W="$(mkws kill)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -TERM "$(script "$P")"
gone "$P" 100
ok "kill: exported, announced, and 'done' printed" "$(exported "$W" && grep -q 'done in' "$W/out.log" && echo 1 || echo 0)"
ok "kill: the suite's own export lines streamed through" "$(grep -q 'Export complete' "$W/out.log" && echo 1 || echo 0)"

# ── 4. The supervisor vanishes without a word (SIGKILL): the keeper stops the suite and saves ──────
W="$(mkws vanish)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -KILL -- "-$P"
ok "SIGKILL of the script: the keeper notices, stops the suite once, and it saves" "$(keeper_gone "$W" && exported "$W" && [ "$(signals "$W")" = TERM ] && echo 1 || echo 0)"

# ── 5. Restart while the previous suite is still saving: wait for it, never start over it ──────────
W="$(mkws restart)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -KILL -- "-$P"          # the supervisor gave up at once; the save is still running
sleep 0.3
mv "$W/out.log" "$W/out1.log"
P2="$(start "$W")"; STARTED+=("$P2")
ok "restart: the new start waited for the previous suite's save" "$(ready "$W" && grep -q 'previous suite of this stack is still saving' "$W/out.log" && grep -q 'previous suite finished: exported to' "$W/out.log" && echo 1 || echo 0)"
ok "restart: the previous keeper, finishing, left the state dir the waiting start had claimed" "$([ -d "$W/.bespunky/run/firebase@0/tmp" ] && [ -f "$W/.bespunky/run/firebase@0/detached/emulators.json" ] && echo 1 || echo 0)"
kill -TERM "$(script "$P2")"; gone "$P2" 100

# ── 6. The suite dies on its own: the script fails, naming the log ─────────────────────────────────
W="$(mkws crash)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
for fb in $(pgrep -f "$TMP/bin/firebase"); do   # this workspace's fake firebase-tools — its "JVM" dies under it
  [ "$(readlink "/proc/$fb/cwd")" = "$W" ] && pkill -TERM -P "$fb"
done
gone "$P" 100; CODE="$(rc "$W")"
ok "crash: the script exits non-zero (got $CODE) and names the suite's log" "$([ -n "$CODE" ] && [ "$CODE" -ne 0 ] && grep -q 'CRASHED.*its log: .*emulators.log' "$W/out.log" && echo 1 || echo 0)"

# ── 7. Its stack's serve was killed first (Nx's force-kill after a Ctrl+C mid-export): the keeper, last one out, ──
# removes the stack's run record and state dir — through the engine's own rule, so never a stack that is live.
DEVLIB="$ROOT/plugins/house/engine/nx-tools/src/generators/dev/files/lib/stacks.mjs.tpl"
under_engine() {   # under_engine <ws> <record-pid> — a dev-engine stack app@0 whose serve is <record-pid>; echoes the session
  local d="$1"
  mkdir -p "$d/tools/dev/lib" "$d/.bespunky/run/app@0"
  cp "$DEVLIB" "$d/tools/dev/lib/stacks.mjs"
  printf '{ "version": 1, "key": "app@0", "app": "app", "tree": "%s", "offset": 0, "pid": %s, "host": "%s", "processes": [] }\n' "$d" "$2" "$(hostname)" > "$d/.bespunky/run/app@0.json"
  ( cd "$d" || exit 1
    PATH="$TMP/bin:$PATH" EMULATORS_STOP_TIMEOUT=20 DEV_STACK_DIR="$d/.bespunky/run/app@0" env --default-signal=INT,QUIT setsid bash -c 'bash tools/emulators.sh > out.log 2>&1; echo $? > rc' < /dev/null > /dev/null 2>&1 &
    echo $! )
}
entry_gone() { for _ in $(seq 1 100); do [ -d "$1" ] || return 0; sleep 0.1; done; return 1; }
sleep 0 & DEAD=$!; wait "$DEAD"
W="$(mkws pruned)"; P="$(under_engine "$W" "$DEAD")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -KILL -- "-$P"
ok "serve gone: the keeper saves, then removes the stack's record and state dir" "$(entry_gone "$W/.bespunky/run/app@0" && exported "$W" && [ ! -f "$W/.bespunky/run/app@0.json" ] && echo 1 || echo 0)"
bash -c 'exec -a "node dev.mjs serve" sleep 300' & LIVE=$!
W="$(mkws spared)"; P="$(under_engine "$W" "$LIVE")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -KILL -- "-$P"
sleep 0.5
for _ in $(seq 1 100); do exported "$W" && grep -q '"status": "exited"' "$W/.bespunky/run/app@0/detached/emulators.json" 2>/dev/null && break; sleep 0.1; done
sleep 1
ok "serve live (or a new stack on the key): the keeper leaves its record and state dir" "$([ -f "$W/.bespunky/run/app@0.json" ] && [ -d "$W/.bespunky/run/app@0" ] && echo 1 || echo 0)"
kill "$LIVE" 2>/dev/null

exit "$FAILED"
