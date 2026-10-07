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
#   bash tools/emulators.sh                  # full suite, cached (import + export)
#   bash tools/emulators.sh --only auth,ui   # focused, import-only (no export)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DATA_DIR="$ROOT/.emulator-data"

# Port-offset isolation (PORT_OFFSET, set by `<app>:serve --portOffset`): shift the WHOLE
# emulator suite onto a free port block so it COEXISTS with a suite the developer already has up on
# the base ports — instead of reaping it. We generate an offset copy of firebase.json (every
# emulator port +OFFSET, INCLUDING the hub/logging ports firebase-tools otherwise fixes at
# 4400/4500 and would collide on), keep this stack's data in its own dir, and reap ONLY these
# shifted ports (never the global JVM sweep, which would kill the developer's suite). OFFSET 0 (the
# default) = the base forwarded stack, entirely unchanged.
OFFSET="${PORT_OFFSET:-0}"
CONFIG_ARGS=()
REAP_ARGS=()
if [ "$OFFSET" != "0" ]; then
  echo "[emulators] PORT_OFFSET=$OFFSET — isolated stack (shifted ports + own data dir)" >&2
  OFFSET_CONFIG="$ROOT/.firebase.offset-$OFFSET.json"
  node -e '
    const fs = require("fs"), off = Number(process.argv[2]);
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const e = cfg.emulators || (cfg.emulators = {});
    for (const k of Object.keys(e)) if (e[k] && typeof e[k].port === "number") e[k].port += off;
    // hub/logging default to 4400/4500 when unset — pin them shifted so two suites never collide.
    e.hub = Object.assign({ host: "0.0.0.0" }, e.hub, { port: ((e.hub && e.hub.port) || 4400) + off });
    e.logging = Object.assign({ host: "0.0.0.0" }, e.logging, { port: ((e.logging && e.logging.port) || 4500) + off });
    fs.writeFileSync(process.argv[3], JSON.stringify(cfg, null, 2));
  ' "$ROOT/firebase.json" "$OFFSET" "$OFFSET_CONFIG"
  CONFIG_ARGS=(--config "$OFFSET_CONFIG")
  REAP_ARGS=("$OFFSET_CONFIG" isolated)
  DATA_DIR="$ROOT/.emulator-data-$OFFSET"
fi

# The emulator suite MUST run under the SAME projectId the app's client uses. The moment any
# service is switched to real (e.g. real Auth), that real `projectId` is used for ALL services
# (singleProjectMode) — so a still-emulated Firestore/Storage launched under a DIFFERENT project
# id hits a mismatch and silently falls back to offline. The projectId has ONE source of truth —
# the app's environment.ts — so we DERIVE it here rather than hardcode a copy that drifts.
# `demo-` is Firebase's "offline only, no cloud project needed" convention and the safe fallback
# when no env file is found. One suite = one project (singleProjectMode), so it follows the
# PRIMARY app this workspace was wired with; set FIREBASE_EMULATOR_PROJECT for anything unusual.
# (Seeds are always built under demo-{{workspaceName}} — see tools/seed/build-seeds.sh — and import
# fine under a derived real id because singleProjectMode collapses project ids.)
#   Precedence:  FIREBASE_EMULATOR_PROJECT (override)  >  environment.ts  >  demo-{{workspaceName}}
ENV_FILE="$ROOT/{{appEnvPath}}"
derive_project() {
  [[ -f "$ENV_FILE" ]] || return 1
  local id
  # Anchor to the field (line, after indent, begins with `projectId:`) so a comment that merely
  # mentions `projectId:` — comments start with `//` — can't shadow the real value.
  id="$(grep -oE "^[[:space:]]*projectId:[[:space:]]*[\"'][^\"']+" "$ENV_FILE" | head -1 | sed -E "s/.*[\"']//")"
  [[ -n "$id" ]] && printf '%s' "$id"
}
PROJECT="${FIREBASE_EMULATOR_PROJECT:-$(derive_project || echo demo-{{workspaceName}})}"
echo "[emulators] project: $PROJECT" >&2

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

# ── FUNCTIONS SECRETS: INERT BY DEFAULT — NOTHING RUN LOCALLY CAN REACH PRODUCTION ─────────────────
# The Functions emulator reads `.secret.local` from the loaded bundle ({{functionsDist}}) — and for every
# declared secret that file does not give a NON-EMPTY value, it fetches the REAL one from Google Secret
# Manager whenever the suite runs under a real projectId (firebase-tools' functionsEmulator
# `resolveSecretEnvs`). So "no secrets file" is not "no secrets": it is production's secrets. Two layers
# close that, and neither depends on the app's code remembering to check FUNCTIONS_EMULATOR:
#
#   1. PLACEHOLDERS. This script WRITES the bundle's `.secret.local` itself, at every launch: one line per
#      declared secret, an inert `EMULATOR_INERT_<KEY>` value by default. Declared = the keys named in
#      {{functionsRoot}}/.secret.local.example (the committed declaration) ∪ the keys of the production
#      file ∪ the sandbox file's keys ∪ every literal `defineSecret('KEY')` in the built bundle (so a
#      secret someone forgot to document is still covered). Only key NAMES are ever read from the
#      production file — never a value.
#   2. A SINK. Secret Manager is pointed at an address that cannot resolve (`.invalid`, RFC 2606) for the
#      emulator process, so anything the placeholders miss — a secret named dynamically, or a functions
#      rebuild mid-session (`deleteOutputPath` wipes the bundle's file until the next launch) — fails
#      LOUDLY in the emulator log instead of quietly acting as production. CLOUD_SECRET_MANAGER_URL is
#      firebase-tools' own origin override (lib/api.js `secretManagerOrigin`).
#
# REAL VALUES ARE AN OPT-IN, AND ONLY EVER SANDBOX ONES. A developer who needs to exercise a real
# integration (a test bot, a sandbox payment account) puts THOSE credentials in
# {{functionsRoot}}/.secret.sandbox.local (gitignored) — creating that file is the opt-in, and every launch
# says which keys are live. The production `.secret.local` is push-secrets' source and is NEVER fed to an
# emulator; a sandbox value identical to its production counterpart is refused. `EMULATOR_SECRETS=inert`
# disarms a sandbox file for one run; `EMULATOR_SECRETS=sandbox` insists on it (and fails without one).
#
# NEVER BORROWED ACROSS TREES. A worktree gets its own sandbox file or none — an unattended agent's
# worktree must never wake up armed because the main tree is.
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
  node -e '
    const fs = require("fs"), path = require("path");
    const [mode, dist, src, show] = process.argv.slice(1);
    const say = (line) => { if (show === "1") console.error(`[emulators] ${line}`); };
    const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
    const entries = (file) => {
      const out = new Map();
      let text = "";
      try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        const m = LINE.exec(line);
        if (m) out.set(m[1], m[2].trim());
      }
      return out;
    };
    const unquote = (v) => v.replace(/^(["\x27`])(.*)\1$/s, "$2");
    const filled = (v) => v !== undefined && unquote(v) !== "" && !unquote(v).startsWith("PASTE_");

    const example = entries(path.join(src, ".secret.local.example"));
    const prod = entries(path.join(src, ".secret.local"));            // key NAMES; values only for the clash check
    const sandboxFile = entries(path.join(src, ".secret.sandbox.local"));   // its keys are declarations either way
    const sandbox = mode === "sandbox" ? sandboxFile : new Map();

    // Every literal defineSecret("KEY") the bundle makes — esbuild may write it `(0, x.defineSecret)("KEY")`.
    const bundled = new Set();
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(c|m)?js$/.test(e.name)) {
          for (const m of fs.readFileSync(p, "utf8").matchAll(/defineSecret\)?\s*\(\s*(["\x27`])([A-Za-z_][A-Za-z0-9_]*)\1/g)) bundled.add(m[2]);
        }
      }
    };
    try { walk(dist); } catch {}

    const declared = [...new Set([...example.keys(), ...prod.keys(), ...sandboxFile.keys(), ...bundled])].sort();
    const live = [], inert = [], refused = [];
    const lines = [`# Written by tools/emulators.sh at launch — mode: ${mode}. Regenerated every run; never edit.`];
    for (const key of declared) {
      const value = sandbox.get(key);
      const isProd = filled(value) && filled(prod.get(key)) && unquote(value) === unquote(prod.get(key));
      if (filled(value) && !isProd) { live.push(key); lines.push(`${key}=${value}`); continue; }
      (isProd ? refused : inert).push(key);
      lines.push(`${key}=EMULATOR_INERT_${key}`);
    }
    fs.writeFileSync(path.join(dist, ".secret.local"), lines.join("\n") + "\n", { mode: 0o600 });

    const list = (keys) => keys.join(", ");
    if (mode === "inert") {
      say(declared.length
        ? `secrets: INERT — ${declared.length} declared (${list(declared)}) get placeholder values; no real credential is loaded.`
        : "secrets: INERT — no declared secrets (none in .secret.local.example or the bundle).");
      say("  To exercise a real integration, put SANDBOX credentials in {{functionsRoot}}/.secret.sandbox.local and restart.");
    } else {
      say(`secrets: SANDBOX — LIVE from .secret.sandbox.local: ${live.length ? list(live) : "(none filled)"}. Calls using them WILL reach real services.`);
      if (inert.length) say(`  inert (not in the sandbox file): ${list(inert)}`);
      if (refused.length) say(`  REFUSED — identical to the production value in .secret.local: ${list(refused)}. Load a sandbox credential instead.`);
      say("  Disarm: EMULATOR_SECRETS=inert for one run, or delete the sandbox file.");
    }
    const undocumented = [...bundled].filter((k) => !example.has(k)).sort();
    if (undocumented.length) say(`  The bundle declares ${list(undocumented)}, missing from {{functionsRoot}}/.secret.local.example — document them there.`);
    say("  Secret Manager is unreachable from the emulator: a secret it cannot find locally fails loudly, never fetched from production.");

    // Firebase reads params from .env, then (emulator only) .env.local — firebase.json functions.configDir
    // points both at the source dir, so .env.local is where local runs aim params at TEST targets.
    const env = entries(path.join(src, ".env")), envLocal = entries(path.join(src, ".env.local"));
    if (envLocal.size) say(`params: .env.local overrides for the emulator: ${list([...envLocal.keys()].sort())}`);
    else if (env.size) say(`params: .env as-is (production values) — aim any at a test target in {{functionsRoot}}/.env.local (emulator-only).`);
  ' "$SECRETS_MODE" "$FUNCTIONS_DIST" "$FUNCTIONS_SRC" "$FUNCTIONS_IN_RUN"
fi

# Only import when the working dir is actually primed — `--import` on a missing dir is
# a hard error. On a brand-new clone with no seeds built yet, we start fresh and (when
# persisting) the clean exit writes the first export, so the next serve has data to import.
IMPORT_ARGS=()
[ -f "$DATA_DIR/firebase-export-metadata.json" ] && IMPORT_ARGS=(--import "$DATA_DIR")

EXPORT_ARGS=()
[ "$PERSIST" -eq 1 ] && EXPORT_ARGS=(--export-on-exit "$DATA_DIR")

exec firebase "${CONFIG_ARGS[@]}" emulators:start \
  --project="$PROJECT" \
  "${ONLY_ARGS[@]}" \
  "${IMPORT_ARGS[@]}" \
  "${EXPORT_ARGS[@]}"
