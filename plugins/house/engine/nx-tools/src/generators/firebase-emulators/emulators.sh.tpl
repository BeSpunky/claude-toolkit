#!/usr/bin/env bash
# Launch the local Firebase emulator suite for development — the single launch path
# the Nx `firebase:emulators*` targets all funnel through (so the claim → prime → start
# recipe lives in exactly one place instead of being copy-pasted across five targets).
#
# Three steps, in order:
#   1. claim  — the suite's ports, as a stack (tools/dev — see STACK IDENTITY below): run by the dev engine,
#               its serve already claimed them; run on its own, this script claims them itself.
#   2. prime  — make sure the working data dir exists (from the default seed on a fresh
#               clone), so --import has something to load (tools/emulator-data.sh).
#   3. start  — boot the suite, IMPORTING the working dir and, on the full run only,
#               EXPORTING back to it on a clean exit. That import/export pair is the
#               "caching": onboard once and your session + data survive every serve.
#
# EVERY run passes `--only`. Left to itself, `firebase emulators:start` starts what it
# INFERS is applicable, not what firebase.json declares — including an App Hosting emulator
# inferred from the root apphosting.yaml, which exits 1 and takes the whole suite with it.
# A full run therefore derives the list from firebase.json's own `emulators` block; a focused
# run passes its own. See the derivation below for why this, and not a `dev` script.
#
# SEEDS ARE SHARED FROM MAIN; DATA IS ISOLATED PER STACK. An isolated stack (PORT_OFFSET != 0)
# gets its own data dir and owns it — it exports back on exit, so a worktree's session and any
# seed work it does persist and stay its own. It is PRIMED once from the 'default' seed, resolved
# this tree first, else the main worktree's: seeds are built artifacts and gitignored, so a fresh
# worktree has none and would otherwise start from an empty world. Priming is a COPY, so a
# worktree can never reach back and change what main holds. A worktree that builds or edits its
# own seeds shadows main's for every later run — isolation, without having to set it up.
#
# Persistence follows the EXPLICIT flag, not the presence of `--only`: a derived list IS the
# full suite and must still export, while a genuinely partial run (e.g. auth-only) would
# export ONLY its slice on exit and clobber the firestore/storage data in the shared working
# dir. Focused runs still IMPORT the cached world (handy for debugging against real data) —
# they just don't write it back.
#
# STOPPING IS THE PART THAT LOSES DATA, so this script owns it (see SUPERVISION below): the suite runs
# OUTSIDE every supervisor's process tree, gets exactly ONE stop at the firebase-tools process, and this
# script waits for the export and says when it is done.
#
#   bash tools/emulators.sh                  # full suite, cached (import + export)
#   bash tools/emulators.sh --only auth,ui   # focused, import-only (no export)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# A process's identity is its PID AND its kernel start time (PIDs are reused) — the dev engine's rule too.
proc_start() { local s; s="$(cat "/proc/$1/stat" 2>/dev/null)" || return 0; s="${s##*) }"; set -- $s; printf '%s' "${20:-}"; }
is_proc() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null && { [ -z "${2:-}" ] || [ "$(proc_start "$1")" = "$2" ]; }; }

DATA_DIR="$ROOT/.emulator-data"

# ── STACK IDENTITY: ONE CLAIM FOR EVERYTHING THAT BINDS THIS PROJECT'S PORTS ──────────────────────────────────
# A suite is a STACK: it holds a block of ports, it has a state dir, a TMPDIR and a handle (`tools/dev/dev ps`,
# `tools/dev/dev stop`). Run by the dev engine (`nx serve <app>`, `tools/dev/dev serve`), the serve CLAIMED the block
# for its whole stack before it started anything, and hands the suite its state dir (DEV_STACK_DIR), its TMPDIR
# (DEV_STACK_TMP) and its offset (PORT_OFFSET). Run on its own (`nx run firebase:emulators`), this script claims
# `firebase@<offset>` itself, through the same engine — so a direct run and a serve see each other, and the second
# of them is refused naming the first, instead of the two colliding port by port. The claim is atomic; a block whose
# previous suite is still SAVING is waited for (nothing is lost). Run directly by an AI agent (CLAUDECODE=1), the
# suite never lands on the base ports (`auto`), and PORT_OFFSET=0 is refused.
#
# THE STACK LIVES WHILE ITS LOCK IS HELD (tools/dev/lib/stacks.mjs): a SHARED flock this script takes — on the lock the
# serve passed (DEV_STACK_LOCK), or on a fresh one of its own before it claims — and that everything it starts
# inherits, the detached keeper above all. So the stack stays claimed while the suite saves after this script is gone,
# and is free the instant the last of them exits, however it exits: the kernel releases it.
#
# Port-offset isolation (PORT_OFFSET): the WHOLE suite moves onto one block, so it COEXISTS with a suite on the base
# ports. We generate an offset copy of firebase.json (every emulator port +OFFSET, every nested port such as
# firestore.websocketPort, and the hub/logging ports firebase-tools otherwise fixes at 4400/4500 — all from
# tools/emulator-ports.mjs, the one port table) and keep this stack's data in its own dir. OFFSET 0 (the default) =
# the base forwarded stack, entirely unchanged.
#
# EACH STACK ITS OWN SHORT TMPDIR. firebase-tools finds a running suite through `os.tmpdir()/hub-<projectId>.json`,
# keyed by the project id alone: sharing one /tmp, a second suite's export-on-exit asks the FIRST suite's hub to export
# (data lands in the wrong dir, or nothing is saved — reproduced, firebase-tools 15.32.1). And every Cloud Functions
# worker listens on `os.tmpdir()/fire_emu_<16 hex>.sock`: a Unix socket path is cut at 107 bytes, so a TMPDIR deep in
# a worktree silently cut the random part away — every worker bound ONE name and a call to one function was answered
# by another's worker. The stack's TMPDIR is `/tmp/bespunky-<hash>` (tools/dev/lib/stacks.mjs stackTmp), removed with
# the stack. The JVM emulators use java.io.tmpdir, which TMPDIR does not move — and need not.
[ -f "$ROOT/tools/dev/dev.mjs" ] || { echo "[emulators] the dev engine (tools/dev) is missing — it claims this suite's ports. Run the house upgrade." >&2; exit 1; }
if [ -n "${DEV_STACK_DIR:-}" ]; then
  STACK_DIR="$DEV_STACK_DIR"
  STACK_TMP="${DEV_STACK_TMP:?the dev engine that started this suite gave it no TMPDIR (DEV_STACK_TMP) — run the house upgrade}"
  STACK_LOCK="${DEV_STACK_LOCK:?the dev engine that started this suite gave it no stack lock (DEV_STACK_LOCK) — run the house upgrade}"
  exec {STACK_LOCK_FD}<"$STACK_LOCK"
  flock -s -w 30 "$STACK_LOCK_FD" || { echo "[emulators] could not join the stack's lock $STACK_LOCK" >&2; exit 1; }
  OFFSET="${PORT_OFFSET:-0}"
  DIRECT=0
else
  mkdir -p "$ROOT/.bespunky/run/locks"
  STACK_LOCK="$ROOT/.bespunky/run/locks/$$-$RANDOM$RANDOM.lock"
  exec {STACK_LOCK_FD}>"$STACK_LOCK"
  flock -s -n "$STACK_LOCK_FD"
  STACK_KEY=''
  # Given up when this script ends: our descriptor closed, then the record removed — unless the suite is still saving
  # (its keeper holds the lock): then the keeper, the last one out, removes it. A claim that never happened: the lock file.
  trap 'exec {STACK_LOCK_FD}>&-; if [ -n "$STACK_KEY" ]; then node "$ROOT/tools/dev/dev.mjs" release "$STACK_KEY" --lock="$STACK_LOCK" >/dev/null 2>&1 || true; else rm -f "$STACK_LOCK"; fi' EXIT
  CLAIM="$(node "$ROOT/tools/dev/dev.mjs" claim firebase --pid=$$ --lock="$STACK_LOCK" ${PORT_OFFSET:+--port-offset="$PORT_OFFSET"} \
    --ports="$(node "$ROOT/tools/emulator-ports.mjs" claim "$ROOT/firebase.json")")" || exit 1
  eval "$CLAIM"
  OFFSET="$STACK_OFFSET"
  DIRECT=1
  echo "[emulators] stack $STACK_KEY claimed — tools/dev/dev ps shows it; stop it with Ctrl+C or: tools/dev/dev stop firebase --offset=$OFFSET" >&2
fi
mkdir -p "$STACK_DIR" "$STACK_TMP"
export TMPDIR="$STACK_TMP"

CONFIG_ARGS=()
if [ "$OFFSET" != "0" ]; then
  echo "[emulators] PORT_OFFSET=$OFFSET — isolated stack (shifted ports + own data dir)" >&2
  OFFSET_CONFIG="$ROOT/.firebase.offset-$OFFSET.json"
  node "$ROOT/tools/emulator-ports.mjs" shift "$ROOT/firebase.json" "$OFFSET" "$OFFSET_CONFIG"
  CONFIG_ARGS=(--config "$OFFSET_CONFIG")
  DATA_DIR="$ROOT/.emulator-data-$OFFSET"
fi

# ── THE PROJECT ID: OFFLINE UNLESS THE APP COMMITS A REAL SERVICE ─────────────────────────────────────
# The suite runs under the OFFLINE twin of the app's project id (`my-app` → `demo-my-app`): Google refuses to create
# a `demo-` project, so every Google API call the emulated code makes names a project that cannot exist —
# firebase-tools itself turns away Secret Manager, the Admin SDK's config lookup, FCM, a non-emulated bucket. The
# REAL id only when environment.ts commits a service to the real backend (EMULATE map), because a real service and
# the emulated ones must share one id (singleProjectMode) — and the browser follows the same rule from the same file
# (firebase.config.ts → emulatorProjectId), so the two always agree. The rule, and what it does not cover:
# tools/emulator-project.mjs. One suite = one project: it follows the PRIMARY app this workspace was wired with.
ENV_FILE="$ROOT/{{appEnvPath}}"
EMU_VARS="$(node "$ROOT/tools/emulator-project.mjs" resolve "$ENV_FILE" demo-{{workspaceName}})" \
  || { echo "[emulators] could not resolve the emulator project id (tools/emulator-project.mjs) — refusing to guess." >&2; exit 2; }
eval "$EMU_VARS"
PROJECT="$EMU_PROJECT"
if [ "$EMU_MODE" = real ]; then
  echo "[emulators] project: $PROJECT — REAL. environment.ts commits ${EMU_REAL_SERVICES//,/, } to the real backend, so the" >&2
  echo "[emulators]   whole suite runs under the real project: anything not emulated, and any code naming the project," >&2
  echo "[emulators]   reaches production with your firebase login. Emulate every service again to run offline (demo-)." >&2
else
  echo "[emulators] project: $PROJECT — OFFLINE (demo-): calls to any Google service that is not emulated fail, never reach a real project." >&2
  [ "$PROJECT" = "$EMU_APP_PROJECT" ] || echo "[emulators]   ($EMU_APP_PROJECT, environment.ts's id, is used only when it commits a service to the real backend.)" >&2
fi
[ -z "$EMU_UNREAD_SERVICES" ] || echo "[emulators]   could not read environment.ts's default for ${EMU_UNREAD_SERVICES//,/, } (not a literal or EMULATE entry) — taken as emulated." >&2

# Pass through an optional `--only <list>` (the focused targets use it); an EXPLICIT one
# is also what flips persistence off (see header).
ONLY_ARGS=()
PERSIST=1
EXPLICIT_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      ONLY_ARGS=(--only "$2")
      PERSIST=0
      EXPLICIT_ONLY=1
      shift 2
      ;;
    *)
      echo "[emulators] unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# ── ALWAYS PASS --only, DERIVED FROM firebase.json ─────────────────────────────────────────────
# `firebase emulators:start` with no --only does NOT start "the emulators in firebase.json" — it
# starts everything it decides is applicable, and it AUTO-DETECTS some of them from other files.
# The one that bites: a root `apphosting.yaml` (which the house generator writes, for deploys)
# makes firebase-tools bring up the App Hosting emulator, whose whole job is to run the framework
# dev server via `yarn dev`. There is no `dev` script in a house workspace, so it exits 1 — and
# firebase-tools takes the ENTIRE suite down with it. It surfaces as a bogus, unrelated
# `TIMEOUT: Port 5002`, which is why this cost a long afternoon before it was understood.
#
# Adding a `dev` script is NOT the fix. It would have to be `nx serve <app>`, the house `serve`
# target chains this script, and this script starts the suite — so the App Hosting emulator would
# launch a serve that launches the emulators that launch the App Hosting emulator. Defining `dev`
# does not fix the recursion, it creates it.
#
# There is also nothing to delete: the App Hosting emulator has no entry in firebase.json (it is
# inferred), so naming what we DO want is the only lever there is. That names it from firebase.json
# itself — the single source of truth for this project's emulator set — rather than a list baked in
# at generate time, which would silently disagree the moment the project edits its own config.
#
# PERSISTENCE IS DELIBERATELY UNAFFECTED. A derived list IS the full suite, so it must still import
# AND export; only an EXPLICIT `--only` (a genuinely partial run, which would export just its slice
# over the shared world) turns persistence off. Conflating the two would quietly stop every serve
# from saving its data — the exact "your signups vanished" bug, introduced while fixing another.
if [ "$EXPLICIT_ONLY" -eq 0 ]; then
  # Selectable emulators only. `singleProjectMode` is a boolean setting, and `hub`/`logging` are
  # infrastructure firebase-tools always runs and rejects as --only targets; everything else with a
  # port is a real emulator (`ui` included — it is a valid --only target and the suite is far less
  # useful without it).
  DERIVED_ONLY="$(node -e '
    const fs = require("fs");
    const skip = new Set(["singleProjectMode", "hub", "logging"]);
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).emulators || {}; } catch { cfg = {}; }
    const names = Object.keys(cfg).filter((k) => !skip.has(k) && cfg[k] && typeof cfg[k] === "object");
    process.stdout.write(names.join(","));
  ' "$ROOT/firebase.json" 2>/dev/null || true)"
  if [ -n "$DERIVED_ONLY" ]; then
    ONLY_ARGS=(--only "$DERIVED_ONLY")
    echo "[emulators] starting only what firebase.json declares: $DERIVED_ONLY" >&2
  else
    # No readable emulator block. Say so rather than silently starting whatever firebase-tools
    # infers — that is the failure this whole block exists to prevent, and a silent fallback into
    # it would be indistinguishable from the bug.
    echo "[emulators] WARNING: no emulators found in firebase.json — starting firebase-tools' own" >&2
    echo "[emulators]   default selection, which may include auto-detected emulators (App Hosting)" >&2
    echo "[emulators]   that can take the whole suite down. Check the 'emulators' block." >&2
  fi
fi

# ── CLONE-LEVEL RESOURCES, RESOLVED ONCE ───────────────────────────────────────────────────────
# The built emulator SEEDS are gitignored, so they exist per CLONE and never arrive in a freshly-created
# git worktree. A worktree resolves them this tree first, else the main worktree's — resolve the main
# worktree once here. (Secrets are deliberately NOT resolved this way: see FUNCTIONS SECRETS below.)
#
# `|| true` under `set -euo pipefail`: outside a repository `git worktree list` exits 128, and
# pipefail would propagate that into an errexit kill. Not being in a repo is ordinary here.
MAIN_WORKTREE="$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -1 || true)"

# The seed to prime an isolated stack from. THIS TREE'S OWN SEEDS WIN, and that is the whole point:
# a worktree that builds or edits seeds is doing it in isolation, and must get its own world back —
# never the main tree's. A worktree that has NOT touched seeds has no seeds at all (they are built
# artifacts, gitignored), and starting it from an empty world would make every isolated serve begin
# with nothing. So it borrows the main tree's as a read-only BASE: primed by copy, so nothing a
# worktree then does can reach back and change what main holds.
seed_dir() {   # seed_dir <name> — echoes the resolved seed path, or nothing when there is none
  local name="$1"
  if [ -f "$ROOT/tools/emulator-seeds/$name/firebase-export-metadata.json" ]; then
    printf '%s' "$ROOT/tools/emulator-seeds/$name"
  elif [ -n "$MAIN_WORKTREE" ] && [ "$MAIN_WORKTREE" != "$ROOT" ] \
    && [ -f "$MAIN_WORKTREE/tools/emulator-seeds/$name/firebase-export-metadata.json" ]; then
    printf '%s' "$MAIN_WORKTREE/tools/emulator-seeds/$name"
  fi
}

# ── SUPERVISION: ONE STOP, DELIVERED ONCE, WAITED FOR ────────────────────────────────────────────────
# The export-on-exit runs inside firebase-tools, and only when IT is told to stop while its emulators are still
# up. A signal that reaches an emulator JVM directly kills that JVM first; firebase-tools then reads "Firestore
# Emulator has exited with code: 143", stops everything as a FATAL error — and exports nothing. Every supervisor
# above us does exactly that: Nx (run-commands, and `nx serve` itself) stops a task with killProcessTreeGraceful,
# which signals the LEAVES of the tree first — the JVMs — and SIGKILLs whatever is left after ~5 s, far short of
# the ~30 s an export takes. A terminal's Ctrl+C reaches the whole foreground group, the JVMs included. That is
# how `tools/dev/dev stop` and Ctrl+C on `nx serve` lost every stack's data while a lone `kill <pid>` of this
# script (one signal, exec'd straight into firebase-tools) exported fine.
#
# So the suite is never in a supervisor's tree. It runs under a KEEPER — this script's own code, detached: its
# own process group (no terminal signal reaches it) and reparented away (no tree walk finds it). The keeper is
# the ONLY thing that ever signals firebase-tools, exactly once, when the stop is asked for: by this script on
# any TERM/INT/HUP, or by its own discovery that this script is gone (a supervisor SIGKILLed it, a terminal
# closed). A stop can therefore never lose the data, however it arrives — at worst the export finishes after
# whoever asked has stopped waiting. In the foreground, this script streams the suite's log (where its output
# always went), waits for the export with progress, and says what happened. The keeper records itself in the
# stack's state dir (`detached/emulators.json`): the dev engine waits for it before it calls a stack stopped,
# `tools/dev/dev ps` shows it while it finishes, and the next claim of this stack's ports waits for it instead of
# colliding with a suite that is still saving. It owns a deadline (see keep), so nothing waits on it forever.
DETACHED_DIR="$STACK_DIR/detached"
ENTRY="$DETACHED_DIR/emulators.json"
STOP_FILE="$DETACHED_DIR/emulators.stop"
# Outside the state dir, which is removed with the stack: a crashed suite's log must outlive it.
LOG_DIR="$(dirname "$STACK_DIR")/logs"
LOG="$LOG_DIR/$(basename "$STACK_DIR").emulators.log"
STOP_TIMEOUT="${EMULATORS_STOP_TIMEOUT:-120}"
mkdir -p "$DETACHED_DIR" "$LOG_DIR"

# A sleep with no child process: under a tree-killer a child `sleep` is a leaf that keeps this script from ever
# being one, and the stop would never reach it.
exec {NAP_FD}<> <(:)
nap() { read -r -t "$1" -u "$NAP_FD" _ || true; }
# The keeper's entry, written atomically (the engine and the next start read it). Fields as plain strings.
entry_write() {   # entry_write <status> [doing] [code] [result] [deadline]
  node -e '
    const fs = require("fs");
    const [file, pid, start, proxy, proxyStart, status, doing, log, code, result, deadline] = process.argv.slice(1);
    const e = { id: "emulators", what: "the Firebase emulator suite", pid: Number(pid), procStart: start || null,
      proxyPid: Number(proxy), proxyStart: proxyStart || null, status, log, at: new Date().toISOString() };
    if (doing) e.doing = doing;
    if (code !== "") e.code = Number(code);
    if (result) e.result = result;
    if (deadline) e.deadline = Number(deadline);
    fs.writeFileSync(file + ".tmp", JSON.stringify(e, null, 2) + "\n");
    fs.renameSync(file + ".tmp", file);
  ' "$ENTRY" "$KEEPER_PID" "$KEEPER_START" "$PROXY_PID" "$PROXY_START" "$1" "${2:-}" "$LOG" "${3:-}" "${4:-}" "${5:-}"
}
entry_field() {   # entry_field <name> — one field of the entry, as plain text ('' when absent)
  node -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; process.stdout.write(v == null ? "" : String(v)); } catch {}' "$ENTRY" "$1"
}

# No previous suite of this stack can still be running or saving here: the claim waited for one that was saving, and
# refused one that was running. What it left in the state dir is history.
mkdir -p "$DETACHED_DIR"
if [ "$OFFSET" = "0" ]; then
  bash "$ROOT/tools/emulator-data.sh" ensure
elif [ ! -f "$DATA_DIR/firebase-export-metadata.json" ]; then
  # Prime THIS isolated stack's own data dir ONCE, from the resolved 'default' seed — a known world,
  # without touching (or importing from) the base stack's .emulator-data. From here on the stack
  # owns its data: it exports back to this dir on exit, so a worktree's session, its signups and any
  # seed work it does persist across restarts and stay entirely its own.
  SEED="$(seed_dir default)"
  if [ -n "$SEED" ]; then
    cp -r "$SEED" "$DATA_DIR"
    case "$SEED" in
      "$ROOT"/*) echo "[emulators] isolated data dir primed from this tree's 'default' seed: $DATA_DIR" >&2 ;;
      *)         echo "[emulators] isolated data dir primed from the main worktree's 'default' seed: $SEED" >&2 ;;
    esac
  fi
fi

# ── STORAGE DATA FOLLOWS THE PROJECT ID ─────────────────────────────────────────────────────────────
# Emulator Storage keys its data by BUCKET NAME, and the bucket the app and the functions use follows the project id
# (offline: `<demo id>.appspot.com`; real: environment.ts's storageBucket). Data a suite saved under the other mode's
# bucket — every export from before the offline default — is moved across, so it is never silently out of sight.
if [ -f "$DATA_DIR/firebase-export-metadata.json" ]; then
  MOVED="$(node "$ROOT/tools/emulator-project.mjs" align-storage "$DATA_DIR" "$EMU_OTHER_BUCKET" "$EMU_BUCKET")" || MOVED=""
  [ -z "$MOVED" ] || echo "[emulators] $MOVED" >&2
fi

# ── FUNCTIONS SECRETS: INERT BY DEFAULT ─────────────────────────────────────────────────────────────
# The Functions emulator reads `.secret.local` from the loaded bundle ({{functionsDist}}), and asks Secret Manager for
# any declared secret it does not find there. The offline project id above already makes that a call to a project
# that cannot exist; tools/emulator-secrets.cjs is the defence in depth (its header has the whole of it):
#   1. INERT PLACEHOLDERS — written by the functions BUILD (so every rebuild and a raw `firebase emulators:start`
#      carry them), and rewritten here at launch with the production file's key NAMES added (never a value).
#   2. A SINK — Secret Manager pointed at an address that cannot resolve, for the emulator process.
#
# REAL VALUES ARE AN OPT-IN, AND ONLY EVER SANDBOX ONES. {{functionsRoot}}/.secret.sandbox.local (gitignored) — creating
# it is the opt-in, every launch says which keys are live, and a value equal to ANY production value (this tree's
# .secret.local or the main worktree's) is refused. `EMULATOR_SECRETS=inert` disarms it for one run;
# `EMULATOR_SECRETS=sandbox` insists on it. A rebuild mid-session puts the build's inert file back: restart to re-arm.
# The production `.secret.local` is push-secrets' source and is NEVER fed to an emulator.
#
# NEVER BORROWED ACROSS TREES. A worktree gets its own sandbox file or none — an unattended agent's worktree must
# never wake up armed because the main tree is. (The main tree's PRODUCTION values are read for one purpose only:
# to refuse them.)
FUNCTIONS_SRC="$ROOT/{{functionsRoot}}"
FUNCTIONS_DIST="$ROOT/{{functionsDist}}"
SANDBOX_FILE="$FUNCTIONS_SRC/.secret.sandbox.local"
export CLOUD_SECRET_MANAGER_URL="https://secret-manager.disabled-for-emulators.invalid"

SECRETS_MODE="${EMULATOR_SECRETS:-}"
case "$SECRETS_MODE" in
  '') if [ -f "$SANDBOX_FILE" ]; then SECRETS_MODE=sandbox; else SECRETS_MODE=inert; fi ;;
  inert|sandbox) ;;
  *)
    echo "[emulators] EMULATOR_SECRETS=$SECRETS_MODE — expected 'inert' or 'sandbox'." >&2
    exit 2
    ;;
esac
if [ "$SECRETS_MODE" = sandbox ] && [ ! -f "$SANDBOX_FILE" ]; then
  echo "[emulators] EMULATOR_SECRETS=sandbox, but there is no {{functionsRoot}}/.secret.sandbox.local in this tree." >&2
  echo "[emulators]   Create it (KEY=VALUE lines, SANDBOX credentials only — never production's) or drop the flag." >&2
  exit 2
fi

# Functions run in this launch? (No `--only` at all = firebase-tools' own selection, which includes them.)
FUNCTIONS_IN_RUN=1
if [ "${#ONLY_ARGS[@]}" -gt 0 ]; then
  case ",${ONLY_ARGS[1]}," in *,functions,*) ;; *) FUNCTIONS_IN_RUN=0 ;; esac
fi

if [ -d "$FUNCTIONS_DIST" ]; then
  MAIN_FUNCTIONS_SRC=""
  [ -n "$MAIN_WORKTREE" ] && [ "$MAIN_WORKTREE" != "$ROOT" ] && MAIN_FUNCTIONS_SRC="$MAIN_WORKTREE/{{functionsRoot}}"
  SHOW=()
  [ "$FUNCTIONS_IN_RUN" -eq 1 ] && SHOW=(--show)
  # Exit 2 (from the script) when the file would not reach the emulator intact — never a silent launch without it.
  node "$ROOT/tools/emulator-secrets.cjs" place --mode="$SECRETS_MODE" --source="$FUNCTIONS_SRC" --dist="$FUNCTIONS_DIST" \
    --main-source="$MAIN_FUNCTIONS_SRC" --project-mode="$EMU_MODE" "${SHOW[@]}" || exit 2
fi

# Only import when the working dir is actually primed — `--import` on a missing dir is
# a hard error. On a brand-new clone with no seeds built yet, we start fresh and (when
# persisting) the clean exit writes the first export, so the next serve has data to import.
IMPORT_ARGS=()
[ -f "$DATA_DIR/firebase-export-metadata.json" ] && IMPORT_ARGS=(--import "$DATA_DIR")

EXPORT_ARGS=()
[ "$PERSIST" -eq 1 ] && EXPORT_ARGS=(--export-on-exit "$DATA_DIR")

FIREBASE_ARGS=("${CONFIG_ARGS[@]}" emulators:start --project="$PROJECT" "${ONLY_ARGS[@]}" "${IMPORT_ARGS[@]}" "${EXPORT_ARGS[@]}")
if [ "$PERSIST" -eq 1 ]; then STOP_DOING="exporting emulator data to $DATA_DIR"; else STOP_DOING="stopping (a focused run exports nothing, by design)"; fi

# The live members of the keeper's group (the suite: firebase-tools, its JVMs, whatever they started), the keeper
# itself excepted. Builtins only: a `$(…)` here would be a member of the group too.
group_members() {   # group_members <array-name>
  local -n _out="$1"
  local f stat pid
  _out=()
  for f in /proc/[0-9]*/stat; do
    pid="${f#/proc/}"; pid="${pid%/stat}"
    [ "$pid" = "$BASHPID" ] || [ "$pid" = "$KEEPER_PID" ] && continue
    read -r stat < "$f" 2>/dev/null || continue
    stat="${stat##*) }"
    set -- $stat
    if [ "${3:-}" = "$KEEPER_PID" ] && [ "${1:-}" != Z ]; then _out+=("$pid"); fi
  done
  return 0
}
# End what is left of the keeper's group — its own processes, and only those (the group is the suite's: nothing
# else can be in it). SIGKILL: this runs only once the suite is past asking (its deadline, an abandon, stragglers).
kill_group() {
  local members
  group_members members
  [ "${#members[@]}" -eq 0 ] && return 0
  kill -KILL "${members[@]}" 2>/dev/null || true
}

# THE STACK'S RECORD GOES WITH THE LAST ONE OUT. Each holder of the stack's lock lets go of it as it leaves and asks
# for the record to be removed; the engine removes it only once the kernel says nobody holds the lock — so the
# claimer (the dev engine, or this script run directly) leaves it to a keeper still saving, and the keeper, when it is
# the last one out (Nx force-kills a stopping task after a few seconds — a Ctrl+C while the suite exports), removes it.
# A stack since claimed again under the same key names another lock, and is never touched.
release_stack() {
  exec {STACK_LOCK_FD}>&-
  node "$ROOT/tools/dev/dev.mjs" release "$(basename "$STACK_DIR")" --lock="$STACK_LOCK" >/dev/null 2>&1 || true
}

# The keeper (see SUPERVISION). Runs detached; the only process that ever signals firebase-tools.
#
# IT OWNS A DEADLINE. Asked to stop, firebase-tools gets STOP_TIMEOUT seconds to export and exit. A hung export used
# to wedge the stack for good: the keeper waited forever, `tools/dev/dev ps` said FINISHING forever, and every restart
# waited and then refused — the only way out a kill by PID, the very thing the house steers everyone away from. Past
# the deadline the keeper ends its own process group, records `ABANDONED … after Ns` with a non-zero code, and says
# so in the log and to whoever is waiting. SIGUSR1 is the same, at once — `tools/dev/dev stop --abandon`.
keep() {
  # Its identity, PID and start time, OF THIS PROCESS. Never `$(proc_start "$BASHPID")`: a command substitution is a
  # fork, and `$BASHPID` expands INSIDE it, so that recorded the start time of a throwaway subshell — the keeper's own
  # only when the fork fell in the same clock tick (~9 in 10). Otherwise every reader took the keeper for dead while it
  # saved: the script quit at once, `ps` called the stack ORPHANED (and `dev stop` would kill the export), a restart
  # never waited, and the keeper's own release left the stack behind.
  KEEPER_PID=$BASHPID
  KEEPER_START="$(proc_start "$KEEPER_PID")"
  local requested=0 abandon='' signalled=0 stop_at=0 deadline=0 code=0 fb result now abandoned='' partial
  trap 'requested=1' TERM INT HUP
  trap 'abandon="asked for (tools/dev/dev stop --abandon)"; requested=1' USR1
  firebase "${FIREBASE_ARGS[@]}" </dev/null >>"$LOG" 2>&1 &
  fb=$!
  entry_write running
  while kill -0 "$fb" 2>/dev/null; do
    if [ "$signalled" -eq 0 ] && { [ "$requested" -eq 1 ] || [ -e "$STOP_FILE" ] || ! is_proc "$PROXY_PID" "$PROXY_START"; }; then
      signalled=1
      stop_at="$(date +%s)"
      deadline=$((stop_at + STOP_TIMEOUT))
      entry_write stopping "$STOP_DOING" "" "" "$deadline"
      kill -TERM "$fb" 2>/dev/null || true
    fi
    if [ "$signalled" -eq 1 ]; then
      now="$(date +%s)"
      [ -z "$abandon" ] && [ "$now" -ge "$deadline" ] && abandon="its ${STOP_TIMEOUT}s deadline passed (EMULATORS_STOP_TIMEOUT)"
      if [ -n "$abandon" ]; then
        abandoned="$abandon"
        echo "[emulators] ABANDONING the stop — ${abandoned}; firebase-tools had not finished after $((now - stop_at))s. Killing the suite's processes." >>"$LOG"
        kill_group
        break
      fi
    fi
    nap 0.2
  done
  wait "$fb" 2>/dev/null || code=$?
  if [ -n "$abandoned" ]; then
    # What is left on disk, said as it is: firebase-tools writes an export into a firebase-export-* dir in the project
    # root, then DELETES the data dir and moves the new export in. Killed before that swap, the data dir is as it was;
    # during it, partly deleted; and a staged export may be left behind (gitignored) holding the newest data.
    partial="$(find "$ROOT" -maxdepth 1 -type d -name 'firebase-export-*' -newermt "@$stop_at" 2>/dev/null | head -n 3 | tr '\n' ' ')"
    result="ABANDONED after $(( $(date +%s) - stop_at ))s — ${abandoned}. firebase-tools had not finished ${STOP_DOING}; its processes were killed. ${DATA_DIR} holds what it held before only if the export had not yet begun to replace it — it may be partly deleted.${partial:+ A staged export it left: ${partial}(the newest data, possibly incomplete — check it before copying it over ${DATA_DIR}).} Its log: $LOG"
    code=1
  elif [ "$signalled" -eq 1 ] && [ "$PERSIST" -eq 1 ]; then
    if [ -f "$DATA_DIR/firebase-export-metadata.json" ] && [ "$(stat -c %Y "$DATA_DIR/firebase-export-metadata.json" 2>/dev/null || echo 0)" -ge "$stop_at" ]; then
      result="exported to $DATA_DIR"
      code=0   # asked to stop, and it saved: a clean stop, whatever exit status firebase-tools chose for it
    else
      result="NO EXPORT was written to $DATA_DIR — firebase-tools did not complete it (exit $code); its log: $LOG"
      [ "$code" -ne 0 ] || code=1
    fi
  elif [ "$signalled" -eq 1 ]; then
    result="stopped (a focused run exports nothing, by design)"
    code=0
  elif [ "$code" -eq 0 ]; then
    result="exited on its own"
  else
    result="CRASHED — firebase-tools exited with code $code; its log: $LOG"
  fi
  # The suite is over when EVERY process of it is: firebase-tools does not always wait for what it started (a JVM
  # outlives a crashed firebase-tools), and a straggler still writes into this stack's TMPDIR as it exits. They are all
  # in the keeper's group: given a few seconds, then ended — they are this suite's, and nobody else will ever stop them.
  local waited=0 members
  group_members members
  while [ "${#members[@]}" -gt 0 ] && [ "$waited" -lt 50 ]; do nap 0.2; waited=$((waited + 1)); group_members members; done
  if [ "${#members[@]}" -gt 0 ]; then
    echo "[emulators] the suite left ${#members[@]} process(es) running after firebase-tools exited (${members[*]}) — ending them." >>"$LOG"
    kill_group
  fi
  entry_write exited "" "$code" "$result"
  # Also in the log, which outlives the state dir: whoever was waiting may read it after the stack is released.
  echo "[emulators] result (code $code): $result" >>"$LOG"
  rm -f "$STOP_FILE"
  release_stack
}

PROXY_PID=$$
PROXY_START="$(proc_start $$)"
KEEPER_PID=''
KEEPER_START=''
rm -f "$STOP_FILE" "$ENTRY"
: > "$LOG"
# `set -m` puts the keeper in its OWN process group; the subshell exits at once, so the keeper is reparented out of
# every tree above us. All of its output goes to the log, never to our stdout — a pipe a supervisor may close.
( set -m; keep & ) </dev/null >/dev/null 2>&1

for _ in $(seq 1 100); do [ -f "$ENTRY" ] && break; nap 0.1; done
KEEPER_PID="$(entry_field pid)"
KEEPER_START="$(entry_field procStart)"
if [ -z "$KEEPER_PID" ]; then
  echo "[emulators] the emulator suite did not start (no keeper) — its log: $LOG" >&2
  exit 1
fi

# The suite's output, here where it always appeared (and in the log, which outlives it).
tail -n +1 -F --pid="$KEEPER_PID" "$LOG" 2>/dev/null &
TAIL_PID=$!

if [ "$DIRECT" -eq 0 ]; then SAVING_WHERE='`tools/dev/dev ps` shows it FINISHING'; else SAVING_WHERE="\`tools/dev/dev ps\` shows $STACK_KEY FINISHING; its log: $LOG"; fi

STOPPING=0
STOP_SINCE=0
LOG_AT_STOP=0
request_stop() {
  [ "$STOPPING" -eq 1 ] && return 0
  STOPPING=1
  STOP_SINCE="$(date +%s)"
  LOG_AT_STOP="$(stat -c %s "$LOG" 2>/dev/null || echo 0)"
  : > "$STOP_FILE"
  kill -TERM "$KEEPER_PID" 2>/dev/null || true
  echo "[emulators] stopping — ${STOP_DOING} (firebase-tools takes about half a minute; it is given ${STOP_TIMEOUT}s)…" >&2
  if [ "$PERSIST" -eq 1 ]; then echo "[emulators]   If this returns before \"done\", the save still completes in the background: ${SAVING_WHERE}." >&2; fi
}
trap request_stop TERM INT HUP

# Waiting for the keeper: past its own deadline it ends the suite itself, so this wait is bounded by it (plus the
# few seconds the keeper takes to record that).
while is_proc "$KEEPER_PID" "$KEEPER_START"; do
  nap 0.5
  if [ "$STOPPING" -eq 1 ]; then
    elapsed=$(( $(date +%s) - STOP_SINCE ))
    if [ "$elapsed" -ge $((STOP_TIMEOUT + 30)) ]; then
      echo "[emulators] the keeper (pid $KEEPER_PID) is still ending the suite after ${elapsed}s — not waiting any longer;" >&2
      echo "[emulators]   tools/dev/dev ps shows it, and tools/dev/dev stop --abandon ends it. Its log: $LOG" >&2
      exit 1
    fi
    [ "$elapsed" -gt 0 ] && [ $((elapsed % 5)) -eq 0 ] && [ "${LAST_TICK:-}" != "$elapsed" ] && { LAST_TICK=$elapsed; echo "[emulators]   …${STOP_DOING} (${elapsed}s)" >&2; }
  fi
done

# Let the log stream drain (it ends with the keeper). If a supervisor's stop took it down first (a signal, not its
# own end), show what the suite said since the stop.
for _ in $(seq 1 20); do kill -0 "$TAIL_PID" 2>/dev/null || break; nap 0.1; done
TAIL_STATUS=0
wait "$TAIL_PID" 2>/dev/null || TAIL_STATUS=$?
if [ "$STOPPING" -eq 1 ] && [ "$TAIL_STATUS" -gt 128 ]; then
  tail -c +"$((LOG_AT_STOP + 1))" "$LOG" 2>/dev/null || true
fi

CODE="$(entry_field code)"
RESULT="$(entry_field result)"
if [ "$STOPPING" -eq 1 ]; then
  echo "[emulators] done in $(( $(date +%s) - STOP_SINCE ))s — ${RESULT:-stopped}" >&2
else
  echo "[emulators] the emulator suite ended without a stop being asked for: ${RESULT:-exit ${CODE:-?}}" >&2
fi
exit "${CODE:-1}"
