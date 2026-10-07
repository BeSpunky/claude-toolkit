#!/usr/bin/env bash
# Launch the local Firebase emulator suite for development — the single launch path
# the Nx `firebase:emulators*` targets all funnel through (so the reap → prime → start
# recipe lives in exactly one place instead of being copy-pasted across five targets).
#
# Three steps, in order:
#   1. reap   — clear any stale emulator processes/ports from an ungraceful prior exit
#               (tools/reap-emulators.sh — see its header for the root cause).
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

# Port-offset isolation (PORT_OFFSET, set by the dev engine for a shifted stack): shift the WHOLE
# emulator suite onto a free port block so it COEXISTS with a suite the developer already has up on
# the base ports — instead of reaping it. We generate an offset copy of firebase.json (every
# emulator port +OFFSET, every DECLARED nested port such as firestore.websocketPort, and the
# hub/logging ports firebase-tools otherwise fixes at 4400/4500 and would collide on — all from
# tools/emulator-ports.mjs, the one port table), keep this stack's data in its own dir, and reap
# ONLY these shifted ports. OFFSET 0 (the default) = the base forwarded stack, entirely unchanged.
OFFSET="${PORT_OFFSET:-0}"
CONFIG_ARGS=()
REAP_ARGS=()
if [ "$OFFSET" != "0" ]; then
  echo "[emulators] PORT_OFFSET=$OFFSET — isolated stack (shifted ports + own data dir)" >&2
  OFFSET_CONFIG="$ROOT/.firebase.offset-$OFFSET.json"
  node "$ROOT/tools/emulator-ports.mjs" shift "$ROOT/firebase.json" "$OFFSET" "$OFFSET_CONFIG"
  CONFIG_ARGS=(--config "$OFFSET_CONFIG")
  REAP_ARGS=("$OFFSET_CONFIG")
  DATA_DIR="$ROOT/.emulator-data-$OFFSET"
fi

# EACH STACK ITS OWN TMPDIR — the emulator HUB LOCATOR lives there. firebase-tools finds a running
# suite through `os.tmpdir()/hub-<projectId>.json`, keyed by the project id ALONE — and every stack of
# this repo runs under the same id. Sharing one /tmp, a second suite never registers its own hub
# (firebase-tools only warns "multiple instances"), and on exit its export-on-exit asks the FIRST
# suite's hub to export: the main stack's data lands in the worktree's dir and the worktree's own is
# lost — or, when the first suite already stopped, the export fails and nothing is saved. Both orders
# lose data (reproduced, firebase-tools 15.32.1). A private TMPDIR per stack makes the locator the
# stack's own. The dev engine hands every process its stack's state dir (DEV_STACK_DIR, under the
# self-ignoring .bespunky/run/); run directly (`nx run firebase:emulators`), the suite keys its own
# by offset. The JVM emulators use java.io.tmpdir, which TMPDIR does not move — and need not.
if [ -n "${DEV_STACK_DIR:-}" ]; then
  STACK_DIR="$DEV_STACK_DIR"
else
  STACK_DIR="$ROOT/.bespunky/run/firebase@$OFFSET"
  mkdir -p "$ROOT/.bespunky/run"
  [ -f "$ROOT/.bespunky/run/.gitignore" ] || printf '# Running dev stacks — machine-local, never committed.\n*\n' > "$ROOT/.bespunky/run/.gitignore"
fi
# The invoker's temp dir, before this stack's own replaces it — where the postscript queue lives (say_to_invoker).
INVOKER_TMPDIR="${TMPDIR:-/tmp}"
INVOKER_TMPDIR="${INVOKER_TMPDIR%/}"
mkdir -p "$STACK_DIR/tmp"
export TMPDIR="$STACK_DIR/tmp"

# RUN DIRECTLY, THE STATE DIR HAS NO RUN RECORD — so each script using it CLAIMS it (`claims/<pid>`), and the last one
# out removes it (release_direct_dir) only when no other live script claims it: the next start of this suite may be
# inside it already, waiting for this one's save. Claims and removal are serialised on a lock of `.bespunky/run`
# (which is never removed). Under the dev engine the run record is the claim (release_stack_dir).
with_run_lock() {   # with_run_lock <fn> [args] — runs <fn> holding the lock; without flock(1), does nothing
  command -v flock >/dev/null 2>&1 || return 0
  local fd rc=0
  exec {fd}<"$(dirname "$STACK_DIR")" || return 0
  flock "$fd" && { "$@" || rc=$?; }
  exec {fd}<&-
  return "$rc"
}
claim_direct_dir() {
  mkdir -p "$STACK_DIR/tmp" "$STACK_DIR/claims"
  printf '%s' "$(proc_start $$)" > "$STACK_DIR/claims/$$"
}
# Run directly: remove the state dir once the suite is over and no OTHER live script claims it. Called with the run
# lock held, by whichever of the keeper and this script ends last (each one's call is harmless to the other's).
# The script passes its own PID (its claim is the one being given up); the keeper claims nothing, so a live script
# — its own included, which still reads the keeper's result there — keeps the dir.
release_direct_dir() {   # release_direct_dir [own-pid]
  [ -z "${DEV_STACK_DIR:-}" ] && [ -d "$STACK_DIR" ] || return 0
  if [ -f "${ENTRY:-}" ] && [ "$(entry_field status)" != exited ] && is_proc "$(entry_field pid)" "$(entry_field procStart)"; then return 0; fi
  local c
  for c in "$STACK_DIR"/claims/*; do
    [ -f "$c" ] && [ "${c##*/}" != "${1:-}" ] || continue
    is_proc "${c##*/}" "$(cat "$c" 2>/dev/null)" && return 0
  done
  rm -rf "$STACK_DIR"
}

if [ -z "${DEV_STACK_DIR:-}" ]; then
  with_run_lock claim_direct_dir
  trap 'with_run_lock release_direct_dir $$ || true' EXIT
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
# `tools/dev/dev ps` shows it while it finishes, and the next start of this stack waits for it instead of
# colliding with (or reaping) a suite that is still saving.
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
entry_write() {   # entry_write <status> [doing] [code] [result]
  node -e '
    const fs = require("fs");
    const [file, pid, start, proxy, proxyStart, status, doing, log, code, result] = process.argv.slice(1);
    const e = { id: "emulators", what: "the Firebase emulator suite", pid: Number(pid), procStart: start || null,
      proxyPid: Number(proxy), proxyStart: proxyStart || null, status, log, at: new Date().toISOString() };
    if (doing) e.doing = doing;
    if (code !== "") e.code = Number(code);
    if (result) e.result = result;
    fs.writeFileSync(file + ".tmp", JSON.stringify(e, null, 2) + "\n");
    fs.renameSync(file + ".tmp", file);
  ' "$ENTRY" "$KEEPER_PID" "$KEEPER_START" "$PROXY_PID" "$PROXY_START" "$1" "${2:-}" "$LOG" "${3:-}" "${4:-}"
}
entry_field() {   # entry_field <name> — one field of the entry, as plain text ('' when absent)
  node -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; process.stdout.write(v == null ? "" : String(v)); } catch {}' "$ENTRY" "$1"
}

# A PREVIOUS SUITE OF THIS STACK MAY STILL BE SAVING — its supervisor stopped waiting, the keeper did not. Wait for
# it rather than start over it: the reaper would refuse its live ports, and a second suite would import a
# half-written export. Still RUNNING with its own script alive is not a leftover; it is this stack, twice.
if [ -f "$ENTRY" ]; then
  PREV="$(entry_field pid)"; PREV_START="$(entry_field procStart)"
  if is_proc "$PREV" "$PREV_START"; then
    if [ "$(entry_field status)" = running ] && is_proc "$(entry_field proxyPid)" "$(entry_field proxyStart)"; then
      echo "[emulators] this stack's emulator suite is already running (keeper pid $PREV, log $LOG)." >&2
      echo "[emulators]   Use it, or stop it first: tools/dev/dev ps shows its stack and the stop command." >&2
      exit 1
    fi
    echo "[emulators] the previous suite of this stack is still saving its data (pid $PREV): $(entry_field doing) — waiting for it, so nothing is lost…" >&2
    waited=0
    while is_proc "$PREV" "$PREV_START" && [ "$waited" -lt "$STOP_TIMEOUT" ]; do
      nap 1; waited=$((waited + 1))
      [ $((waited % 10)) -eq 0 ] && echo "[emulators]   …still saving (${waited}s)" >&2
    done
    if is_proc "$PREV" "$PREV_START"; then
      echo "[emulators] the previous suite is STILL saving after ${STOP_TIMEOUT}s (pid $PREV, log $LOG). Not starting over it —" >&2
      echo "[emulators]   let it finish (tools/dev/dev ps), or raise EMULATORS_STOP_TIMEOUT." >&2
      exit 1
    fi
    echo "[emulators] the previous suite finished: $(entry_field result)" >&2
  fi
  rm -f "$ENTRY"
fi
# Whatever a previous suite's release removed while this one waited is this one's again.
if [ -z "${DEV_STACK_DIR:-}" ]; then with_run_lock claim_direct_dir; fi
mkdir -p "$STACK_DIR/tmp" "$DETACHED_DIR"

bash "$ROOT/tools/reap-emulators.sh" "${REAP_ARGS[@]}"
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

# Is any process of the keeper's group (the suite: firebase-tools, its JVMs, whatever they started) still alive?
group_busy() {
  local f stat pid
  for f in /proc/[0-9]*/stat; do
    pid="${f#/proc/}"; pid="${pid%/stat}"
    [ "$pid" = "$BASHPID" ] && continue
    read -r stat < "$f" 2>/dev/null || continue
    stat="${stat##*) }"
    set -- $stat
    [ "${3:-}" = "$KEEPER_PID" ] && return 0
  done
  return 1
}

# THE STACK'S STATE DIR GOES WITH THE LAST ONE OUT. On a clean stop the dev engine removes it after this suite has
# finished; when the engine was killed first (Nx force-kills a stopping `nx serve` after a few seconds — a Ctrl+C
# while the suite exports), the keeper is the last one out. It prunes through the engine's own rule (tools/dev
# readStacks): only a stack whose serve and processes are all gone, so never a live one — and a stack that has
# since restarted on this key has a live record of its own. Run directly (no engine), see release_direct_dir.
release_stack_dir() {
  [ -n "${DEV_STACK_DIR:-}" ] && [ -f "$ROOT/tools/dev/lib/stacks.mjs" ] || return 0
  node --input-type=module -e '
    const [lib, tree] = process.argv.slice(1);
    const { readStacks } = await import(lib);
    readStacks([tree]);
  ' "file://$ROOT/tools/dev/lib/stacks.mjs" "$(dirname "$(dirname "$(dirname "$STACK_DIR")")")" >/dev/null 2>&1 || true
}

# The keeper (see SUPERVISION). Runs detached; the only process that ever signals firebase-tools.
keep() {
  KEEPER_PID=$BASHPID
  KEEPER_START="$(proc_start "$BASHPID")"
  local requested=0 signalled=0 stop_at=0 code=0 fb result
  trap 'requested=1' TERM INT HUP
  firebase "${FIREBASE_ARGS[@]}" </dev/null >>"$LOG" 2>&1 &
  fb=$!
  entry_write running
  while kill -0 "$fb" 2>/dev/null; do
    if [ "$signalled" -eq 0 ] && { [ "$requested" -eq 1 ] || [ -e "$STOP_FILE" ] || ! is_proc "$PROXY_PID" "$PROXY_START"; }; then
      signalled=1
      stop_at="$(date +%s)"
      entry_write stopping "$STOP_DOING"
      kill -TERM "$fb" 2>/dev/null || true
    fi
    nap 0.2
  done
  wait "$fb" || code=$?
  if [ "$signalled" -eq 1 ] && [ "$PERSIST" -eq 1 ]; then
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
  # The suite is over when EVERY process of it is: firebase-tools does not always wait for what it started, and a
  # straggler still writes into this stack's TMPDIR as it exits. They share the keeper's process group (bounded).
  local waited=0
  while group_busy && [ "$waited" -lt 50 ]; do nap 0.2; waited=$((waited + 1)); done
  entry_write exited "" "$code" "$result"
  rm -f "$STOP_FILE"
  release_stack_dir
  with_run_lock release_direct_dir || true
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

# ONE LINE, WHERE THE PERSON IS LOOKING, BEFORE ANYONE STOPS LISTENING. A Ctrl+C on `nx serve` makes Nx mute its own
# output and return ~5 s later — long before an export ends — so everything this script prints from here on lands
# in a task log nobody reads, and the stop looks like it skipped the save. Nx names the process the person invoked
# to every task (NX_INVOCATION_ROOT_PID): its stderr is their terminal (or an agent's output). Appended, never
# truncated (it may be a file). Without an invoker, our own stderr is where they are looking.
#
# Into a capture file the invoker did NOT open for appending (`nx serve > log 2>&1`), a line appended now is written
# over by Nx's own later output (its summary): Nx writes at its own offset. There it is queued instead, and one
# detached waiter appends the queue after the invoker exits — the same postscript, same queue, as the Nx executors'
# messages (@bespunky/nx-tools executors/_utils/invoker.ts), so they come out together and in order.
invoker_eats() {   # invoker_eats <pid> — its stderr is a regular file it did not open O_APPEND
  local flags
  [ -f "/proc/$1/fd/2" ] || return 1
  flags="$(sed -n 's/^flags:[[:space:]]*//p' "/proc/$1/fdinfo/2" 2>/dev/null)"
  [ -n "$flags" ] && (( (8#$flags & 8#2000) == 0 ))
}
postscript_wait() {   # postscript_wait <pid> <start> <queue> — stdout is the invoker's stderr
  while [ -n "$2" ] && [ "$(proc_start "$1")" = "$2" ] && [ "$(sed -n 's/^State:[[:space:]]*\(.\).*/\1/p' "/proc/$1/status" 2>/dev/null)" != Z ]; do nap 0.02; done
  cat "$3" 2>/dev/null || true
  rm -f "$3" "$3.lock"
}
say_to_invoker() {
  local p="${NX_INVOCATION_ROOT_PID:-}" start queue
  if [ -n "$p" ] && [ "$p" != "$$" ] && [ -w "/proc/$p/fd/2" ]; then
    if invoker_eats "$p"; then
      start="$(proc_start "$p")"
      queue="$INVOKER_TMPDIR/bespunky-nx-postscript-$p-$start.txt"
      if printf '%s\n' "$1" >> "$queue" 2>/dev/null; then
        if ( set -o noclobber; : > "$queue.lock" ) 2>/dev/null; then
          ( set -m; postscript_wait "$p" "$start" "$queue" & ) </dev/null >> "/proc/$p/fd/2" 2>/dev/null
        fi
        return 0
      fi
    elif { printf '%s\n' "$1" >> "/proc/$p/fd/2"; } 2>/dev/null; then
      return 0
    fi
  fi
  printf '%s\n' "$1" >&2
}
if [ -n "${DEV_STACK_DIR:-}" ]; then SAVING_WHERE='`tools/dev/dev ps` shows it FINISHING'; else SAVING_WHERE="the next start of this suite waits for it; its log: $LOG"; fi

STOPPING=0
STOP_SINCE=0
LOG_AT_STOP=0
request_stop() {
  [ "$STOPPING" -eq 1 ] && return 0
  STOPPING=1
  STOP_SINCE="$(date +%s)"
  LOG_AT_STOP="$(stat -c %s "$LOG" 2>/dev/null || echo 0)"
  : > "$STOP_FILE"
  [ "$PERSIST" -eq 1 ] && say_to_invoker "[emulators] saving emulator data in the background — ${SAVING_WHERE}"
  echo "[emulators] stopping — ${STOP_DOING} (firebase-tools takes about half a minute)…" >&2
  echo "[emulators]   If this returns before \"done\", the save still completes in the background: tools/dev/dev ps shows it, and the next start of this stack waits for it." >&2
}
trap request_stop TERM INT HUP

while is_proc "$KEEPER_PID" "$KEEPER_START"; do
  nap 0.5
  if [ "$STOPPING" -eq 1 ]; then
    elapsed=$(( $(date +%s) - STOP_SINCE ))
    if [ "$elapsed" -ge "$STOP_TIMEOUT" ]; then
      echo "[emulators] still ${STOP_DOING} after ${STOP_TIMEOUT}s — not waiting any longer. Nothing was killed: the suite" >&2
      echo "[emulators]   (keeper pid $KEEPER_PID) finishes on its own; follow it in $LOG or with tools/dev/dev ps." >&2
      exit 0
    fi
    [ "$elapsed" -gt 0 ] && [ $((elapsed % 5)) -eq 0 ] && [ "${LAST_TICK:-}" != "$elapsed" ] && { LAST_TICK=$elapsed; echo "[emulators]   …${STOP_DOING} (${elapsed}s)" >&2; }
  fi
done

# Let the log stream drain; if a supervisor's stop took it down, show what the suite said since the stop.
if kill -0 "$TAIL_PID" 2>/dev/null; then
  for _ in $(seq 1 20); do kill -0 "$TAIL_PID" 2>/dev/null || break; nap 0.1; done
elif [ "$STOPPING" -eq 1 ]; then
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
