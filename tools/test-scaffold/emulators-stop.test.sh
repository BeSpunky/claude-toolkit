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
# And a stop never waits FOREVER: the keeper owns a deadline (EMULATORS_STOP_TIMEOUT) past which it ends its own
# process group and says so, and `tools/dev/dev stop --abandon` does the same at once (R3-3: a hung export once
# wedged the stack — FINISHING forever, every restart refused).
#
# HOW. The shipped template, rendered with the dev engine (the stack claim), a stub data script and a fake
# `firebase` that behaves like the real one where it matters: it spawns a child "JVM"; a signal to that child is
# FATAL (exit 1, no export); a SIGTERM to firebase itself exports (slowly) and exits — or, with FAKE_HANG, never. Each stop below is delivered the way its real sender
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
  # Each stack's TMPDIR lives in /tmp, outside the fixture: release the ones the records still name.
  for rec in "$TMP"/*/.bespunky/run/*.json; do
    [ -f "$rec" ] || continue
    t="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).tmp ?? ""))' "$rec" 2>/dev/null)"
    [[ "$t" =~ ^/tmp/bespunky-[0-9a-f]{12}$ ]] && rm -rf "$t"
  done
  rm -rf /tmp/bespunky-0123456789ab
  [ -n "${KEEP:-}" ] && echo "kept $TMP" || rm -rf "$TMP"
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
printf '%s' "$TMPDIR" > "$PWD/.fake-firebase-tmpdir"
# The "JVM": a signal that reaches it before firebase-tools has finished its export is the bug — it records that.
DONE="$PWD/.fake-firebase-exported"
rm -f "$DONE"
bash -c 'trap "[ -f \"$1\" ] || echo JVM-KILLED >> \"$2\"; exit 143" TERM INT HUP; while :; do sleep 0.1; done' jvm "$DONE" "$REC" &
JVM=$!
stop() {
  echo "$1" >> "$REC"
  [ "$(wc -l < "$REC")" -gt 1 ] && return   # firebase-tools: a second signal means force quit — keep exporting here
  echo "Received $1 — exporting…"
  if [ -n "${FAKE_HANG:-}" ]; then while :; do sleep 0.1; done; fi   # an export that never ends
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
# A crash that leaves its JVM behind (firebase-tools does not always wait for what it started).
if [ -n "${FAKE_ABANDON_JVM:-}" ]; then sleep 1; echo "firebase-tools crashed"; exit 1; fi
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
  node "$ROOT/tools/test-scaffold/render-engine.mjs" "$d"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/tools/emulator-data.sh"
  node "$ROOT/tools/test-scaffold/emulator-tools.mjs" "$d"
  printf '{ "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 } } }\n' > "$d/firebase.json"
  printf '%s' "$d"
}

start() {   # start <ws> — in its own session under a shell, as Nx's run-commands spawns it; echoes the session's pid
  # `env --default-signal`: a background job of a non-interactive shell (this test) starts with SIGINT IGNORED, and
  # an ignored-on-entry signal cannot be trapped — no real launcher (Nx, a terminal) does that to it.
  ( cd "$1" || exit 1
    PATH="$TMP/bin:$PATH" EMULATORS_STOP_TIMEOUT="${STOP_TIMEOUT:-20}" DEV_OWNER=test env --default-signal=INT,QUIT setsid bash -c 'bash tools/emulators.sh > out.log 2>&1; echo $? > rc' < /dev/null > /dev/null 2>&1 &
    echo $! )
}
rc() { cat "$1/rc" 2>/dev/null; }
script() { pgrep -P "$1" -f 'tools/emulators.sh'; }   # the script itself, under its session's shell
ready() { for _ in $(seq 1 100); do grep -q 'All emulators ready' "$1/out.log" 2>/dev/null && return 0; sleep 0.1; done; return 1; }
descendants() { local c; for c in $(pgrep -P "$1"); do descendants "$c"; echo "$c"; done; }
gone() { for _ in $(seq 1 "${2:-100}"); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.1; done; return 1; }
exported() { [ -f "$1/.emulator-data/firebase-export-metadata.json" ]; }
signals() { grep -vx JVM-KILLED "$1/.fake-firebase-signals" | tr '\n' ' ' | sed 's/ $//'; }
gone_dir() { for _ in $(seq 1 100); do [ -d "$1" ] || return 0; sleep 0.1; done; return 1; }
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
W="$(mkws nx)"; P="$(start "$W")"; STARTED+=("$P")
ok "nx: the suite came up" "$(ready "$W" && echo 1 || echo 0)"
# The keeper's recorded identity IS its own: every reader (the script's wait, `dev ps`, a restart's claim, the keeper's
# own release) trusts it. It once held a forked subshell's start time — equal to the keeper's only within one clock
# tick, so a wrong one showed up as a flake in whichever case it struck. Compared directly, it cannot hide.
own_identity() {
  local entry="$1/.bespunky/run/firebase@0/detached/emulators.json" pid start s
  pid="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid))' "$entry" 2>/dev/null)"
  start="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).procStart))' "$entry" 2>/dev/null)"
  s="$(cat "/proc/$pid/stat" 2>/dev/null)" || return 1; s="${s##*) }"; set -- $s
  [ -n "$start" ] && [ "$start" = "${20:-}" ]
}
ok "nx: the keeper records its OWN identity (pid + kernel start time)" "$(own_identity "$W" && echo 1 || echo 0)"
mapfile -t TREE < <(descendants "$P"; echo "$P")
for pid in "${TREE[@]}"; do kill -TERM "$pid" 2>/dev/null; done   # deepest first, as killProcessTreeGraceful does
sleep 1
for pid in "${TREE[@]}"; do kill -KILL "$pid" 2>/dev/null; done
ok "nx: no emulator child was in the script's tree to be signalled" "$(grep -q JVM-KILLED "$W/.fake-firebase-signals" && echo 0 || echo 1)"
ok "nx: the suite finished its save after its supervisor was SIGKILLed" "$(keeper_gone "$W" && exported "$W" && echo 1 || echo 0)"
ok "nx: firebase-tools got exactly ONE SIGTERM (got: $(signals "$W"))" "$([ "$(signals "$W")" = TERM ] && echo 1 || echo 0)"
TMPD="$(cat "$W/.fake-firebase-tmpdir")"
ok "nx: run directly, its stack (record, state dir, TMPDIR) is released once the save is done" "$(gone_dir "$W/.bespunky/run/firebase@0" && [ ! -f "$W/.bespunky/run/firebase@0.json" ] && [ ! -d "$TMPD" ] && echo 1 || echo 0)"
ok "nx: the stop was announced while it ran" "$(grep -q 'stopping — exporting emulator data' "$W/out.log" && echo 1 || echo 0)"
ok "the suite's TMPDIR is the stack's own, and SHORT (a Functions worker socket must fit 107 bytes): $TMPD" "$(printf '%s' "$TMPD" | grep -qE '^/tmp/bespunky-[0-9a-f]{12}$' && echo 1 || echo 0)"

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
# Deterministic, never a sleep: the restart comes once the stack is FINISHING (its script gone, its keeper saving).
finishing() { for _ in $(seq 1 100); do (cd "$1" && DEV_OWNER=test node tools/dev/dev.mjs ps 2>/dev/null) | grep -q 'firebase@0 .*FINISHING' && return 0; sleep 0.1; done; return 1; }
ok "restart: the killed run's stack is FINISHING (its keeper still saving)" "$(finishing "$W" && echo 1 || echo 0)"
mv "$W/out.log" "$W/out1.log"
P2="$(start "$W")"; STARTED+=("$P2")
ok "restart: the new start's claim waited for the previous suite's save" "$(ready "$W" && grep -q "firebase@0 — this stack's previous run — is still finishing" "$W/out.log" && exported "$W" && echo 1 || echo 0)"
ok "restart: then it holds the stack itself (a live record, its own keeper)" "$(grep -q '"status": "running"' "$W/.bespunky/run/firebase@0/detached/emulators.json" && [ -f "$W/.bespunky/run/firebase@0.json" ] && echo 1 || echo 0)"
# A second start while the first RUNS is the same stack twice: refused by the claim, naming the running one.
mv "$W/out.log" "$W/out2.log"
P3="$(start "$W")"; STARTED+=("$P3"); gone "$P3" 100
ok "twice: a second direct run while the first runs is refused (exit $(rc "$W")), naming it" "$([ "$(rc "$W")" = 1 ] && grep -q 'offset 0 is held — firebase@0 (live' "$W/out.log" && echo 1 || echo 0)"
mv "$W/out2.log" "$W/out.log"
kill -TERM "$(script "$P2")"; gone "$P2" 100

# ── 6. The suite dies on its own: the script fails, naming the log ─────────────────────────────────
W="$(mkws crash)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
for fb in $(pgrep -f "$TMP/bin/firebase"); do   # this workspace's fake firebase-tools — its "JVM" dies under it
  [ "$(readlink "/proc/$fb/cwd")" = "$W" ] && pkill -TERM -P "$fb"
done
gone "$P" 100; CODE="$(rc "$W")"
ok "crash: the script exits non-zero (got $CODE) and names the suite's log" "$([ -n "$CODE" ] && [ "$CODE" -ne 0 ] && grep -q 'CRASHED.*its log: .*emulators.log' "$W/out.log" && echo 1 || echo 0)"

# ── 6b. What the old reaper hunted (an orphaned emulator JVM) is never left behind, and never taken from a live suite ──
# The reaper decided by PPID == 1 whether to kill; the stack identity replaces it. A suite's processes are all in its
# keeper's process group: when firebase-tools dies leaving its JVM, the keeper ends the JVM itself; when the keeper is
# killed outright, the stack's record stays ORPHANED and `tools/dev/dev stop` ends exactly those processes. A LIVE
# suite is never touched by a second start — the claim refuses (the "twice" case above).
fake_procs() { local p n=0; for p in $(pgrep -f "$TMP/bin/firebase|jvm"); do [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$1" ] && n=$((n + 1)); done; echo "$n"; }
none_left() { for _ in $(seq 1 50); do [ "$(fake_procs "$1")" = 0 ] && return 0; sleep 0.1; done; return 1; }   # a SIGKILLed process takes a moment to be reaped
W="$(mkws strand)"; P="$(FAKE_ABANDON_JVM=1 start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
gone "$P" 100
ok "orphan: a JVM left by a crashed firebase-tools is ended by the keeper, and said so" "$(none_left "$W" && grep -qE 'left [0-9]+ process\(es\) running after firebase-tools exited' "$W/.bespunky/run/logs/firebase@0.emulators.log" && echo 1 || echo 0)"
W="$(mkws keeperkill)"; P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
KEEPER="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid))' "$W/.bespunky/run/firebase@0/detached/emulators.json")"
kill -KILL "$KEEPER"; gone "$P" 100
PS="$(cd "$W" && DEV_OWNER=test node tools/dev/dev.mjs ps 2>&1)"
ok "orphan: a keeper killed outright leaves the stack ORPHANED (its record the handle), not forgotten" "$(grep -q 'firebase@0 .*ORPHANED' <<<"$PS" && [ "$(fake_procs "$W")" -gt 0 ] && echo 1 || echo 0)"
OUT="$(cd "$W" && DEV_OWNER=test timeout 30 node tools/dev/dev.mjs stop firebase --offset=0 2>&1)"
ok "orphan: dev stop ends exactly what it left, and the stack is released" "$(none_left "$W" && gone_dir "$W/.bespunky/run/firebase@0" && echo 1 || echo 0)"

# ── 7. Its stack's serve was killed first (Nx's force-kill after a Ctrl+C mid-export): the keeper, last one out, ──
# removes the stack's run record and state dir — through the engine's own rule, so never a stack that is live.
under_engine() {   # under_engine <ws> <record-pid> — a dev-engine stack app@0 whose serve is <record-pid>; echoes the session
  local d="$1"
  mkdir -p "$d/.bespunky/run/app@0" /tmp/bespunky-0123456789ab
  # The record the engine's claim writes — its claimer named by PID, kernel start time, command line and process table.
  node --input-type=module -e '
    const [lib, d, pid] = process.argv.slice(1);
    const { machineId, processStart, commandLine } = await import(lib);
    const p = Number(pid);
    const rec = { version: 2, key: "app@0", app: "app", tree: d, offset: 0, pid: p, procStart: processStart(p), command: commandLine(p), machine: machineId(), ports: {}, tmp: "/tmp/bespunky-0123456789ab", processes: [] };
    (await import("node:fs")).writeFileSync(d + "/.bespunky/run/app@0.json", JSON.stringify(rec));
  ' "file://$d/tools/dev/lib/stacks.mjs" "$d" "$2"
  ( cd "$d" || exit 1
    PATH="$TMP/bin:$PATH" EMULATORS_STOP_TIMEOUT=20 DEV_STACK_DIR="$d/.bespunky/run/app@0" DEV_STACK_TMP=/tmp/bespunky-0123456789ab env --default-signal=INT,QUIT setsid bash -c 'bash tools/emulators.sh > out.log 2>&1; echo $? > rc' < /dev/null > /dev/null 2>&1 &
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
KEEPER="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid))' "$W/.bespunky/run/app@0/detached/emulators.json" 2>/dev/null)"
kill -KILL -- "-$P"
gone "$KEEPER" 100   # the keeper's last act is its prune: once it is gone, whatever it was going to remove is removed
ok "serve live (or a new stack on the key): the keeper leaves its record and state dir" "$([ -f "$W/.bespunky/run/app@0.json" ] && [ -d "$W/.bespunky/run/app@0" ] && echo 1 || echo 0)"
kill "$LIVE" 2>/dev/null

# ── 8. A hung export (R3-3): past its deadline the keeper ends its own group, records ABANDONED, and says so ─────
W="$(mkws hang)"; P="$(FAKE_HANG=1 STOP_TIMEOUT=2 start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -TERM "$(script "$P")"
gone "$P" 150; CODE="$(rc "$W")"
ok "hung export: the script ends within the deadline, non-zero (got $CODE), saying ABANDONED" "$([ -n "$CODE" ] && [ "$CODE" -ne 0 ] && grep -q 'ABANDONED after .*deadline passed' "$W/out.log" && echo 1 || echo 0)"
ok "hung export: nothing of the suite is left running, and the stack is released" "$(! pgrep -f "$TMP/bin/firebase" >/dev/null 2>&1 || ! for fb in $(pgrep -f "$TMP/bin/firebase"); do [ "$(readlink "/proc/$fb/cwd")" = "$W" ] && exit 0; done; gone_dir "$W/.bespunky/run/firebase@0" && echo 1 || echo 0)"

# ── 9. `tools/dev/dev stop --abandon` ends a FINISHING suite at once, by its handle ────────────────────────────
W="$(mkws abandon)"; P="$(FAKE_HANG=1 STOP_TIMEOUT=600 start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
kill -KILL -- "-$P"   # the supervisor is gone; the keeper is "saving" — forever
for _ in $(seq 1 50); do grep -q '"status": "stopping"' "$W/.bespunky/run/firebase@0/detached/emulators.json" 2>/dev/null && break; sleep 0.1; done
PS="$(cd "$W" && DEV_OWNER=test node tools/dev/dev.mjs ps 2>&1)"
ok "abandon: dev ps shows the stack FINISHING, with the --abandon command" "$(grep -q 'firebase@0 .*FINISHING.*--abandon' <<<"$PS" && echo 1 || echo 0)"
OUT="$(cd "$W" && DEV_OWNER=test timeout 30 node tools/dev/dev.mjs stop firebase --offset=0 --abandon 2>&1)"; CODE=$?
[ -n "${KEEP:-}" ] && printf "%s\n" "$OUT"
ok "abandon: dev stop --abandon returns at once, the keeper's ABANDONED result reported" "$(grep -q 'ABANDONED' <<<"$OUT" && gone_dir "$W/.bespunky/run/firebase@0" && echo 1 || echo 0)"

# ── 10. environment.ts commits a service real under a RUNNING suite (S2-3): the browser hot-reloads onto the real id at
# once, the suite cannot follow — it says so, with the exact restart command, and says so again when back in step.
W="$(mkws flip)"
sed -e 's/{{workspaceName}}/testws/g' -e 's|{{appEnvPath}}|app/environment.ts|g' -e 's|{{functionsRoot}}|apps/fn|g' -e 's|{{functionsDist}}|dist/apps/fn|g' "$TPL" > "$W/tools/emulators.sh"
mkdir -p "$W/app"
envfile() { printf 'export const environment = { firebase: { projectId: "acme-prod" }, emulators: { auth: { default: %s }, firestore: { default: true } } };\n' "$1" > "$W/app/environment.ts"; }
envfile true
P="$(start "$W")"; STARTED+=("$P")
ready "$W" >/dev/null
said() { for _ in $(seq 1 80); do grep -q "$2" "$1/out.log" 2>/dev/null && return 0; sleep 0.1; done; return 1; }
envfile false
ok "flip: committing auth real under the running offline suite is said (RESTART NEEDED)" "$(said "$W" 'RESTART NEEDED: environment.ts now commits auth to the real backend — the app runs under acme-prod, but this suite was started under demo-acme-prod' && echo 1 || echo 0)"
ok "flip: …with the exact restart command for a direct run" "$(grep -qF "cd $W && tools/dev/dev stop firebase --offset=0 && PORT_OFFSET=0 bash tools/emulators.sh" "$W/out.log" && echo 1 || echo 0)"
printf 'export const environment = ;\n' > "$W/app/environment.ts"
ok "flip: a file that no longer evaluates is said, the suite kept" "$(said "$W" 'cannot be evaluated now' && echo 1 || echo 0)"
envfile true
ok "flip: back in step is said too" "$(said "$W" 'back in step with this suite (demo-acme-prod)' && echo 1 || echo 0)"
kill -TERM "$(script "$P")"; gone "$P" 100

exit "$FAILED"
