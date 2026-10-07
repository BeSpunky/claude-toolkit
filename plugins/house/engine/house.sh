#!/usr/bin/env bash
# The house engine: create a BeSpunky-standard project, or bring an existing one up to the current house standard.
#
# Three commands, each named for what it does (docs/features/2026-10-03-house-plugin-rename/DECISION.md):
#   new       : SCAFFOLD a new project — an upgrade with an ensure set against an empty directory. The set is a
#               PRESET (default `agent`: the house DX on the Nx floor, wrapper-hosted, no package.json, no
#               framework; `--preset=angular` is the house web app) and/or `--add-layer=<csv>`. Presets are data
#               beside the layer registry (nx-tools/src/layers/presets.ts, projected into layers.sh).
#   upgrade   : bring an EXISTING workspace up to the current house standard — detect which layers it has,
#               run the versioned MIGRATIONS between where it is and where this checkout is, then re-apply
#               the generators that own their output outright. Not convergence: the generators no longer
#               recognise every shape the toolkit ever produced. Each one-way change ships instead as a
#               migration keyed to the version that introduced it, collected and ordered by `nx migrate`.
#               It adds NO layer: --add-layer, --preset and --firebase are refused there.
#   add-layer : an upgrade that also brings the named layers into being (the internal "ensure set").
# Internally there are two run shapes, named after the commands: MODE=new and MODE=upgrade (upgrade and add-layer
# alike) — the same words the planner (`cli.js plan --mode=`) and layers.sh use.
# Firebase opt-in: --firebase is the `firebase` layer in the ensure set (two spellings of one intent). The layer brings the emulator
#                  suite, Cloud Functions as an Nx app (<appsDir>/functions), the workspace-level `firebase`
#                  project and the seed/cache/reset tooling; its devcontainer FRAGMENT (layers/firebase.ts)
#                  brings the Firebase/Google Cloud CLIs, the JDK and the forwarded emulator ports. It requires
#                  the `node` layer (Cloud Functions are a Node app). NEVER enabled by default.
# Voice opt-in   : when --voice is passed, the devcontainer bridges the HOST's audio server — WSLg, or a
#                  native PulseAudio/PipeWire socket — (a host probe on every open + one bind mount +
#                  remoteEnv PULSE_SERVER), the espeak-ng TTS floor + pulseaudio-utils join the
#                  image's cached package layer, and post-create.sh self-adapts to a socket being
#                  present to pre-install the bespunky-voice plugin — so /speak works the moment the container opens. Opt-in
#                  because it records the project's INTENT ("this project wants audio"); where the
#                  socket is stays a per-machine fact, resolved on the host at open time.
#                  NEVER enabled by default.
# GitHub repo    : ONLY with --github, the scaffold creates a PRIVATE GitHub repo via `gh` and pushes to
#                  it — publishing to an outside service is never a default (it was, and a scaffold could
#                  create a repository nobody asked for). This runs host-side AFTER the Docker scaffold
#                  (gh auth lives on the host, not in the bare base image). Skipped gracefully (local repo
#                  only) when gh is missing/unauthenticated. Upgrade mode never touches the remote.
#                  Why offer it at all: App Hosting's recommended mode rolls out every push to a linked
#                  repo's live branch (linked at `firebase apphosting:backends:create`), so the repo must
#                  exist; we generate NO deploy workflow. (Local-source `firebase deploy` needs no remote.)
#                  Non-Firebase projects still benefit from having a remote.
#
# Usage:
#   house.sh new       [--preset=<id>] [--add-layer=<layers>] [--layout=<id>] [--linking=<id>] [--firebase] [--staging] [--voice] [--github] [--docker] [--local] <project-name|path> [app-name]
#   house.sh upgrade   [--staging] [--voice] [--no-backup] [--yes] [--docker] [--local] <project-path|project-name> [app-name]
#   house.sh add-layer [--preset=<id>] [--firebase] [--staging] [--voice] [--no-backup] [--yes] [--docker] [--local] <layers> <project-path|project-name> [app-name]
#   house.sh help
#
#   --local installs @bespunky/nx-tools from the WORKING TREE (npm pack) instead of the registry — for
#           developing the toolkit itself, where the version under test is not published yet.
#
#   --staging (new, upgrade, add-layer) additionally scaffolds the staging environment bundle; requires the firebase layer. An upgrade
#             refuses it when the project's DECLARED branch model has no pre-production stage to deploy it from.
#   <layers> / --add-layer=<csv>  bring layers into being — which ones each command can create comes from the layer
#                  registry (engine/layers.sh). Everything else is DETECTED, never ensured. The Nx floor is always
#                  ensured; a scaffold also ensures whatever the requested layers require.
#   --preset=<id>  a named ensure set (unions with the layers). `new` with neither gets the default preset.
#   --layout=<id>  scaffold only: WHERE projects live — a named layout (layers.sh HOUSE_LAYOUTS, from LAYOUTS in
#                  workspace-layout.ts), declared into nx.json `workspaceLayout`. Omitted: today's apps/ + packages/.
#   --linking=<id> scaffold only: HOW projects reach each other — `paths` (the default: project.json + tsconfig
#                  paths) or `workspaces` (a TS-solution workspace; needs the node layer). An upgrade refuses both:
#                  an existing workspace's layout and linking are DETECTED, never chosen.
#   [app-name]     scaffold: the first app's name (default: the project name) — only when an ensured layer's
#                  stack creates apps (the angular preset); refused otherwise. upgrade: the app to refresh.
#
# Upgrade restore point: preflight refuses a dirty tree, so an upgrade only ever starts from a CLEAN one — and then
# HEAD already is the pre-upgrade state, so a regenerated file (e.g. firebase.config.ts) is always recoverable:
# review with `git diff <sha>`, restore with `git checkout <sha> -- <path>`. A directory that is not a git
# repository has no restore point, so upgrade ABORTS there rather than change files unprotected — unless
# --no-backup says that is understood.
#
# Upgrade CONSENT GATE (--yes): an upgrade rewrites generated files and takes minutes — it must never
# happen because something *inferred* that it should. The SessionStart hook that
# detects a stale project deliberately only RELAYS that fact; this gate is what makes that boundary
# structural rather than a matter of an agent's good behavior:
#   - on a TTY  : a human is present → prompt, and proceed only on an explicit "yes".
#   - no TTY    : nobody can be asked (an agent's shell, a script) → REFUSE unless --yes is passed, which
#                 ASSERTS a human has explicitly agreed in this session. An agent may pass it only after
#                 the user actually said yes — never to satisfy the gate.
#   - CI=true   : there is no human to consent, and --yes cannot conjure one → REFUSE unconditionally.
# The gate governs the ACT of upgrading, so --print-inner (a dry render that runs nothing) is exempt from all
# three arms — it is what the render test exercises under CI.
# Scaffold mode has no gate: creating a NEW project is the thing the user just asked for, and it can't
# clobber anything that already exists.
#
# The COMMAND comes first; its flags follow it, in any order, and precede the positionals.
# PROJECTS_DIR env overrides target root in full mode (default: ~/projects).
#
# WHERE IT RUNS. Docker was never the requirement — a modern NODE is (Docker only ever existed here to
# supply one when the host's Node was too old). So this runs on the LOCAL Node when it's new enough —
# Node 22.18+, the bar for compile-generators.mts's unflagged type-stripping — with no daemon, no image
# pull and no mounts; that is exactly the case INSIDE a devcontainer, so `upgrade` works there directly.
# Otherwise it falls back to the typescript-node base image via `docker run`, exactly as before. Both
# paths run the SAME rendered command sequence, so they cannot drift (mirrors tools/publish-nx-tools).
# Force the image with --docker. Never nvm.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# THE LAYER REGISTRY, as this shell sees it. engine/layers.sh is GENERATED from nx-tools/src/layers/*.ts (the
# single source of truth) and checked for drift by tools/test-layers/run.mjs. It is a shell projection rather
# than a node call because this outer shell validates the layers BEFORE anything is installed — and on the
# Docker path the host may have no usable Node at all. It defines data and functions; sourcing runs nothing.
# Nothing in this script lists layers by hand: ids, ensurability, hints and the --help text all come from it.
# shellcheck source=layers.sh
. "$ENGINE_DIR/layers.sh"
# The house MOUNT POINTS (node_modules, .nx, every workspace volume the project's devcontainer declares) and which
# of them the current user cannot write. Shared with the SessionStart hook so the two derive them identically;
# rendered into the program below with `declare -f`, because the program may run inside the fallback container.
# shellcheck source=house-mounts.sh
. "$ENGINE_DIR/house-mounts.sh"
HOUSE_MOUNTS_FNS="$(declare -f house_mount_points house_unwritable_mounts house_post_create)"
# The project's DECLARED BRANCH MODEL (.bespunky/branches.json → its `projection`): which lines are protected, and
# whether a model is declared at all. Rendered by value for the same reason.
# shellcheck source=house-branches.sh
. "$ENGINE_DIR/house-branches.sh"
HOUSE_BRANCHES_FNS="$(house_branches_fns)"

# The command line is the first place anyone looks, and until now it was the one place that said nothing:
# `--help` was answered with "unknown flag", and a bare invocation printed a raw bash parameter-expansion
# error whose usage string named only `--firebase`. Every flag below is real and several change what the
# run WRITES, so they belong here rather than only in a header comment nobody runs.
usage() {
  cat <<'USAGE'
house.sh — create a BeSpunky-standard project, or bring an existing one up to the house standard.

  house.sh new       [flags] <project-name|path> [app-name]           # CREATE a new project
  house.sh upgrade   [flags] <project-path|name> [app-name]           # UPGRADE an existing one (adds no layer)
  house.sh add-layer [flags] <layers> <project-path|name> [app-name]  # UPGRADE it and add <layers>
  house.sh help                                                       # this message

The COMMAND comes first; its flags follow it and come BEFORE the positionals. A project is a stack of
LAYERS. `new` creates the ones it is asked for (a preset and/or --add-layer) — by default only the house
DX on the Nx floor. `upgrade` runs the versioned house migrations, then re-applies the generators that
own their output; it brings no layer into being. `add-layer` is an upgrade that also creates <layers>.

  <layers>, --add-layer=<csv>
                    Layers to BRING INTO BEING, comma-separated (everything else is detected, never
                    ensured): the first positional of `add-layer`, or `new`'s --add-layer. `new` also
                    creates whatever they require. Addable:
USAGE
  # Rendered from the registry projection, so the list a user reads is the list the script accepts.
  printf '                      add-layer: %s\n' "$(printf '%s' "$HOUSE_LAYERS_ENSURABLE_UPGRADE" | sed 's/,/, /g')"
  printf '                      new      : %s\n' "$(printf '%s' "$HOUSE_LAYERS_ENSURABLE_NEW" | sed 's/,/, /g')"
  printf '                    The %s floor is ALWAYS ensured: a repo without Nx gets it initialised in place\n' "$HOUSE_LAYER_FLOOR"
  cat <<'USAGE'
                    (through the Nx wrapper, ./nx, when the repo has no package.json — it does not
                    become a Node project). `house.sh add-layer agent <path>` on a bare repo is the
                    usual retrofit: the stack-agnostic DX layer (devcontainer, Claude settings,
                    window identity).
  --preset=<id>     new, add-layer: a named set of layers (unions with the layers):
USAGE
  for _p in $(printf '%s' "$HOUSE_PRESETS" | tr ',' ' '); do
    _d=""; [ "$_p" = "$HOUSE_PRESET_DEFAULT" ] && _d=" (new's default)"
    printf '                      %-8s %s%s\n' "$_p" "$(house_preset_layers "$_p" | sed 's/,/, /g')" "$_d"
  done
  cat <<'USAGE'
                    e.g. house.sh new --preset=angular [--firebase] shop [app] — the house web app.
USAGE
  printf '  --layout=<id>     new only: where projects live, declared in nx.json workspaceLayout:\n'
  for _p in $(printf '%s' "$HOUSE_LAYOUTS" | tr ',' ' '); do
    printf '                      %-10s %s\n' "$_p" "$(house_layout_title "$_p")"
  done
  printf '                    Omitted: apps under %s/, libraries under packages/ (the house default).\n' "$HOUSE_LAYOUT_DEFAULT_APPS_DIR"
  printf '  --linking=<id>    new only: how projects reach each other:\n'
  for _p in $(printf '%s' "$HOUSE_LINKINGS" | tr ',' ' '); do
    _d=""; [ "$_p" = "$HOUSE_LINKING_DEFAULT" ] && _d=" (default)"
    printf '                      %-10s %s%s\n' "$_p" "$(house_linking_title "$_p")" "$_d"
  done
  cat <<'USAGE'
                    upgrade and add-layer refuse both: an existing workspace's layout and linking
                    are DETECTED.
  --firebase        new, add-layer: include the Firebase layer (emulator suite, Cloud Functions app,
                    devcontainer wiring); the same as adding `firebase` to the layers.
  --staging         Also scaffold the staging environment bundle. Requires the firebase layer. An
                    upgrade refuses it when the declared branch model has no pre-production stage to
                    deploy it from.
  --voice           Bridge the host's audio (WSLg or native PulseAudio/PipeWire) into the devcontainer
                    and provision bespunky-voice.
  --local           Install @bespunky/nx-tools from the WORKING TREE (npm pack) instead of the registry.
                    For developing the toolkit itself; leaves the project holding an unpublished build.
  --yes, -y         upgrade, add-layer: assert that a human explicitly agreed to this upgrade, in this
                    conversation. The upgrade refuses to run unattended without it. Never pass it to
                    satisfy the gate.
  --no-backup       upgrade, add-layer: upgrade a directory that is NOT a git repository, with no
                    restore point at all. Migrations are ONE-WAY; there is no undo without one. (In a
                    git repository the restore point is the clean HEAD preflight requires.)
  --github          new only: also create a PRIVATE GitHub repo (gh) and push the scaffold to it. Off by default.
  --docker          Force the container even when the local Node would do.
  --print-inner     Render the command sequence this run would execute, print it, and exit without
                    running anything. For debugging the engine itself.
  --help, -h        This message (also: house.sh help).

Environment: PROJECTS_DIR (default ~/projects) is where `new` creates the project.
             NX_CHANNEL=next scaffolds on the Nx beta line.
USAGE
}

# --- THE COMMAND: the first token, always ---------------------------------------------------------------------
# Each command's name says what it does — the reason it replaced `--sync` / `--ensure`, which made one script do
# three jobs behind flags (DECISION.md). The internal run shape is MODE: `new`, or `upgrade` — `upgrade` and
# `add-layer` are the same upgrade run, the latter with a non-empty ensure set. An old invocation (`--sync`, a bare
# path) is simply not a command, and the error says which ones are.
CMD="${1:-}"
case "$CMD" in
  new)            MODE="new"; shift;;
  upgrade|add-layer) MODE="upgrade"; shift;;
  help|--help|-h) usage; exit 0;;
  '')             usage >&2
                  echo >&2
                  echo "ERROR: no command given. house.sh takes a command first: new | upgrade | add-layer | help." >&2
                  exit 1;;
  *)              echo "ERROR: unknown command '$CMD'. house.sh takes a command first:" >&2
                  echo "         house.sh new | upgrade | add-layer | help" >&2
                  echo "       Run 'house.sh help' for the full usage." >&2
                  exit 1;;
esac
# The run, as a noun the messages can use.
A_RUN="an upgrade"; [ "$MODE" = "new" ] && A_RUN="a scaffold"

FIREBASE=0
VOICE=0    # --voice: bridge the host's audio (WSLg or PulseAudio/PipeWire) into the devcontainer + provision bespunky-voice (opt-in).
STAGING=0  # --staging: also scaffold a first-class staging environment (requires the firebase layer).
GITHUB=0   # `new` creates a private GitHub repo only when asked: --github.
BACKUP=1   # an upgrade refuses a non-git directory (no restore point); --no-backup accepts that.
CONSENT=0  # --yes: asserts a human explicitly agreed to this upgrade (see the consent gate above).
FORCE_DOCKER=0  # --docker: use the base image even when the local Node would do (escape hatch).
ENSURE_ARG=""   # the layers to BRING INTO BEING (add-layer's <layers>, new's --add-layer). Empty = detect only.
PRESET_ARG=""   # --preset=<id>: a named ensure set (src/layers/presets.ts); unions with the layers.
LAYOUT_ARG=""   # --layout=<id>: new only — where projects live (LAYOUTS, projected into layers.sh).
LINKING_ARG=""  # --linking=<id>: new only — how projects reach each other (paths | workspaces).
LOCAL_TOOLS=0   # --local: install @bespunky/nx-tools from the WORKING TREE instead of npm (toolkit dev).
PRINT_INNER=0   # --print-inner: render the command sequence to stdout and exit, running nothing.
LAYER_FLAGS=""  # the layer-bringing flags given (--add-layer, --preset, --firebase) — `upgrade` refuses each.
while [ "${1:-}" != "" ]; do
  case "$1" in
    --firebase)   FIREBASE=1;    LAYER_FLAGS="$LAYER_FLAGS --firebase"; shift;;
    --voice)      VOICE=1;       shift;;
    --staging)    STAGING=1;     shift;;
    --github)     GITHUB=1;      shift;;
    --no-backup)  BACKUP=0;      shift;;
    --yes|-y)     CONSENT=1;     shift;;
    --docker)     FORCE_DOCKER=1; shift;;
    --local)      LOCAL_TOOLS=1;  shift;;
    --print-inner) PRINT_INNER=1; shift;;
    --add-layer=*) ENSURE_ARG="${1#--add-layer=}"; LAYER_FLAGS="$LAYER_FLAGS --add-layer"; shift;;
    --preset=*)   PRESET_ARG="${1#--preset=}"; LAYER_FLAGS="$LAYER_FLAGS --preset"; shift;;
    --layout=*)   LAYOUT_ARG="${1#--layout=}"; shift;;
    --linking=*)  LINKING_ARG="${1#--linking=}"; shift;;
    # Same guard as --preset/--add-layer below: a flag-shaped value is a mistyped command line, not a value.
    --layout|--linking)
                  case "${2:-}" in
                    ''|-*) echo "ERROR: $1 needs a value, got '${2:-}'. Did you mean $1=<id>?" >&2; exit 1;;
                  esac
                  if [ "$1" = "--layout" ]; then LAYOUT_ARG="$2"; else LINKING_ARG="$2"; fi
                  shift 2;;
    --preset)     case "${2:-}" in
                    ''|-*) echo "ERROR: --preset needs a preset name, got '${2:-}'. Known presets: $HOUSE_PRESETS" >&2
                           exit 1;;
                  esac
                  PRESET_ARG="$2"; LAYER_FLAGS="$LAYER_FLAGS --preset"; shift 2;;
    # The space form takes the NEXT argument as its value, so `--add-layer --yes <proj>` would silently swallow
    # `--yes` as a layer list — and the consent gate runs before layer validation, so the user would be told
    # they hadn't consented rather than that they'd mistyped. Reject a flag-shaped value outright.
    --add-layer)  case "${2:-}" in
                    ''|-*) echo "ERROR: --add-layer needs a comma-separated layer list, got '${2:-}'." >&2
                           echo "       Did you mean --add-layer=<layers>? Known layers: $HOUSE_LAYERS" >&2
                           exit 1;;
                  esac
                  ENSURE_ARG="$2"; LAYER_FLAGS="$LAYER_FLAGS --add-layer"; shift 2;;
    --help|-h)    usage; exit 0;;
    # Lists the valid flags rather than only naming the bad one. Costs two lines and answers the question
    # the reader actually has — including the cases that will keep arriving for a while: `--sync` / `--ensure`
    # (the command line before the subcommands) and `--repair` (older still), written into the HOUSE.md of
    # projects generated before those renames. No special case for them: they are simply not flags, and the
    # help says what is.
    #
    # MATCHES `-*`, NOT `--*`. A single-dash unknown (`-v`, `-x`) used to fall through to the `*)`
    # break and then hit the after-the-path guard below, which answered it with "it comes AFTER the project
    # path" — of an invocation that has no path at all, and then advised putting the flag first, where it
    # already was. An unknown flag is an unknown flag wherever it sits.
    -*)           echo "ERROR: unknown flag '$1' for 'house.sh $CMD'" >&2
                  echo "       Run 'house.sh help' for the full list." >&2
                  exit 1;;
    *)            break;;
  esac
done

# --print-inner must yield ONLY the program on stdout, or it cannot be piped into `bash -n` / a diff / a
# grep — and a debugging aid you have to hand-clean is one people stop using. Everything this script says
# about its own decisions (package manager, runtime, layers, backup) is progress reporting, not output, so
# under --print-inner it belongs on stderr. Stash the real stdout on fd 3 and hand it back only for the
# final printf; the human still sees every line, just on the other stream.
if [ "$PRINT_INNER" = "1" ]; then exec 3>&1 1>&2; fi

# Flags are LEADING only — the loop above stops at the first non-flag, and everything after it is positional.
# So a flag written after a positional is not rejected, it is silently absorbed as the APP NAME: `upgrade
# <proj> --local` renders `nx g …:serve --project=--local` with --local itself still off. Worse, `upgrade
# <proj> --yes` reports that the user has not consented, which sends the reader looking at the wrong thing
# entirely — the same mis-diagnosis the --add-layer guard above exists to prevent, one argument over. Catch it
# where the mistake actually is.
for _arg in "$@"; do
  case "$_arg" in
    # `-*`, not just `--*`: `-y` is an accepted alias for `--yes`, so `upgrade <proj> -y` was absorbed as the
    # app name and answered with "refusing to upgrade without consent" — the exact mis-diagnosis this guard
    # exists to prevent, just one dash short of catching it.
    -*)  echo "ERROR: '$_arg' looks like a flag, but it comes AFTER a positional argument (the project path," >&2
         echo "       or add-layer's layers), so it would be read as one. Flags come right after the command:" >&2
         echo "         house.sh $CMD $_arg ... <project> [app-name]" >&2
         exit 1;;
  esac
done

# --- what each command takes: one name, one job ----------------------------------------------------------------
# `upgrade` brings NO layer into being — that is `add-layer`'s whole job, and a command whose name says "upgrade"
# must not quietly also turn a library into an Angular app. So every layer-bringing flag is refused there, naming
# the command that does take it, rather than accepted and silently widening the run.
if [ "$CMD" = "upgrade" ] && [ -n "$LAYER_FLAGS" ]; then
  echo "ERROR: 'house.sh upgrade' adds no layer, so it does not take${LAYER_FLAGS}." >&2
  echo "       Bringing layers into being is its own command (an upgrade that also adds them):" >&2
  echo "         house.sh add-layer [flags] <layers> <project-path> [app-name]   e.g. house.sh add-layer firebase ." >&2
  echo "       Nothing has been written." >&2
  exit 1
fi
# `add-layer` takes its layers as its first POSITIONAL — the thing the command is about — so a second spelling of
# the same list as a flag is refused rather than unioned: two places to say one thing is one too many.
if [ "$CMD" = "add-layer" ]; then
  case "$LAYER_FLAGS" in
    *--add-layer*) echo "ERROR: 'house.sh add-layer' takes its layers as the first positional, not --add-layer:" >&2
                   echo "         house.sh add-layer [flags] <layers> <project-path> [app-name]" >&2
                   exit 1;;
  esac
  # The layers positional is ALWAYS required — even with --preset. Were it optional there, `add-layer --preset=angular
  # .` and `add-layer --preset=angular agent .` would differ only by counting positionals, and a forgotten list would
  # turn the project path into one ('.' as a layer) or the app name into the path. One shape, never ambiguous.
  if [ "$#" -lt 2 ]; then
    echo "ERROR: 'house.sh add-layer' needs the layers to add AND the project${1:+ — got only '$1'}." >&2
    echo "       The <layers> positional is always required, --preset or not (a preset only unions with it):" >&2
    echo "         house.sh add-layer [flags] <layers> <project-path> [app-name]   e.g. house.sh add-layer agent ." >&2
    echo "       Known layers: $HOUSE_LAYERS" >&2
    exit 1
  fi
  [ -n "$(printf '%s' "$1" | tr -d '[:space:],')" ] || {
    echo "ERROR: 'house.sh add-layer' was given an empty layer list. To upgrade without adding one: house.sh upgrade <project-path>" >&2
    exit 1; }
  ENSURE_ARG="$1"
  shift
fi
# $3 and beyond are silently ignored otherwise, which hides a typo'd flag or a mis-quoted path.
[ "$#" -le 2 ] || { echo "ERROR: too many arguments — expected at most <project> [app-name], got: $*" >&2; exit 1; }
APP_ARG="${2:-}"   # the app name AS GIVEN — a scaffold refuses one when nothing it ensures creates an app

# --- whose package manager is this? ---------------------------------------------------------------------------
# A SCAFFOLD creates the project, so it sets the house standard: yarn. AN UPGRADE does not get that choice. The
# package manager is a decision the project already made, encoded in a lockfile its whole team and its CI
# depend on — and running `yarn install` in an npm repo doesn't switch it, it produces a SECOND lockfile
# alongside the first. Two lockfiles that disagree is a genuinely bad state to leave someone in: `npm ci`
# starts failing, and the cause is a tool they ran once to get a devcontainer.
#
# `packageManager` (corepack) wins when present — it is an explicit declaration rather than an artifact.
# Otherwise the lockfile says it. With no signal at all, the house default is the right guess.
# Echoes `<pm> <source>` — the source matters, because "we read your lockfile" and "you told us nothing so
# we picked the house default" are different claims and only one of them should sound like a detection.
detect_package_manager() {
  local dir="$1" declared
  declared="$(grep -m1 '"packageManager"' "$dir/package.json" 2>/dev/null \
    | sed -E 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([a-z]+)@.*/\1/')"
  case "$declared" in
    yarn | npm | pnpm) echo "$declared packageManager-field"; return ;;
  esac
  [ -f "$dir/pnpm-lock.yaml" ]    && { echo "pnpm pnpm-lock.yaml"; return; }
  [ -f "$dir/yarn.lock" ]         && { echo "yarn yarn.lock"; return; }
  [ -f "$dir/package-lock.json" ] && { echo "npm package-lock.json"; return; }
  echo "yarn house-default"
}

# --- is the local Node new enough to skip Docker entirely? ---
# The bar is compile-generators.mts: TypeScript run directly by node, which needs type-stripping ON BY
# DEFAULT — Node 22.18+ (flagged/experimental before that). Anything older, or no local node / no local
# copy of THIS PROJECT'S package manager, falls back to the image. Inside a devcontainer this is always
# true, which is why `upgrade` runs there with no Docker. Mirrors publish.sh's local_node_ok().
local_node_ok() {
  command -v node >/dev/null && command -v "$PM" >/dev/null || return 1
  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]')" || return 1
  minor="$(node -p 'process.versions.node.split(".")[1]')" || return 1
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; }
}

# Nx release channel for the workspace create + the `nx add @nx/angular` step. Empty = latest stable.
# Set NX_CHANNEL=next to honor the Nx-lag rule: scaffold on a beta Nx that supports a NEWER Angular
# major than the latest *stable* Nx admits (e.g. Angular 22 on the Nx 23.1-beta line, when stable
# @nx/angular still peers @angular/build <22). Then `nx migrate` to stable Nx once it ships support.
NX_CHANNEL="${NX_CHANNEL:-}"
NX_TAG=""
[ -n "$NX_CHANNEL" ] && NX_TAG="@$NX_CHANNEL"
# yarn 1.x mishandles `yarn create <pkg>@<tag>` (it tries to run a binary literally named
# "<pkg>@<tag>" → not found). So use npx for the workspace create when a channel tag is set
# (npx resolves the dist-tag correctly); the stable path (no tag) keeps the original `yarn create`.
if [ -n "$NX_TAG" ]; then
  CREATE_WORKSPACE="npx --yes create-nx-workspace$NX_TAG"
else
  CREATE_WORKSPACE="yarn create nx-workspace"
fi

# Base-image lookup + engine-aware file ownership for the Docker fallback, shared with tools/extract-tool
# (see the header of container-engine.sh for why it lives beside this script).
# shellcheck source=container-engine.sh
. "$ENGINE_DIR/container-engine.sh"
# Pin the workspace's @bespunky/nx-tools to the SAME version this engine ships (read from
# the source package.json), so the installed runtime executors can never lag the applied project.json
# shape — a 0.x MINOR bump (e.g. 0.3→0.4) would otherwise fall outside a hard-coded caret and silently
# leave the project on the previous executor. Derived, never hand-maintained.
NX_TOOLS_VERSION="$(grep -m1 '"version"' "$ENGINE_DIR/nx-tools/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$NX_TOOLS_VERSION" ] || NX_TOOLS_VERSION="0.4.0"
# The plugin version that ships this engine, read from the manifest one level up (engine/ lives at
# <plugin>/engine). Together with NX_TOOLS_VERSION it is STAMPED into the project by the
# house-doc generator (into HOUSE.md's header — root-level and committed, so it reaches every clone), which
# is what lets the house plugin's SessionStart hook notice — with a few greps, not a Docker run — that the
# installed toolkit has moved past this project, and ask for an upgrade. NX_TOOLS_VERSION is the one the hook
# actually compares (it determines what the generators produce); PLUGIN_VERSION is provenance. Derived, never
# hand-maintained; "unknown" if the manifest can't be read (a raw engine checkout), which the hook reads as
# "behind" and resolves by upgrading.
PLUGIN_VERSION="$(grep -m1 '"version"' "$ENGINE_DIR/../.claude-plugin/plugin.json" 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
[ -n "$PLUGIN_VERSION" ] || PLUGIN_VERSION="unknown"
GIT_NAME="$(git config --global user.name 2>/dev/null || whoami)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "$(whoami)@localhost")"

# --- resolve TARGET + PROJECT + APP based on mode ---
# TWO CONCEPTS, KEPT APART: the DIRECTORY the run operates in, and the project's IDENTITY.
#   PROJECT_DIR_NAME  the target's basename — every PATH use (the cd into it, the container mount, the ownership
#                     fixup). Reaches the program as environment, never as text (see INNER_ENV).
#   PROJECT           the project's NAME — what the generators are told (--project=, house-doc, the window
#                     identity), the fallback app name, the GitHub repository. Validated by _check_name below.
# A scaffold creates the directory FROM the name, so the two coincide. An upgrade finds a directory that already
# exists, and the directory is not always named after the project: the house upgrade opens its own git worktree
# (dated, named after the run) when it starts on a protected branch, and naming the project after that slug stamped a date
# into every generator that asked who the project is. So on an upgrade the identity is the name the project has in
# its MAIN worktree, read from git (_project_identity), and the directory keeps its own name for paths.
# A missing argument is a usage question, not a bash error. `${1:?…}` printed a raw parameter-expansion
# message ("house.sh: line 213: 1: Usage: …") whose embedded usage line named only --firebase — the most
# likely discovery path in the whole script, advertising a fraction of the flags.
if [ "$#" -eq 0 ]; then
  usage >&2
  echo >&2
  echo "ERROR: no project given." >&2
  exit 1
fi

# The identity of an EXISTING project directory: the name the same directory has in the repository's MAIN
# worktree. `--git-common-dir` is shared by every worktree of a repository and, for an ordinary layout, is the main
# worktree's `.git` — so its parent is the main worktree, whatever this linked one happens to be called. Only the
# worktree's TOP maps to the main worktree's name: a workspace in a subdirectory of its repository is named after
# that subdirectory, which is the same in every worktree, so it keeps its own basename. Anything else — not a git
# repository, a bare or submodule layout whose common dir is not a `.git` beside a working tree — has no main
# worktree to ask, and falls back to the directory's own name, which is what an upgrade has always used.
_project_identity() {   # <absolute target dir>
  local _common _top
  _common="$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || _common=""
  _top="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null)" || _top=""
  case "$_common" in
    */.git)
      if [ -n "$_top" ] && [ "$(cd "$1" && pwd -P)" = "$(cd "$_top" && pwd -P)" ]; then
        basename "$(dirname "$_common")"
        return
      fi ;;
  esac
  basename "$1"
}

if [ "$MODE" = "new" ]; then
  # A bare NAME lands in PROJECTS_DIR; a PATH (absolute, or relative with a slash) is taken as written — the same
  # split `upgrade` makes. Joining PROJECTS_DIR onto a path produced `~/projects//abs/path`, an app named after the
  # whole path, and no git repo; the project's identity is the last segment, whichever way it was given.
  case "$1" in
    */*)
      _parent="$(dirname "$1")"
      [ -d "$_parent" ] || { echo "ERROR: '$_parent' does not exist — create it first, or pass a bare name to use PROJECTS_DIR." >&2; exit 1; }
      PROJECTS_DIR="$(cd "$_parent" && pwd)"
      PROJECT="$(basename "$1")"
      ;;
    *)
      PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"
      PROJECT="$1"
      ;;
  esac
  PROJECT_DIR_NAME="$PROJECT"
  APP="${2:-$PROJECT}"
  TARGET="$PROJECTS_DIR/$PROJECT"
  [ -e "$TARGET" ] && { echo "ERROR: '$TARGET' already exists. Choose another name (or upgrade it: house.sh upgrade <path>)." >&2; exit 1; }
else
  TARGET_INPUT="$1"
  if [ -d "$TARGET_INPUT" ]; then
    TARGET="$(cd "$TARGET_INPUT" && pwd)"
  else
    # ONLY a bare name falls back to PROJECTS_DIR. A path the user actually spelled out — absolute, or
    # relative with a slash in it — must be reported back as they typed it: joining PROJECTS_DIR onto
    # `/tmp/foo` produced `'/home/node/projects//tmp/foo' does not exist`, a path nobody wrote, which reads
    # as the tool searching the wrong root rather than as the typo it is.
    case "$TARGET_INPUT" in
      */*) echo "ERROR: '$TARGET_INPUT' does not exist (or is not a directory)." >&2; exit 1 ;;
    esac
    PROJECTS_DIR_FALLBACK="${PROJECTS_DIR:-$HOME/projects}"
    TARGET="$PROJECTS_DIR_FALLBACK/$TARGET_INPUT"
    [ -d "$TARGET" ] || {
      echo "ERROR: no project named '$TARGET_INPUT' in $PROJECTS_DIR_FALLBACK." >&2
      echo "       Pass a path instead, or set PROJECTS_DIR to where your projects live." >&2
      exit 1
    }
  fi
  [ -d "$TARGET" ] || { echo "ERROR: '$TARGET' does not exist." >&2; exit 1; }
  PROJECT_DIR_NAME="$(basename "$TARGET")"
  PROJECT="$(_project_identity "$TARGET")"
  PROJECTS_DIR="$(dirname "$TARGET")"
  # --- the app to refresh: given, or INFERRED later, by the package -----------------------------------------
  # Not inferred here. It used to be, from a bash glob over apps/*/project.json that skipped `functions` by name —
  # which knew one layout (apps/), one way of defining a project (project.json) and the house server app by its
  # name. A workspace keeping its apps under packages/, or defining them in package.json (TS-solution), had no
  # app as far as that glob could see, so the upgrade fell back to the folder name, skipped every per-app step and
  # still stamped the project current. Which projects are this workspace's apps is a question for the project
  # GRAPH, so it is asked of the installed package (`layers/cli.js apps`) inside the program, after the install —
  # the first point where the answer can be read honestly, and well before the one step that needs it (the plan).
  # Empty here means "infer"; the program falls back to the project name only when inference finds no single app.
  APP="${2:-}"
fi

# --- names are EXECUTED, so validate them before anything else touches them ------------------------------------
# $PROJECT and $APP are interpolated into the rendered command sequence (--project=, --name=, --scope=,
# --workspaceName=) which is then run by `bash -c`. They are not always typed by the user: $APP is INFERRED
# from the project graph (inside the program — a runtime variable there, never rendered into its source, and
# checked by this same function the moment it is inferred), and $PROJECT from a directory name — so a cloned
# repository can choose them. A directory literally named `$(...)` or containing a backtick therefore becomes a command
# substitution evaluated at render time, from nothing more than `git clone` plus an upgrade the user was invited
# to run by the SessionStart hook. That is remote code execution through a file name.
#
# Quoting each interpolation site would work only until someone adds the next one. Refusing the input is the
# property that holds: an Nx project name is an identifier, so anything outside that alphabet is not a name
# we should be repairing — it is one we should be declining. This also removes the whitespace-truncation
# case, where `my project` word-split and silently scaffolded something called `my`.
_check_name() {
  case "$2" in
    '') echo "ERROR: the $1 name is empty." >&2; exit 1 ;;
    -*) echo "ERROR: the $1 name '$2' starts with a dash, which would be read as a flag." >&2; exit 1 ;;
    # `/` and `.` have to be allowed for scoped names like @scope/pkg, which lets `..` through as a side
    # effect — and these names reach generators that build file paths from them.
    *..*) echo "ERROR: the $1 name '$2' contains '..', which could escape the workspace." >&2; exit 1 ;;
    *[!A-Za-z0-9._@/-]*)
      echo "ERROR: the $1 name '$2' contains characters that are not allowed." >&2
      echo "       Allowed: letters, digits, and . _ @ / -" >&2
      echo "       This name is passed to the house generators as a command argument, so it is refused" >&2
      echo "       rather than escaped. Rename the directory, or pass an explicit name:" >&2
      echo "         house.sh upgrade <project-path> <app-name>" >&2
      exit 1 ;;
  esac
}
_check_name project "$PROJECT"
# An app given (or a scaffold's default) is checked now; an INFERRED one is checked by the same function inside
# the program, the moment it is inferred (CHECK_NAME_FN below) — before any generator receives it.
[ -z "$APP" ] || _check_name app "$APP"

# The app an UPGRADE refreshes when none was given — resolved INSIDE the program (rendered there with `declare -f`),
# after the install, by asking the installed package for the apps to refresh (`layers/cli.js apps`: the project
# graph, project.json and package.json projects alike, classified by projectRole; the server-side app — Cloud
# Functions — excluded by its `platform:server` tag, not by its name; narrowed to the apps the project declares it
# serves in .bespunky/dev.json when that names any of them). Exactly one → that app. More than one
# → inference declines and says so (the correct answer rather than a guess). None → the project name, as before.
# Sets APP and APP_ROOT (empty when the app is not one of the workspace's client apps), and hands APP_ROOT to the
# outer summary through the upgrade lock's state file — the summary runs on the host, which may have no Node.
_resolve_upgrade_app() {   # <nx-tools dir> <app as given, or ''> <fallback name>
  local _apps _n _tab
  _tab="$(printf '\t')"
  _apps="$(node "$1/src/layers/cli.js" apps)" || {
    echo "ERROR: could not list this workspace's apps (the layer CLI failed) — refusing to guess which app to refresh." >&2
    return 1; }
  APP="$2"
  if [ -z "$APP" ]; then
    _n="$(printf '%s' "$_apps" | grep -c .)" || true
    if [ "$_n" -eq 1 ]; then
      APP="${_apps%%"$_tab"*}"
    elif [ "$_n" -gt 1 ]; then
      echo "NOTE: this workspace has more than one app ($(printf '%s\n' "$_apps" | cut -f1 | paste -sd' ' -)), so the app to refresh can't be inferred."
      echo "      Defaulting to '$3'. Declare the app you serve in .bespunky/dev.json, or pass one explicitly:"
      echo "        house.sh upgrade <project> <app-name>"
    fi
  fi
  APP="${APP:-$3}"
  _check_name app "$APP"
  APP_ROOT="$(printf '%s\n' "$_apps" | awk -F "$_tab" -v a="$APP" '$1 == a { print $2; exit }')"
  echo "[app] the app to refresh: $APP${APP_ROOT:+ ($APP_ROOT)}"
  if [ -n "$APP_ROOT" ] && [ -d .bespunky-upgrade.lock ]; then printf 'app=%s\n' "$APP_ROOT" >> .bespunky-upgrade.lock/state 2>/dev/null || true; fi
}
CHECK_NAME_FN="$(declare -f _check_name _resolve_upgrade_app)"

# Resolved and VALIDATED before the consent gate below. Argument validation is pure string work — it
# reads nothing, writes nothing, and reaches no network — so doing it first costs nothing and stops the
# script answering a typo with the wrong complaint: `--ensure=bogus` (now add-layer bogus) used to be met with "refusing to
# upgrade without consent", because the gate ran first. A malformed request should be told it is malformed.
# (It also settles FIREBASE before the banner below reports it, so add-layer firebase announces itself.)
# --- THE LAYER SET -------------------------------------------------------------------------------------------
# A project is not one shape; it is a STACK OF LAYERS, each with its own detector and its own generators. This
# is what lets an upgrade run on a repo that is not the scaffolder's own Angular+Firebase shape — including a
# plain TypeScript repo, or this toolkit itself.
#
# Two distinct questions, deliberately separated:
#   DETECT — what does this workspace already HAVE? Read from the workspace (see src/layers/registry.ts), at
#            run time, inside the target. Never declared, never inferred from flags.
#   ENSURE — which layers should this run BRING INTO BEING? An explicit request, never a guess. Creating an
#            Angular app in someone's repo because a flag defaulted to it is exactly the kind of surprise a
#            upgrade must never spring.
#
# The generators that run = the union. Detected layers get REFRESHED (that is what upgrade is); ensured layers
# get created and then refreshed by the same blocks. Which is the whole simplification: SCAFFOLD IS UPGRADE
# WITH A FULL ENSURE SET AGAINST AN EMPTY DIRECTORY. One rendered sequence below serves both modes, so the
# two can no longer drift the way two hand-maintained command lists did.
# PRESETS are named ensure sets — data beside the registry (src/layers/presets.ts, projected into layers.sh),
# so nothing here names one. --preset and the layers UNION: the preset is a starting set, the layers the general
# form. A SCAFFOLD with neither gets the DEFAULT preset — the house DX on the Nx floor, no framework: a new
# project wears a stack only when asked to (--preset=angular is the house web app). AN UPGRADE has no default:
# it ensures nothing above the floor unless asked — the difference between "bring my house tooling up to date"
# and "turn my library into an Angular app".
_layer_listed() { case ",$2," in *",$1,"*) return 0 ;; esac; return 1; }
if [ -n "$PRESET_ARG" ]; then
  _layer_listed "$PRESET_ARG" "$HOUSE_PRESETS" || {
    echo "ERROR: unknown preset '$PRESET_ARG'. Known presets:" >&2
    for _p in $(printf '%s' "$HOUSE_PRESETS" | tr ',' ' '); do echo "         $_p — $(house_preset_title "$_p")" >&2; done
    exit 1; }
  PRESET="$PRESET_ARG"
elif [ "$MODE" = "new" ] && [ -z "$ENSURE_ARG" ]; then
  PRESET="$HOUSE_PRESET_DEFAULT"
else
  PRESET=""
fi
ENSURE_LAYERS="${PRESET:+$(house_preset_layers "$PRESET")}"

# --- THE WORKSPACE SHAPE: layout (where projects live) and linking (how they reach each other) -----------------
# Two orthogonal facts about a workspace, kept to the same detect/ensure split as the layers: a SCAFFOLD may CHOOSE
# them, because it is creating the workspace; an UPGRADE only DETECTS them (resolveWorkspaceLayout, detectLinking —
# inside the package), because the shape of a workspace that exists is the shape its projects already have, and
# "choosing" one there would be a relocation no flag should perform. So an upgrade REFUSES both flags rather than
# silently ignoring them — an ignored flag reads as if it had been applied.
# Validated against the projection (HOUSE_LAYOUTS / HOUSE_LINKINGS, from LAYOUTS and the linking kinds), here,
# before anything is installed. Omitted, each reproduces today's output exactly: no workspaceLayout declared (the
# resolver's default — apps/ + packages/), and `paths` linking.
if [ "$MODE" = "upgrade" ] && { [ -n "$LAYOUT_ARG" ] || [ -n "$LINKING_ARG" ]; }; then
  _chosen="${LAYOUT_ARG:+--layout=$LAYOUT_ARG }${LINKING_ARG:+--linking=$LINKING_ARG}"
  echo "ERROR: house.sh $CMD does not take ${_chosen% }: an existing workspace's layout and linking are" >&2
  echo "       DETECTED from it (nx.json workspaceLayout and where its projects live; its tsconfig and package-" >&2
  echo "       manager workspaces), never chosen by an upgrade — choosing would mean relocating projects." >&2
  echo "       Drop the flag; it is for a NEW project (house.sh new --layout=<id> --linking=<id> <project>)." >&2
  echo "       Nothing has been written." >&2
  exit 1
fi
if [ -n "$LAYOUT_ARG" ] && ! _layer_listed "$LAYOUT_ARG" "$HOUSE_LAYOUTS"; then
  echo "ERROR: unknown layout '$LAYOUT_ARG'. Known layouts:" >&2
  for _p in $(printf '%s' "$HOUSE_LAYOUTS" | tr ',' ' '); do echo "         $_p — $(house_layout_title "$_p")" >&2; done
  exit 1
fi
if [ -n "$LINKING_ARG" ] && ! _layer_listed "$LINKING_ARG" "$HOUSE_LINKINGS"; then
  echo "ERROR: unknown linking '$LINKING_ARG'. Known linkings:" >&2
  for _p in $(printf '%s' "$HOUSE_LINKINGS" | tr ',' ' '); do echo "         $_p — $(house_linking_title "$_p")" >&2; done
  exit 1
fi
LAYOUT="$LAYOUT_ARG"
LINKING="${LINKING_ARG:-$HOUSE_LINKING_DEFAULT}"
# Where a scaffold's first app lands: the chosen layout's appsDir, else the resolver's default.
APPS_DIR="$HOUSE_LAYOUT_DEFAULT_APPS_DIR"
[ -n "$LAYOUT" ] && APPS_DIR="$(house_layout_apps_dir "$LAYOUT")"
[ -n "$ENSURE_ARG" ] && ENSURE_LAYERS="${ENSURE_LAYERS:+$ENSURE_LAYERS,}$ENSURE_ARG"
ENSURE_LAYERS="$(printf '%s' "$ENSURE_LAYERS" | tr -d '[:space:]')"

# `--firebase` IS an ensure request for the `firebase` layer — they are two spellings of one intent, and
# keeping them as separate concepts is a bug rather than a nuance.
#
# It regressed exactly that way: layering gated the emulator generator on `layer_active firebase`, whose
# detector is `firebase.json` — a file that by definition does NOT exist on the project you are adding
# Firebase to. So `--sync --firebase` (today: add-layer firebase) silently skipped the wiring while still handing the devcontainer
# `--firebase=true`, producing a Firebase-flavoured container (gcloud CLI, vsfire, emulator ports) attached
# to no emulators at all. Worse, this script's own error text advised that exact command as the way to add
# Firebase. Tying the two together makes the flag mean what it says, in both directions.
case ",$ENSURE_LAYERS," in
  *,firebase,*) FIREBASE=1 ;;
  *) [ "$FIREBASE" = "1" ] && ENSURE_LAYERS="${ENSURE_LAYERS:+$ENSURE_LAYERS,}firebase" ;;
esac

# THE FLOOR IS ALWAYS ENSURED. Nx is the mechanism under every house run — the generators are devkit generators
# run through `nx g`, the migration ladder is native `nx migrate` — so a repo without it gets it initialised in
# place instead of a refusal ("Let's keep Nx as a base assumption. If it's not there, we require/install/init
# it" — the user). This amends "an upgrade ensures nothing by default" to "an upgrade ensures nothing ABOVE THE FLOOR".
# It replaces the old agent⇒nx implication, which encoded the same fact as if it were a property of one layer.
case ",$ENSURE_LAYERS," in
  *",$HOUSE_LAYER_FLOOR,"*) ;;
  *) ENSURE_LAYERS="$HOUSE_LAYER_FLOOR${ENSURE_LAYERS:+,$ENSURE_LAYERS}" ;;
esac

# Validated against the REGISTRY (engine/layers.sh), here in the outer shell, where the error still has a human
# in front of it — rather than letting a typo silently ensure nothing at all. Every list, hint and rule below
# comes from the layer descriptors; nothing here names a layer.
#
#   known       — is it a registered layer?
#   ensurable   — does THIS MODE have a step that creates it? An upgrade can only create what a generator genuinely
#                 builds from nothing (the floor, the agent DX, the Firebase retrofit); the rest are added with
#                 their own native tooling and then DETECTED. Accepting more would be a promise the script
#                 cannot keep — and worse, it would STAMP the layer as applied while the next run, which
#                 re-detects, does not see it, so the tooling would rot with the stamp claiming otherwise.
#   via:<id>    — creatable only together with <id>, whose creation produces it (a `new` run's `web` is the
#                 dev-server of the Angular app the `angular` layer creates).
#   requires    — every layer a requested one requires must be THERE when it is created: either already in the
#                 workspace (detected — an upgrade only; a scaffold's directory is empty) or created by this run.
#                 Whatever is missing is ADDED to the ensure set (the closure below, announced — asking for
#                 `angular` and being told to also type `node` would be the script refusing to do arithmetic it
#                 can do), and then has to pass the same ensurability check as a requested layer. So an upgrade that
#                 asks for a layer whose requirement it can neither detect nor create is refused HERE, before
#                 anything is written — not planned, half-applied and stamped as if it had worked.
for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
  _layer_listed "$_l" "$HOUSE_LAYERS" || {
    echo "ERROR: unknown layer '$_l'. Known layers: $HOUSE_LAYERS" >&2; exit 1; }
done
# What the workspace already HAS, from the registry's own evidence (layers.sh) — read, never declared. Empty for a
# scaffold, whose directory does not exist yet.
EVIDENT=""
[ "$MODE" = "upgrade" ] && EVIDENT="$(house_layers_evident "$TARGET")"
# A layer an upgrade cannot create but the workspace already has needs nothing created: the upgrade REFRESHES it, as it
# does every detected layer. Refusing it with "add it with its own tooling" would be false about a layer that is
# right there (a hand-written .bespunky/dev.json already makes `web` present).
if [ -n "$EVIDENT" ]; then
  _kept=""
  for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
    if [ "$(house_layer_ensurable_upgrade "$_l")" = "no" ] && _layer_listed "$_l" "$EVIDENT"; then
      echo "NOTE: the '$_l' layer is already present here (detected) — the upgrade refreshes it; nothing to create."
    else
      _kept="${_kept:+$_kept,}$_l"
    fi
  done
  ENSURE_LAYERS="$_kept"
fi
_closed=""; _added=""; _added_for=""
while [ "$_closed" != "$ENSURE_LAYERS" ]; do
  _closed="$ENSURE_LAYERS"
  for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
    for _r in $(house_layer_requires "$_l" | tr ',' ' '); do
      _layer_listed "$_r" "$ENSURE_LAYERS" || _layer_listed "$_r" "$EVIDENT" || {
        ENSURE_LAYERS="$ENSURE_LAYERS,$_r"; _added="$_added $_r (for $_l)"; _added_for="$_added_for $_r:$_l"; }
    done
  done
done
# Which requested layer pulled <id> in (empty when it was asked for directly).
_needed_by() { local _e; for _e in $_added_for; do [ "${_e%%:*}" = "$1" ] && { printf '%s' "${_e#*:}"; return 0; }; done; return 0; }
# --- how does this project HOST Nx? ----------------------------------------------------------------------------
# Nx is the floor under every house run, but "has Nx" must not mean "is a Node project". Two hosting models:
#
#   node     a root package.json — Nx, @nx/devkit and @bespunky/nx-tools are devDependencies in node_modules,
#            run through the project's package manager. Every scaffold, and every JS/TS repo.
#   wrapper  NO root package.json (Python, Go, docs, …) — Nx's own wrapper: `./nx`, `.nx/nxw.js`, packages
#            under the gitignored `.nx/installation`, versions pinned EXACTLY in nx.json `installation`
#            (`plugins` holds @bespunky/nx-tools and @nx/devkit). The repo gains nx.json, ./nx and .nx/nxw.js,
#            and NOTHING that makes it a Node project — no package.json, no lockfile, no node_modules.
#
# The wrapper was once refused here ("cannot host devkit plugins"); that is no longer true on Nx 23 and was
# re-verified before relying on it: exact pin, generators, native nx migrate collect + run, and a fresh clone
# reinstalling the pins all work (docs/features/2026-10-01-stack-agnostic/contracts/layers.md). A repo that
# already runs the wrapper keeps it even if it also has a package.json.
#
# A SCAFFOLD decides it from the ensure set: the `node` layer IS "this repo has a package.json", so a scaffold
# that ensures it lays the floor with create-nx-workspace (a package.json host, the house package manager),
# and one that does not lays it through the wrapper — the default project is not a Node project.
HOST="node"
if [ "$MODE" = "upgrade" ]; then
  if { [ -f "$TARGET/.nx/nxw.js" ] && grep -q '"installation"' "$TARGET/nx.json" 2>/dev/null; } || [ ! -f "$TARGET/package.json" ]; then
    HOST="wrapper"
  fi
elif ! _layer_listed node "$ENSURE_LAYERS"; then
  HOST="wrapper"
fi
# `workspaces` linking IS package-manager workspaces: the root package.json's `workspaces` (pnpm: its
# pnpm-workspace.yaml) and a package.json per project. A wrapper-hosted scaffold has no package.json and no package
# manager of its own — so the combination is not a degraded variant of anything; it does not exist. Refused, with
# the one thing that makes it exist, rather than quietly scaffolding `paths`.
if [ "$MODE" = "new" ] && [ "$LINKING" = "workspaces" ] && [ "$HOST" = "wrapper" ]; then
  echo "ERROR: --linking=workspaces links projects through package-manager workspaces, which need a package.json —" >&2
  echo "       and this scaffold ensures no 'node' layer (layers: $ENSURE_LAYERS), so it would have none." >&2
  echo "       Add it:  house.sh new --add-layer=node --linking=workspaces $PROJECT   (or --preset=node / --preset=angular)" >&2
  echo "       Nothing has been written." >&2
  exit 1
fi

# --- resolve the package manager + the three commands the rendered sequences use -------------------------------
# Scaffold sets the house standard (it is creating the project); upgrade adopts whatever the project already
# uses. Everything downstream goes through these three variables, so a new package manager is one case here
# rather than twenty call sites.

if [ "$HOST" = "node" ] && [ "$MODE" = "new" ]; then
  PM="yarn"; PM_SOURCE="house-default"
elif [ "$HOST" = "wrapper" ]; then
  # The wrapper installs with npm into .nx/installation; the project itself has no package manager to honour.
  PM="npm"; PM_SOURCE="nx-wrapper"
else
  read -r PM PM_SOURCE <<< "$(detect_package_manager "$TARGET")"
fi

case "$PM" in
  yarn) PM_INSTALL="yarn install";  PM_EXEC="yarn" ;;
  # `npx --no-install` deliberately: nx is in node_modules by this point, and without the flag a typo or a
  # pruned package would silently fetch something from the registry and run it instead of failing.
  npm)  PM_INSTALL="npm install";   PM_EXEC="npx --no-install" ;;
  pnpm) PM_INSTALL="pnpm install";  PM_EXEC="pnpm exec" ;;
esac

# --- ADDING A DEV DEPENDENCY: decided where and when it runs, never composed here --------------------------------
# The add used to be a command string composed on this side, once, before the program ran — and for a scaffold
# before the project even existed. That made it a SNAPSHOT of a question whose answer belongs to the moment and
# the place the install actually runs: "is this directory a workspace root, and which version of the package
# manager is about to run in it?" The program may run in the fallback container with a different yarn than this
# host has, and a fresh `--linking=workspaces` scaffold BECOMES a yarn workspaces root halfway through its own
# program. A snapshot cannot see either. So the add is a FUNCTION, rendered into the program with `declare -f`
# (like _check_name), that asks the package manager that will run and the workspace it runs in, at call time.
# The package manager itself IS settled here ($PM: the project's own choice, detected above), and is handed to
# every call as a literal; what moves to run time is only the flag that depends on the workspace's shape.
#
# One concept — ADDING TO A WORKSPACE ROOT — and each package manager's own way of saying "yes, the root":
#   yarn 1   `-W` at a workspaces root, where a plain `yarn add` refuses outright (exit 1, "Running this command
#            will add the dependency to the workspace root rather than the workspace itself"); harmless anywhere
#            else, but it is only passed where it is meant. Berry (2+) has no `-W` and needs none — it adds to the
#            root of whatever directory it is run in — so the flag is gated on the major, not on the field alone.
#   pnpm     `-w` is REQUIRED inside a pnpm WORKSPACE — there `pnpm add` at the root refuses
#            (ERR_PNPM_ADDING_TO_ROOT) unless you say you meant the root, and the root is exactly where house
#            tooling belongs. But it is FATAL outside one: `--workspace-root may only be used inside a workspace`,
#            exit 1 (verified on pnpm 11.9.0). This used to be tolerated because the install was gated and
#            trailed by a `|| echo NOTE:`; now that installing the toolkit is unconditional and runs under
#            `set -e`, passing it unconditionally would abort every upgrade on a plain pnpm repo. So ask the
#            workspace which shape it is (pnpm-workspace.yaml).
#   npm      adds to the root it runs in, workspaces or not — nothing to say.
#
# EVERY ADD PINS EXACTLY — each arm carries an explicit exact-save flag, and that is load-bearing rather than a
# style choice (see INSTALL_NX_TOOLS for why an accidental caret silently skips the migration ladder). npm in
# particular defaults to `save-prefix=^` and WILL write `^0.24.3` without `--save-exact`; yarn 1 and pnpm happen
# to default to exact today, but that is a default, and a project's `.npmrc` / `.yarnrc` can change it under us.
# Say it out loud in all three.
#
# The `workspaces` field is read with node, not grepped: a package.json is JSON, and the program already needs
# node for everything after the install.
_pm_add_dev() {   # <package manager> <spec>...
  local _pm="$1" _root=""
  shift
  case "$_pm" in
    yarn)
      case "$(yarn --version 2>/dev/null)" in
        1.*) node -e 'process.exit(require("./package.json").workspaces ? 0 : 1)' 2>/dev/null && _root="-W" ;;
      esac
      echo "[tools] yarn add -D -E ${_root:+$_root }$*"
      yarn add -D -E ${_root:+"$_root"} "$@" ;;
    pnpm)
      [ -f pnpm-workspace.yaml ] && _root="-w"
      echo "[tools] pnpm add -D ${_root:+$_root }-E $*"
      pnpm add -D ${_root:+"$_root"} -E "$@" ;;
    npm)
      echo "[tools] npm install --save-dev --save-exact $*"
      npm install --save-dev --save-exact "$@" ;;
    *)
      echo "ERROR: no way to add a dev dependency with package manager '$_pm'." >&2
      return 1 ;;
  esac
}
# Rendered only on the NODE host: the wrapper host has no package manager of its own (it pins into nx.json), so a
# program that carried an add it can never call would only invite one.
PM_ADD_FN=""
[ "$HOST" = "node" ] && PM_ADD_FN="$(declare -f _pm_add_dev)"
if [ "$HOST" = "wrapper" ] && [ "$MODE" = "new" ]; then
  echo "Nx host: the Nx wrapper (./nx) — the new project has no package.json (ensure the node layer, or --preset=node, for one)"
elif [ "$MODE" = "upgrade" ]; then
  if [ "$HOST" = "wrapper" ]; then
    echo "Nx host: the Nx wrapper (./nx) — this repo has no package.json and does not become a Node project"
  elif [ "$PM_SOURCE" = "house-default" ]; then
    echo "Package manager: $PM (this project declares none — using the house default)"
  else
    echo "Package manager: $PM (from $PM_SOURCE — the project's choice, not imposed)"
  fi
fi

# --- the HOST: how this run invokes Nx and where the toolkit lives ----------------------------------------------
# Every rendered block goes through these three — and so does every hint this script prints (a refusal that tells
# a yarn user to type a bare `nx g` names a command their shell does not have), so the node and wrapper hosting models differ in exactly one place.
#   NX_RUN     the nx command (the package manager's, or the wrapper script)
#   NXT_DIR    where @bespunky/nx-tools is installed, relative to the workspace root — the layer CLI, the probe
#              and the --local collector all read the INSTALLED package from here
#   VENDOR_DIR the installed-packages directory a per-migration commit must never sweep in
if [ "$HOST" = "wrapper" ]; then
  NX_RUN="./nx"
  NXT_DIR=".nx/installation/node_modules/@bespunky/nx-tools"
  VENDOR_DIR=".nx/installation"
else
  NX_RUN="$PM_EXEC nx"
  NXT_DIR="node_modules/@bespunky/nx-tools"
  VENDOR_DIR="node_modules"
fi

# One spelling of the set from here on: registry order, each layer once.
_ordered=""
for _l in $(printf '%s' "$HOUSE_LAYERS" | tr ',' ' '); do
  _layer_listed "$_l" "$ENSURE_LAYERS" && _ordered="${_ordered:+$_ordered,}$_l"
done
ENSURE_LAYERS="$_ordered"
# Every layer is checked, THEN one verdict — a request wrong in two ways says so once (asking for `angular` on a repo
# with no package.json lacks `node` AND `angular`, and both hints are what the user needs).
_refused=0
for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
  if [ "$MODE" = "new" ]; then _ens="$(house_layer_ensurable_new "$_l")"; _ensurable="$HOUSE_LAYERS_ENSURABLE_NEW"
  else _ens="$(house_layer_ensurable_upgrade "$_l")"; _ensurable="$HOUSE_LAYERS_ENSURABLE_UPGRADE"; fi
  case "$_ens" in
    yes) ;;
    via:*)
      _via="${_ens#via:}"
      _layer_listed "$_via" "$ENSURE_LAYERS" || {
        echo "ERROR: $A_RUN can ensure the '$_l' layer only together with '$_via', whose creation produces it." >&2
        echo "       Add it to the layers: $ENSURE_LAYERS,$_via" >&2
        _refused=1; } ;;
    *)
      _for="$(_needed_by "$_l")"
      if [ -n "$_for" ]; then
        echo "ERROR: the '$_for' layer requires '$_l', which this repo does not have — and $A_RUN cannot create it." >&2
        echo "       Add '$_l' with its own tooling, then re-run and it will be DETECTED:" >&2
      elif [ "$MODE" = "new" ]; then
        echo "ERROR: a scaffold cannot ENSURE the '$_l' layer — nothing on this path creates it." >&2
        echo "       Scaffold the project, then add it with its own tooling:" >&2
      else
        echo "ERROR: add-layer cannot ADD the '$_l' layer — this repo does not have it, and nothing an upgrade" >&2
        echo "       runs creates it: it brings house tooling up to date and adds house layers, never a framework." >&2
        echo "       Add the layer with its own tooling, then re-run house.sh upgrade and it will be DETECTED:" >&2
      fi
      # The hint is written host-neutrally (`nx …`); spell it the way THIS repo runs Nx — `./nx` on a wrapper
      # host, `yarn nx` / `npx --no-install nx` / `pnpm exec nx` on a package.json host.
      _hint="$(house_layer_hint "$_l")"
      _hint="$(printf '%s' "$_hint" | sed "s|\`nx |\`$NX_RUN |g")"
      echo "         $_hint" >&2
      _refused=1 ;;
  esac
done
if [ "$_refused" = "1" ]; then
  echo "       Addable by $A_RUN: $_ensurable. Nothing has been written." >&2
  exit 1
fi
[ -n "$PRESET" ] && echo "Preset: $PRESET — $(house_preset_title "$PRESET")"
[ -n "$_added" ] && echo "Also ensuring what those layers require:$_added"
[ -n "$ENSURE_LAYERS" ] && echo "Layers to ensure: $ENSURE_LAYERS"

# --- the FIRST APP: only a layer whose stack creates apps makes one ------------------------------------------
# Derived from the registry projection (house_layer_app_stack: the stack adapter with an `apps` port for that
# layer), never from a layer name here. A scaffold that ensures no such layer creates no app — and an app name on
# the command line is then refused rather than silently ignored: it would read as if something used it.
APP_STACK=""
for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
  _s="$(house_layer_app_stack "$_l")"
  [ -n "$_s" ] && { APP_STACK="$_s"; break; }
done
if [ "$MODE" = "new" ] && [ -n "$APP_ARG" ] && [ -z "$APP_STACK" ]; then
  echo "ERROR: an app name ('$APP_ARG') was given, but nothing this scaffold ensures creates an app" >&2
  echo "       (layers: $ENSURE_LAYERS). Ask for a stack that does, e.g.:  house.sh --preset=angular $PROJECT $APP_ARG" >&2
  exit 1
fi

# --- upgrade consent gate (see the header) ---
# The point of this gate is that it cannot be satisfied by inference. An upgrade is a real, minutes-long,
# file-rewriting action; the hook that notices a stale project can only SAY so. Consent has to come from a
# human, and this is where that is enforced instead of hoped for.
#
# It runs FIRST — before the runtime decision below, before any network call, before anything is read or
# written. An unconsented upgrade must fail for want of CONSENT, not trip over a missing daemon on its way to
# the same place: "docker not found" would send an agent off to fix Docker and come back (which is precisely
# the inference this gate exists to stop) — and, worse, is now a lie, since the local Node usually suffices.
# --print-inner is exempt: it RENDERS the program and exits (see --print-inner below) without running a single command
# of it, so there is nothing here to consent to. The gate guards the *act* of upgrading, not describing it —
# and the render test (tools/test-scaffold/render.test.sh) drives exactly `upgrade --yes --print-inner` under
# CI=true, which the unconditional CI refusal below would otherwise kill before it could render anything.
if [ "$MODE" = "upgrade" ] && [ "$PRINT_INNER" != "1" ]; then
  if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    echo "ERROR: refusing to upgrade in CI — an upgrade rewrites generated files and no human is here to agree." >&2
    echo "       Run it locally, review the diff against the pre-upgrade HEAD, and commit the result." >&2
    exit 1
  fi

  if [ "$CONSENT" != "1" ]; then
    if [ -t 0 ] && [ -t 1 ]; then
      echo "About to upgrade '$TARGET': re-runs the house generators, REWRITING generated files"
      echo "(HOUSE.md, .claude/settings.json, .devcontainer/*, serve/worktree/design-system targets)."
      echo "It starts only from a clean git tree, so HEAD is the restore point."
      printf "Proceed? [y/N] "
      read -r reply
      case "$reply" in
        [yY] | [yY][eE][sS]) ;;
        *) echo "Aborted — nothing was changed." >&2; exit 1 ;;
      esac
    else
      echo "ERROR: refusing to upgrade without consent — nothing is attached to this shell to ask." >&2
      echo "       An upgrade rewrites generated files and takes several minutes." >&2
      echo "       If (and ONLY if) the user has explicitly agreed to it, re-run with --yes." >&2
      exit 1
    fi
  fi
fi

# --- runtime decision: local Node vs Docker (AFTER the consent gate, so an unconsented upgrade never gets
#     here). Docker was never the requirement — a modern Node is. When the local Node is new enough we run
#     the generators NATIVELY (no daemon, no image, no mounts) with the path roots bound to real host dirs;
#     otherwise we fall back to the base image, binding the roots to the container mount points. The
#     PLAN_RUN_BLOCK/INNER below are rendered ONCE against these roots, so the two paths cannot drift. ---
if [ "$FORCE_DOCKER" = "0" ] && local_node_ok; then
  RUNTIME="native"
  echo "Node $(node -v) is new enough — running the generators natively (no Docker)."
  WORK_ROOT="$PROJECTS_DIR"          # where the <project> dir lives (host path)
  ENGINE_ROOT="$ENGINE_DIR"          # nx-tools + compile-generators.mts (host path)
  RUNTIME_DESC="native node $(node -v)"
else
  RUNTIME="docker"
  if [ "$FORCE_DOCKER" = "1" ]; then
    echo "--docker: forcing the base image even though the local Node may suffice."
  else
    echo "Local Node missing or older than 22.18 — falling back to Docker."
  fi
  command -v docker >/dev/null || { echo "ERROR: docker not found (and the local Node is too old to run natively — need Node 22.18+)." >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
  command -v curl >/dev/null || { echo "ERROR: curl not found" >&2; exit 1; }
  echo "Resolving latest typescript-node base image..."
  # The image the GENERATORS run in — nothing more. The project's own Node (its devcontainer image, its functions
  # runtime) is the project's own Node file (.nvmrc, .node-version or volta.node), which the generators read; this runner's Node never leaks into the output.
  MAJOR="$(base_image_node_major)"
  IMAGE="$(base_image_for_major "$MAJOR")"
  echo "Base image: $IMAGE"
  echo "Container engine: $(container_engine_describe)"
  WORK_ROOT="/work"                  # PROJECTS_DIR is mounted here (see docker run -v below)
  ENGINE_ROOT="/engine"              # ENGINE_DIR is mounted here (ro)
  RUNTIME_DESC="image=$IMAGE"
fi
# THE ROOTS REACH THE PROGRAM AS ENVIRONMENT, NEVER AS TEXT. The project and app names are validated before they
# are rendered (_check_name), but the directory ABOVE the project, the engine path and the git identity are not
# names and cannot be validated into an alphabet — an O'Brien in the parent path closed the rendered quote, and
# the cd's argument ran on into the next lines of the program; a crafted parent directory could inject a command.
# Quoting each site would hold only until the next site is added. So the program refers to them as variables, and
# the runtime hands them over (env for the native run, -e for the container). The project's DIRECTORY name is one
# of them: on an upgrade it is no longer the validated project name but whatever the directory happens to be called
# (a worktree, a clone renamed by hand), so it is a path like the others and travels the same way.
INNER_ENV=(
  "HOUSE_WORK_ROOT=$WORK_ROOT"
  "HOUSE_PROJECT_DIR_NAME=$PROJECT_DIR_NAME"
  "HOUSE_ENGINE_ROOT=$ENGINE_ROOT"
  "HOUSE_GIT_NAME=$GIT_NAME"
  "HOUSE_GIT_EMAIL=$GIT_EMAIL"
)
[ -n "$NX_CHANNEL" ] && echo "Nx channel: $NX_CHANNEL (Nx-lag rule — beta toolchain accepted)"
[ "$FIREBASE" = "1" ] && echo "Firebase: opt-in ENABLED (pinned firebase-tools + Google Cloud CLI + emulator ports)"
[ "$VOICE" = "1" ] && echo "Voice: opt-in ENABLED (host audio bridge — WSLg or PulseAudio/PipeWire — + espeak-ng in the image + bespunky-voice plugin)"

# --- devcontainer generator args ---
# The devcontainer's layer flags have exactly ONE author: the `agent` layer's plan step
# (nx-tools/src/layers/agent.ts), resolved at run time from the ACTIVE layer set. Nothing here appends any.
#
# History worth keeping: there used to be a second, flag-driven author here beside a detection-driven one, and
# from 5607eb3 both fired — `nx g` saw --firebase=true twice, coerced it to an array, rejected it against a
# boolean schema, and under `set -e` took down every generator after the devcontainer. Two authorities for one
# fact is the bug; one is the fix. The planner now REFUSES a step that passes any flag twice (plan.ts), and
# render.test.sh still checks the rendered program's own `nx g` lines.
#
#   firebase - through ENSURE_LAYERS, which the --firebase flag populates (see the ensure-set assembly).
#   voice    - passed to the planner, which also carries a previous answer forward from the ownership marker.

# --- Firebase opt-in plumbing ---
#   Scaffold mode: the house `app` generator attaches the per-app Firebase client from its --layers (the ensure
#     set, which --firebase populates) — firebase.json does not exist yet at first-app time to be detected.
#   Upgrade mode: the app already exists; the `firebase` layer's per-app step re-applies the client to it.
# --staging (opt-in) requires Firebase; it adds environment.staging.ts + a `staging` build config +
# apphosting.staging.yaml, which the App Hosting backend whose Environment name is `staging` merges over
# apphosting.yaml (set in the console; there is no CLI flag) so it builds its own config/database.
[ "$STAGING" = "1" ] && [ "$FIREBASE" != "1" ] && { echo "ERROR: --staging requires the firebase layer (new: --firebase; add-layer: firebase among the layers)." >&2; exit 1; }
APP_STAGING_FLAG=""
[ "$STAGING" = "1" ] && APP_STAGING_FLAG=" --staging=true"
# The UPGRADE side of Firebase is no longer a block here: it is the `firebase` layer's per-app generator step in
# the registry (nx-tools/src/layers/firebase.ts), planned at run time like every other layer's generators —
# refreshed whenever the layer is DETECTED, wired (--wireProviders) only when this run ENSURES it.
#
# ============================================================================================================
# THE RENDERED BLOCKS START HERE. READ THIS BEFORE EDITING ANY OF THEM.
#
# Everything from here down that is assigned as NAME="…" is not code that runs now — it is TEXT assembled
# into $INNER and executed later, in one `bash -c`. Inside those double-quoted strings:
#
#   `cmd`  and  $(cmd)   are COMMAND SUBSTITUTION — evaluated NOW, at render time, even inside a # comment.
#                        Prose about a flag has bitten this file repeatedly for exactly this reason: a
#                        backtick-quoted `--foo` in an explanatory comment runs `--foo` as a command.
#   "      terminates the string unless escaped \" — including a quoted phrase inside a comment.
#   $VAR   expands NOW (render time). Use \$VAR for a variable the RENDERED script should evaluate.
#
# Rule of thumb: inside these blocks write comments in plain prose with no backticks, no parentheses-with-$,
# and no double quotes. Verify with `house.sh --print-inner …` — it renders the whole program without
# executing it, and ANY stderr during rendering means something in a string was evaluated that should not
# have been. Pipe it into `bash -n /dev/stdin` to syntax-check the result.
# ============================================================================================================
# Exact-pin entries into nx.json's installation.plugins — the wrapper's equivalent of a devDependency. Pairs of
# <package> <spec> as arguments; the wrapper reinstalls .nx/installation on its next invocation to match.
NX_WRAPPER_PIN="node -e \"const fs=require('fs'),f='nx.json',j=JSON.parse(fs.readFileSync(f,'utf8'));j.installation=j.installation||{};j.installation.plugins=j.installation.plugins||{};const a=process.argv.slice(1);for(let i=0;i<a.length;i+=2)j.installation.plugins[a[i]]=a[i+1];fs.writeFileSync(f,JSON.stringify(j,null,2)+'\\\\n')\""
# The devkit is pinned to the wrapper's own nx version: the plugin's peer range alone would float it to the
# newest 23.x on every fresh clone, and a devkit that does not match its nx is its own failure mode.
NX_WRAPPER_NXV="\$(node -p \"require('./nx.json').installation.version\")"

# --- house tooling: INSTALL @bespunky/nx-tools (used by both modes) ---
# A REAL npm install, not a copy into node_modules. The copy it replaces existed for one stated reason —
# "it must not ship in the generated project" — and that reason had already stopped being true: the scaffold
# declares the dependency anyway. What was left was pure cost: because the package was undeclared, every
# `installPackagesTask` a generator fired PRUNED it, so the copy had to be re-established before all 19
# generator calls, and the version present in node_modules during a run was always the local one rather than
# whatever the project actually had.
#
# That last part is why this matters beyond tidiness. `nx migrate` decides which migrations a project needs
# by reading the installed version out of node_modules. With the copy in place it always read the NEW
# version, concluded there was nothing to do, and would have reported success having migrated nothing. A real
# install is what makes the migration story possible at all.
#
# PINNED EXACTLY, no caret — see _pm_add_dev, where every package manager is given an explicit exact-save
# flag. `^0.24.0` lets an ordinary `yarn install` float the project to a newer published minor with no
# migration having run; the migrator would then read that newer version as where the project already is and
# skip the whole ladder. `nx migrate` is the only thing that should ever move this. (The migrate step no
# longer *depends* on the pin — it passes an explicit `--from` derived below — but an exact pin keeps the
# declared version and the applied project shape describing the same thing, which is what the stamp claims.)
#
# THE WRAPPER HOST pins instead of adding: nx.json installation.plugins is its manifest, the pin is exact by
# construction (a literal version string, compared verbatim by .nx/nxw.js), and the next ./nx invocation
# installs to match. @nx/devkit is pinned beside it, to the wrapper's own nx version.
if [ "$HOST" = "wrapper" ]; then
  INSTALL_NX_TOOLS="_nxv=\"$NX_WRAPPER_NXV\"
  $NX_WRAPPER_PIN '@bespunky/nx-tools' '$NX_TOOLS_VERSION' '@nx/devkit' \"\$_nxv\"
  echo \"[tools] pinned @bespunky/nx-tools@$NX_TOOLS_VERSION and @nx/devkit@\$_nxv in nx.json installation.plugins\"
  ./nx --version >/dev/null"
else
  INSTALL_NX_TOOLS="_pm_add_dev $PM @bespunky/nx-tools@$NX_TOOLS_VERSION"
fi
FINALIZE_LOCAL=""   # only --local needs a post-run manifest correction; see below.
if [ "$LOCAL_TOOLS" = "1" ]; then
  # How the packed tarball is installed, per host. The wrapper takes a file: spec as its pin, which nxw.js
  # compares verbatim, so every ./nx call for the rest of this run resolves back to the SAME build.
  if [ "$HOST" = "wrapper" ]; then
    LOCAL_ADD="  _nxv=\"$NX_WRAPPER_NXV\"
  $NX_WRAPPER_PIN '@bespunky/nx-tools' \"file:\$_local_stage/\$_local_tgz\" '@nx/devkit' \"\$_nxv\"
  ./nx --version >/dev/null"
  else
    # POINT THE MANIFEST AT THE TARBALL, THEN A PLAIN INSTALL — never the package manager's add. An add resolves
    # the WHOLE manifest before it replaces anything, and after a previous --local run the manifest pins
    # @bespunky/nx-tools to a version no registry has (that run's FINALIZE_LOCAL corrected the spec to the plain
    # version, honestly). So the second --local run on the same project died in the add, on the very spec it was
    # about to replace — and --local exists precisely to be re-run on its own output while a change is iterated.
    # Writing the spec first removes the unresolvable entry before anything resolves, and the first run and every
    # later one take the same path. The spec goes where the project already declares the package, else devDeps.
    LOCAL_ADD="  # local-install:begin
  node -e \"const fs=require('fs'),f='package.json',j=JSON.parse(fs.readFileSync(f,'utf8')),P='@bespunky/nx-tools';
    const b=['dependencies','devDependencies'].find(k=>j[k]&&j[k][P])||'devDependencies';
    j[b]=Object.assign(j[b]||{},{[P]:'file:'+process.argv[1]});fs.writeFileSync(f,JSON.stringify(j,null,2)+'\\\\n')\" \"\$_local_stage/\$_local_tgz\"
  $PM_INSTALL
  # local-install:end"
  fi
  # --local: install the WORKING TREE instead of the registry, for developing the toolkit itself.
  #
  # Still a real install — npm packs the engine's nx-tools into a tarball and installs that, so the package is declared,
  # resolved and pruning-proof exactly like the published one. Only its origin differs. Without this, every
  # toolkit change would have to reach npm before it could be tested anywhere, including on this repo.
  #
  # The package ships compiled JS (its `files` allowlist is JS + JSON), so the sources must be compiled
  # before packing. The compile brings its OWN TypeScript rather than the workspace's: compile-generators.mts
  # uses the classic compiler API, which TypeScript 7 removed from its main entry, and a workspace need not
  # have TypeScript at all.
  # TRAP ARMED AT THE mktemp, not left to the rm at the end. Everything between here and that rm can fail
  # under set -e — the TypeScript install, the compile, npm pack, the add — and this stage is BIGGER than the
  # one whose leak taught this lesson the first time: it holds a full nx-tools copy AND a TypeScript install,
  # a few hundred MB per abandoned run. The trap runs inside the rendered sequence, which is the only scope
  # that can see this path (the outer shell never learns it).
  INSTALL_NX_TOOLS="_local_stage=\"\$(mktemp -d)\"
  trap 'rm -rf \"\$_local_stage\"' EXIT INT TERM
  cp -r \"\$HOUSE_ENGINE_ROOT/nx-tools\" \"\$_local_stage/nx-tools\"
  mkdir -p \"\$_local_stage/ts\"
  (cd \"\$_local_stage/ts\" && npm init -y >/dev/null 2>&1 && npm install --no-save --no-audit --no-fund --silent 'typescript@^5' && node \"\$HOUSE_ENGINE_ROOT/compile-generators.mts\" \"\$_local_stage/nx-tools\")
  _local_tgz=\"\$(cd \"\$_local_stage/nx-tools\" && npm pack --silent --pack-destination \"\$_local_stage\")\"
  echo \"[tools] --local: installing the working tree (\$_local_tgz) instead of the published package\"
$LOCAL_ADD
  # AND THE MANIFEST DELIBERATELY KEEPS POINTING AT THE TARBALL for the rest of this run. Several generators
  # call installPackagesTask mid-sequence, which runs a plain install against whatever package.json says --
  # so correcting the spec to the plain version HERE meant the first such generator quietly replaced the
  # working-tree build with the published one, and every generator after it ran the published code. Under
  # --local that is the opposite of the flag's purpose, and it is invisible. Worse, when the version is not
  # published at all (the stated use case) that install fails outright, after migrations have already been
  # committed. Keeping the tarball spec makes every mid-run reinstall resolve back to the SAME build; the
  # spec is corrected once, at the end, by FINALIZE_LOCAL.
"

  # Assigned INSIDE this branch: a non-local run has nothing to finalise, and an unconditional definition
  # would append the whole correction to every rendered sequence.
  FINALIZE_LOCAL="  # Then correct the MANIFEST back to the plain version. npm records a tarball install as the path it was
  # installed from — and that path is a temp dir this run deletes, leaving the project declaring a dependency
  # on a file that no longer exists, so the next install in that project fails. node_modules keeps the code
  # that was actually installed; only the recorded spec is fixed, which is the honest description of what the
  # project now has.
  node -e \"const f='package.json',fs=require('fs'),j=JSON.parse(fs.readFileSync(f,'utf8'));for(const b of ['devDependencies','dependencies'])if(j[b]&&j[b]['@bespunky/nx-tools'])j[b]['@bespunky/nx-tools']='$NX_TOOLS_VERSION';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\\n')\"
  # The LOCKFILE records the same dead path, and unlike package.json it is the file that gets COMMITTED — so
  # a fresh clone or a CI install fails on a temp dir that never existed on that machine. Scrub every place
  # the path appears. Note there are TWO places in a package-lock: the resolved package entry under
  # \`packages\`, and the ROOT project's own dependency spec at packages[''] — missing the second leaves the
  # dead path in the committed file and additionally desynchronises the lockfile from package.json. Fixing
  # one and not the other is worse than neither.
  #
  # This is scrubbing, not rewriting, and it does not make the lockfile INSTALLABLE — nothing can, until the
  # version is published; a later install still fails, just on a version that does not exist yet rather than
  # on a path that never existed on anyone else's machine. A lockfile cannot honestly pin an unpublished
  # version, which is the whole premise of --local. What is left is a DEV-LOOP artifact, announced below.
  node -e \"const fs=require('fs');const P='@bespunky/nx-tools';const V='$NX_TOOLS_VERSION';
  if(fs.existsSync('package-lock.json')){const j=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
    for(const k of ['packages','dependencies'])if(j[k])for(const e of Object.keys(j[k]))if(e===P||e.endsWith('node_modules/'+P))delete j[k][e];
    for(const r of [j.packages&&j.packages['']])if(r)for(const b of ['devDependencies','dependencies'])if(r[b]&&r[b][P])r[b][P]=V;
    fs.writeFileSync('package-lock.json',JSON.stringify(j,null,2)+'\\n')}
  if(fs.existsSync('yarn.lock')){const t=fs.readFileSync('yarn.lock','utf8').split(/\\r?\\n\\r?\\n/).filter(b=>!new RegExp('^\\\"?'+P.replace('/','\\\\/')+'@').test(b.trim()));fs.writeFileSync('yarn.lock',t.join('\\n\\n'))}\" \\
    || echo '[tools] --local: WARNING: could not scrub the lockfile (it may be malformed). It still records the temp tarball path — do not commit it.' >&2
  # pnpm-lock.yaml is deliberately NOT edited. It is YAML with structural cross-references, and a regex
  # through it is how a lockfile gets quietly corrupted — a worse outcome than the stale entry. Say so
  # instead, and name the one command that fixes it.
  if [ -f pnpm-lock.yaml ] && grep -q 'bespunky-nx-tools-.*\\.tgz' pnpm-lock.yaml 2>/dev/null; then
    echo '[tools] --local: pnpm-lock.yaml still records the temp tarball path. It is not safe to edit by hand;'
    echo '[tools]   run \`pnpm install\` once the version is published to regenerate it, and do not commit it before then.'
  fi
  echo \"[tools] --local: this project now holds an UNPUBLISHED build of \$_local_tgz.\"
  echo \"[tools]   package.json says $NX_TOOLS_VERSION and node_modules holds that build, but no registry can\"
  echo \"[tools]   resolve it yet. Do not commit the lockfile from this run.\"
  rm -rf \"\$_local_stage\""
  if [ "$HOST" = "wrapper" ]; then
    # The wrapper's manifest is nx.json, and nxw.js compares the pin VERBATIM against its own record in
    # .nx/installation/package.json. So the correction is two writes: the committed pin back to the plain
    # version (a temp-dir file: spec would break every later ./nx), and the wrapper's record to match it — so
    # the next ./nx keeps the build that is installed instead of reinstalling from a registry that cannot
    # resolve it yet. No lockfile to scrub: .nx/installation is gitignored.
    FINALIZE_LOCAL="  $NX_WRAPPER_PIN '@bespunky/nx-tools' '$NX_TOOLS_VERSION'
  node -e \"const fs=require('fs'),f='.nx/installation/package.json';if(fs.existsSync(f)){const j=JSON.parse(fs.readFileSync(f,'utf8'));j.devDependencies=j.devDependencies||{};j.devDependencies['@bespunky/nx-tools']='$NX_TOOLS_VERSION';fs.writeFileSync(f,JSON.stringify(j))}\"
  echo \"[tools] --local: this project now holds an UNPUBLISHED build of \$_local_tgz.\"
  echo \"[tools]   nx.json pins $NX_TOOLS_VERSION and .nx/installation holds that build; a fresh clone cannot\"
  echo \"[tools]   install it until the version is published.\"
  rm -rf \"\$_local_stage\""
  fi
fi

# --- PREFLIGHT: the preconditions that must hold BEFORE the first write ----------------------------------------
# An upgrade's most damaging failures are not bad writes. They are IRREVERSIBLE GIT ACTS performed on a repository
# that was never asked whether it was ready.
#
# `nx migrate --run-migrations --create-commits` stages with `git add -A` and commits onto whatever branch HEAD
# is. So a DIRTY TREE gets welded into a migration commit — this is how one project's in-flight libraries, its
# functions app and its docs ended up inside a commit named after a devcontainer marker file, silently, under a
# run that reported UPGRADE_OK. And on a PROTECTED BRANCH the ladder lands its commits directly on a protected line
# (`development`, `main`, …), which the house branch rules call non-negotiable never to do — performed by the house's own tooling, on the
# user's behalf, without asking.
#
# Upgrade is also the command you run after being away, which is exactly the state where a tree is most likely to
# be dirty and you are least likely to remember what was in it. The command's own use case selects for the
# condition that breaks it.
#
# THE GATE CLASSIFIES; IT NEVER RESOLVES. A shell script cannot know whether the dirty work is related to this
# upgrade, whether a feature package is open, whether a worktree already exists, or what the user said a minute
# ago. The session driving the upgrade knows all of it. So preflight answers exactly one question — is it safe to
# write? — and hands the decision back, in a form an agent can act on:
#
#   refuse  a blocking state with a required fix   (dirty tree, protected branch, detached HEAD, downgrade,
#           an unreadable branch model, --staging with no pre-production stage)
#   signal  a fact the driving session acts on, which blocks nothing by itself ('branch-model: undeclared')
#
# WHICH BRANCHES ARE PROTECTED IS DECLARED, NOT INFERRED. The project's branch model lives in
# .bespunky/branches.json, read through house-branches.sh (its derived `projection` only, from the integration
# line's tip). Declared → its protected lines and release-line globs are refused, and the remedy names its own
# integration line. Undeclared → every name the toolkit ever forced, plus gitflow's, is protected — everything
# protective, nothing assumed. This replaced a heuristic ("a 'development' branch exists, so the house model was
# adopted") that was wrong for every model but one, and right only by accident for projects forced into it.
#
# The undeclared state used to be an ASK ('no-branch-model') for one case: real history on a lone 'main', which
# might be a project that never adopted a model, or one where 'main' IS the working line. That ambiguity is real
# and still not this script's to resolve — but it is no longer resolved by a yes/no about this one run. It is
# resolved by DECLARING the model: the session investigates the repository (bindings, history, shapes) and asks
# the user, through the workflow plugin's branch-and-release skill. So the script reports the absence as a
# SIGNAL, and protects in the meantime. A repo with NO COMMITS gets neither: it is new, and being asked about a
# branch model while creating an empty project would be absurd.
#
# NO OVERRIDE FLAG, deliberately. Every resolution — commit it, stash it, branch and commit there, upgrade on a new
# branch, open a worktree — ends with a clean tree on a working branch. An --allow-dirty would exist for exactly
# one purpose: reproducing the bug this removes.
#
# EVERY CHECK RUNS, THEN ONE VERDICT. Checks append a verdict instead of exiting, so a run that is wrong in three
# ways says so once instead of over three round trips. That is also why the DOWNGRADE refusal now lives here
# rather than inside MIGRATE_PROBE: it was the first precondition and simply had no company. The two checks that
# fire AFTER this gate — an Nx workspace and an nx binary — stay where they are on purpose: the ensured layers may
# create what they check, so they are post-ensure conditions, not pre-write ones, and aggregating them here
# would report a missing nx.json that the run was about to create.
# THE BRANCH MODEL, RESOLVED ONCE PER RUN (house-branches.sh). Two consumers read this one result: the preflight
# (which lines this run may not commit onto) and house-doc (which model the house docs render) — house-doc is
# handed the projection rather than reading the Tree, because the Tree is the working copy, and the working copy
# is not the model in force: its schema may differ from the integration tip's, a branch cut before the declaration
# carries none, and an Nx workspace nested below the git root would look for .bespunky/ in the wrong directory.
# '_bm_projection' is what the planner passes on: the projection JSON (declared), the literal 'undeclared', or
# empty (unreadable — an upgrade has already refused; a standalone house-doc then refuses on the Tree itself).
BRANCH_MODEL_BLOCK="
$HOUSE_BRANCHES_FNS
_bm=\"\$(house_branch_model)\"
_bm_get() { printf '%s\n' \"\$_bm\" | sed -n \"s/^\$1=//p\"; }
_bm_state=\"\$(_bm_get state)\"
case \"\$_bm_state\" in
  declared)   _bm_projection=\"\$(_bm_get projection)\" ;;
  undeclared) _bm_projection='undeclared' ;;
  *)          _bm_projection='' ;;
esac"

PREFLIGHT_CHECKS="
$BRANCH_MODEL_BLOCK
_REFUSE_CODES=''
_REFUSE_TEXT=''
_SIGNAL_TEXT=''
_refuse() {
  _REFUSE_CODES=\"\$_REFUSE_CODES \$1\"
  _REFUSE_TEXT=\"\$_REFUSE_TEXT
\$2\"
}
# A SIGNAL blocks nothing. It is printed whether or not the run is refused, so the session learns the fact either way.
_signal() {
  _SIGNAL_TEXT=\"\$_SIGNAL_TEXT
\$1\"
}
# UNWRITABLE MOUNT POINTS — a directory this run must write into exists but is not this user's to write. The
# classic cause: a devcontainer mounts a named volume at <ws>/node_modules, Docker creates the mount point
# root-owned, and nothing reclaimed it — so the container came up with no dependencies, and this upgrade's own
# install would die on the same EACCES minutes in, leaving a half-run upgrade behind. Unlike
# every other refusal here the fix is not a judgment about the user's work: it is a deterministic ownership fix
# of the project's own mount points, so the verdict carries the exact command.
$HOUSE_MOUNTS_FNS
_um=\"\$(house_unwritable_mounts .)\"
if [ -n \"\$_um\" ]; then
  _um_paths=\"\$(printf '%s\n' \"\$_um\" | cut -d' ' -f1 | paste -sd' ' -)\"
  _um_list=\"\$(printf '%s\n' \"\$_um\" | awk '{printf \"           %-28s owner: %s\\n\", \$1, \$2}')\"
  _um_fix='sudo chown -R \"\$(id -un):\$(id -gn)\" '\"\$_um_paths\"
  _um_pc=\"\$(house_post_create .)\"
  _um_then='then re-run the upgrade.'
  [ -n \"\$_um_pc\" ] && _um_then=\"then re-run the container's post-create (bash \$_um_pc), and re-run the upgrade.\"
  _refuse unwritable-mounts \"[preflight] unwritable-mounts: directories this upgrade must write into are not writable by \$(id -un).
\$_um_list
           A named-volume mount point is created ROOT-OWNED by Docker; unless the container's post-create
           reclaims it, every install into it fails with EACCES — this upgrade's included.
           Fix (the project's own mount points, nothing else):
             \$_um_fix
           \$_um_then\"
fi
# Not a git repository at all: there is no history to damage and no branch to land on, so none of the git
# preconditions have anything to say. Silence here is correct, not a skipped check.
if git rev-parse --git-dir >/dev/null 2>&1; then
  # 'git status --porcelain' rather than three diff invocations: it is the one command that also works in a
  # repository with no commits, where 'git diff --cached' has no HEAD to compare against and errors out.
  # Column 1 is the INDEX status, column 2 the WORKTREE status, '??' is untracked.
  #
  # '-uall' IS LOAD-BEARING, not a detail. By default git COLLAPSES an untracked directory to a single entry,
  # so three new files across two new libraries report as one '?? libs/' — a count of 1 for the work least
  # likely to be reconstructable, which is the exact figure a reader would skim past. '-uall' counts and names
  # the files themselves. The listing is capped below and the true total always printed, so the honesty costs
  # only a bounded amount of output. Ignored paths are excluded either way (porcelain implies
  # --exclude-standard), so this stays proportional to genuinely untracked work.
  _st=\"\$(git status --porcelain -uall 2>/dev/null || true)\"
  if [ -n \"\$_st\" ]; then
    _n_staged=\"\$(printf '%s\n' \"\$_st\" | grep -c '^[MADRCT]' || true)\"
    _n_modified=\"\$(printf '%s\n' \"\$_st\" | grep -c '^.[MDT]' || true)\"
    _n_untracked=\"\$(printf '%s\n' \"\$_st\" | grep -c '^??' || true)\"
    _n_total=\"\$(printf '%s\n' \"\$_st\" | wc -l | tr -d ' ')\"
    # UNTRACKED IS THE ONE THAT MATTERS MOST and the one a reader discounts. 'git add -A' stages untracked
    # files too, so whole new libraries — the work least likely to be recoverable from memory — are swept in
    # exactly like an edited line. Report the three separately so that is impossible to miss.
    _paths=\"\$(printf '%s\n' \"\$_st\" | cut -c4- | head -10 | sed 's/^/           /')\"
    _more=''
    [ \"\$_n_total\" -gt 10 ] && _more=\"
           ... and \$((_n_total - 10)) more\"
    _refuse dirty-tree \"[preflight] dirty-tree: the working tree has uncommitted changes.
           staged=\$_n_staged  modified=\$_n_modified  untracked=\$_n_untracked  (total \$_n_total)
\$_paths\$_more
           The migration ladder runs 'nx migrate --run-migrations --create-commits', which stages with
           'git add -A'. Every path above would be committed under a migration's message, untracked
           directories included.
           Resolve it however suits the work — commit, stash, branch and commit there, or upgrade in a
           worktree — then re-run. This gate does not choose for you.\"
  fi
  # A repository with no commits is NEW, not ambiguous: nothing to protect, no branch model to have adopted,
  # and no history to strand. Every branch question below presupposes a HEAD.
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    _branch=\"\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')\"
    # THE BRANCH MODEL — what is protected here, and whether anyone has said. Resolved once, above the gate
    # (BRANCH_MODEL_BLOCK; see house-branches.sh for which copy is authoritative); this block only acts on it.
    _bm_notes=\"\$(_bm_get note | sed 's/^/           note: /')\"
    [ -n \"\$_bm_notes\" ] && _bm_notes=\"
\$_bm_notes\"
    # THE EFFECTIVE PROTECTED SET, in every state — the resolver's, never rebuilt here from the state word. Rebuilding
    # it ('undeclared' → the fallback names) is how a not-yet-landed declaration's own protected lines were dropped,
    # and an upgrade committed onto a production line the working copy named.
    _bm_protected=\"\$(_bm_get protected)\"
    _bm_patterns=\"\$(_bm_get protectedPatterns)\"
    _bm_shown=\"\$(printf '%s' \"\$_bm_protected \$_bm_patterns\" | sed 's/^ *//; s/ *\$//; s/  */, /g')\"
    # NOT LANDED (undeclared, but the tree carries a declaration): the integration line that copy names — where it
    # must land before it is in force, and so the base every remedy below points at. Empty when nothing is declared.
    _bm_pending=\"\$(_bm_get pending)\"
    if [ -n \"\$_bm_shown\" ]; then _bm_shown_line=\"every branch named \$_bm_shown is protected\"
    else _bm_shown_line='no branch here is protected by name (none of the names it would protect exists)'; fi
    case \"\$_bm_state\" in
      declared)
        _bm_integration=\"\$(_bm_get integration)\"
        _bm_summary=\"\$(_bm_get summary)\"
        _signal \"[preflight] branch-model: declared — \$_bm_summary   (read from \$(_bm_get source))\$_bm_notes\"
        ;;
      unreadable)
        # NO GUESSING past a declaration this toolkit cannot read: an unknown schema major means a newer engine
        # wrote it, and the protected set it encodes is exactly what this run would be guessing at.
        _refuse branch-model-unreadable \"[preflight] branch-model-unreadable: .bespunky/branches.json (read from \$(_bm_get source)) cannot be read with certainty:
           \$(_bm_get reason).
           It decides which branches this upgrade may commit onto, so the run stops rather than guess.
           Update the toolkit (an unknown schema), or repair the declaration through the branch-and-release
           skill's change procedure — never by hand: its projection is derived.\$_bm_notes\"
        ;;
      *)
        if [ -n \"\$_bm_pending\" ]; then
          _signal \"[preflight] branch-model: undeclared (not landed)
           This tree carries a branch model (.bespunky/branches.json) naming '\$_bm_pending' as its integration
           line, but it has not landed on '\$_bm_pending' yet — a declaration is not in force until it does.
           Until then \$_bm_shown_line.
           Land the declaration on '\$_bm_pending' through the bespunky-workflow:branch-and-release skill.\$_bm_notes\"
        else
          _signal \"[preflight] branch-model: undeclared
           This project declares no branch model (.bespunky/branches.json), so nothing here says which lines
           exist or where work lands. Until one is declared, \$_bm_shown_line.
           The model is not this script's to decide: investigate the repository and ASK the user — the
           bespunky-workflow:branch-and-release skill carries the procedure (choosing a branch model).\$_bm_notes\"
        fi
        ;;
    esac
    if [ \"\$_branch\" = 'HEAD' ]; then
      # Detached HEAD: --create-commits would produce commits no branch points at. They are unreachable the
      # moment anything else is checked out, and nothing in the run would say so.
      _refuse detached-head \"[preflight] detached-head: HEAD is not on a branch.
           The migration ladder commits as it goes, and commits made here belong to no branch — they become
           unreachable as soon as anything is checked out.
           Check out a branch (or create one at this commit) and re-run.\"
    else
      # ONE RULE FOR BOTH STATES: is HEAD a protected line? Only the SET differs — the declaration's, or the
      # undeclared fallback. Globs (release/*) are matched with 'case', never expanded against the filesystem.
      _bm_hit=''
      for _n in \$_bm_protected; do [ \"\$_branch\" = \"\$_n\" ] && _bm_hit=\"\$_n\"; done
      set -f
      for _p in \$_bm_patterns; do case \"\$_branch\" in \$_p) _bm_hit=\"\$_p\" ;; esac; done
      set +f
      if [ -n \"\$_bm_hit\" ]; then
        if [ \"\$_bm_state\" = 'declared' ]; then
          _refuse protected-branch \"[preflight] protected-branch: HEAD is on '\$_branch', a protected line ('\$_bm_hit') of this
           project's declared branch model: \$_bm_summary.
           The migration ladder commits onto the current branch, so this run would commit directly onto a
           line that advances only by the model's own landings and promotions.
           Open a worktree off '\$_bm_integration' (the integration line) and upgrade there, then land it like
           any other change: an upgrade is toolkit maintenance, so its changes land on the integration line like
           any work — a fix meant for '\$_branch' itself goes through the branch-and-release skill.\"
        elif [ -n \"\$_bm_pending\" ]; then
          _refuse protected-branch \"[preflight] protected-branch: HEAD is on '\$_branch', protected by this tree's branch model
           (.bespunky/branches.json), which names '\$_bm_pending' as its integration line but has not landed
           there yet — so every branch named \$_bm_shown is protected until it does.
           The migration ladder commits onto the current branch, so this run would commit directly onto a
           protected line. Land the declaration on '\$_bm_pending' first (the branch-and-release skill), then
           open a worktree off '\$_bm_pending' and upgrade there.\"
        else
          _refuse protected-branch \"[preflight] protected-branch: HEAD is on '\$_branch', and this project declares no branch model —
           so every branch named \$_bm_shown is protected until it does.
           The migration ladder commits onto the current branch; with no model, nothing says whether
           '\$_branch' is where work happens or the production line, and landing a stack of commits on the
           latter cannot be taken back. Open a worktree off '\$_branch' and upgrade there; where it lands waits
           for the model (see 'branch-model: undeclared').\"
        fi
      fi
    fi
    # --staging scaffolds an environment bundle meant to deploy from a PRE-PRODUCTION stage. A declared model with
    # none (trunk, two-line, gitflow, maintained releases) has nothing for it to bind to, and the bundle would document a
    # deploy line the project does not have. Undeclared → no basis to refuse on; the bundle behaves as it always has.
    if [ '$STAGING' = '1' ] && [ \"\$_bm_state\" = 'declared' ] && [ -z \"\$(_bm_get preproduction)\" ]; then
      _refuse staging-without-stage \"[preflight] staging-without-stage: --staging adds a staging environment bundle, deployed from a
           pre-production stage — and this project's declared branch model has none: \$_bm_summary.
           Either drop --staging, or add a pre-production stage to the model first (the branch-and-release
           skill's change procedure: verify, risks, confirm), then re-run.\"
    fi
  fi
fi
# PROJECT FACTS the generators would otherwise trip on mid-run, after the migrations committed: a Node the house cannot
# resolve or build an image for, an Angular the firebase client cannot pair @angular/fire with. house-probe.mts reads
# them with the payload's OWN pure modules (the same code the generators throw from), so the two cannot disagree. It
# only reads; each line it prints is one refusal: <code><TAB><text, \\n-escaped>.
_probe_out=\"\$(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \"\$HOUSE_ENGINE_ROOT/house-probe.mts\" --ensure='$ENSURE_LAYERS' --evident='$EVIDENT')\" \\
  || _refuse probe-failed \"[preflight] probe-failed: the project-facts probe (house-probe.mts) did not run — see its error above.\"
while IFS=\"\$(printf '\\t')\" read -r _probe_code _probe_text; do
  [ -n \"\$_probe_code\" ] && _refuse \"\$_probe_code\" \"\$(printf '%b' \"\$_probe_text\")\"
done <<_HOUSE_PROBE_
\$_probe_out
_HOUSE_PROBE_"

# The single verdict. Runs AFTER MIGRATE_PROBE so the report can name the ladder that would have run — the
# probe writes nothing, it only reads node_modules and HOUSE.md, so composing the full picture first costs
# nothing and tells the reader what they are being stopped from doing.
#
# The FIRST LINE IS THE CONTRACT: one token plus space-separated codes, in the same vocabulary as UPGRADE_OK and
# UPGRADE_PARTIAL, so the /bespunky-house:upgrade command can branch on it without parsing prose. The human detail follows.
PREFLIGHT_VERDICT="
if [ -n \"\$_REFUSE_CODES\" ]; then
  echo \"UPGRADE_REFUSED:\$_REFUSE_CODES\" >&2
  echo '[preflight] NOTHING HAS BEEN WRITTEN — the project is exactly as it was.' >&2
  if [ -n \"\$MIGRATE_FROM\" ]; then
    echo \"[preflight] This run would have migrated \$MIGRATE_FROM -> $NX_TOOLS_VERSION.\" >&2
  fi
  echo \"\$_REFUSE_TEXT\" >&2
  [ -n \"\$_SIGNAL_TEXT\" ] && echo \"\$_SIGNAL_TEXT\" >&2
  _stage refused
  exit 1
elif [ -n \"\$_SIGNAL_TEXT\" ]; then
  echo \"\$_SIGNAL_TEXT\" >&2
fi"

# --- run the house MIGRATIONS (upgrade mode) ---------------------------------------------------------------------
# Versioned one-way deltas, collected and ordered by `nx migrate`. This is what replaced convergence: a
# generator no longer has to recognise every shape the toolkit ever produced, because each one-way change
# ships as a migration keyed to the version that introduced it.
#
# This runs in two parts around the install, and the split is the whole design:
#
#   MIGRATE_PROBE  (before the install) — works out WHERE THE PROJECT ACTUALLY IS, while node_modules still
#                  holds what the project had. Once the install runs, that evidence is gone.
#   MIGRATE_RUN    (after the install)  — collects and runs the ladder, passing the probed version as an
#                  EXPLICIT `--from`.
#
# The explicit `--from` is what makes this correct, and it replaces an earlier version of this block that
# relied on ordering alone. Left to itself, `nx migrate` infers the range from the version resolved out of
# node_modules — and that version lies in the single most common case in the wild: every project scaffolded
# before this release declares a CARET range, so an ordinary `yarn install` floats node_modules to the newest
# published minor without a single migration having run. Migrate would then read the target as where the
# project already is, collect nothing, report success, and house-doc would stamp the project as current —
# closing the gap over permanently and unrecoverably. So we do not ask node_modules where the project is; we
# take the OLDER of what is installed and what HOUSE.md was last stamped with. The stamp records the last
# version whose migrations were actually applied, which is the honest floor.
#
# Only meaningful when the toolkit has been installed here before. A project that has never had it has no
# version to migrate FROM; that is the baseline case, and the plain install is the whole of it.
#
# The flags are each load-bearing:
#   NX_MIGRATE_USE_LOCAL  — without it `nx migrate` installs nx@latest into a temp dir and re-execs itself,
#                           twice, per run. We are migrating our own package, not Nx.
#   --from=<pkg>@<ver>    — see above. Never inferred.
#   --if-exists           — `nx migrate` writes migrations.json ONLY when something is eligible, and
#                           --run-migrations without this THROWS when the file is absent. Nothing to migrate
#                           is the common case, and it must not be an error.
#   --agentic=false       — run from an agent session, migrate detects the agent and DEFERS prompt-bearing
#                           migrations instead of running them. House migrations are always deterministic.
#   NX_MIGRATE_SKIP_INSTALL — the install already happened, immediately above, so the INITIAL reinstall that
#                           --run-migrations would otherwise do is pure waste (and under --local it would
#                           reinstall from a manifest naming an unpublished version). Scoped precisely: in
#                           nx 23 this env var gates only that first install. A migration that CHANGES root
#                           dependencies still triggers a real install afterwards, through a separate path
#                           that takes the --skipInstall flag rather than this variable — deliberately not
#                           passed, because a dependency a migration added has to actually be installed.
#   rm -f migrations.json — Nx never deletes it. Left behind, the next upgrade re-executes the same ladder
#                           against an already-migrated tree, and it litters the project besides.
MIGRATE_PROBE="
_installed=''
[ -f $NXT_DIR/package.json ] \\
  && _installed=\"\$(node -p \"require('./$NXT_DIR/package.json').version\" 2>/dev/null || echo '')\"
# ANCHORED on the stamp marker, not on a bare 'nx-tools=' anywhere in the file. HOUSE.md is prose, and an
# unanchored match takes the FIRST hit in the document — so a sentence like 'pin @bespunky/nx-tools=9.9.9'
# in the guidance above the stamp becomes the project's recorded version, and the downgrade guard below then
# hard-refuses a perfectly ordinary upgrade. The hook reads the same stamp and anchors it this way too.
_stamped=\"\$(grep -o '@bespunky/house-tooling:stamp[^>]*' HOUSE.md 2>/dev/null | head -1 \\
  | grep -o 'nx-tools=[0-9][0-9A-Za-z.+_-]*' | head -1 | cut -d= -f2)\"
# Version ordering, and it is worth doing properly because BOTH the migration floor and the downgrade
# refusal hang off it — get it wrong in one direction and migrations are skipped, in the other and a valid
# upgrade is hard-refused.
#
# \`sort -V\` is not the tool. It places 0.24.0-rc.1 AFTER 0.24.0 (the opposite of semver, so an rc stamp
# reads as a phantom downgrade), it orders 1.2 before 1.2.0 (they are the same version), it treats
# 1.0.0+build as distinct from 1.0.0 (build metadata carries no precedence), and it sorts a non-numeric
# string ABOVE every number — so one hand-mangled character in a HOUSE.md stamp refuses every future upgrade.
# All four were reproduced against the previous implementation.
#
# So: compare the leading numeric segments numerically, padded to three, ignoring anything after them; then
# break a tie on prerelease presence (a prerelease is BELOW its own release — an rc has not had the
# release's migrations run against it). Node does the parsing because node is already a hard requirement
# here and this is not worth hand-rolling in sh a second time. Anything unparseable degrades to 'equal',
# which makes the upgrade a no-op for that comparison rather than a refusal: refusing on garbage would block
# a user over a typo they cannot see.
# The same ordering is implemented in the toolkit's tools/check-release-invariants/rules.cjs, which
# guards releases there. This copy exists because house.sh runs in CONSUMER projects, where that
# module does not exist. IF YOU CHANGE THE ORDERING HERE, CHANGE IT THERE TOO.
_vlt() {
  node -e \"
    const core=v=>{const m=String(v).match(/^[0-9]+(\\.[0-9]+)*/);const n=(m?m[0]:'').split('.').filter(s=>s!=='').map(Number);while(n.length<3)n.push(0);return n};
    const isPre=v=>/^[^+]*-/.test(String(v));
    const a=process.argv[1],b=process.argv[2];
    if(a===b)process.exit(1);
    const x=core(a),y=core(b);
    for(let i=0;i<3;i++){if(x[i]!==y[i])process.exit(x[i]<y[i]?0:1)}
    if(isPre(a)!==isPre(b))process.exit(isPre(a)?0:1);
    process.exit(1);
  \" \"\$1\" \"\$2\"
}
# REJECT AT THE SOURCE, not in the comparator. An unparseable version must be treated as ABSENT, because
# the alternative is worse than either extreme: \`_vmin abc 0.24.3\` returns 'abc', that becomes the migration
# floor, and nx normalises an unparseable --from to 0.0.0 — so a single mangled character in a committed
# HOUSE.md silently re-runs the ENTIRE ladder against an already-migrated tree. Absent is a state this block
# already handles correctly and loudly; garbage is not. Say so when it happens, because a malformed stamp is
# a real problem the user wants to know about rather than something to paper over.
_vok() { case \"\$1\" in ''|*[!0-9A-Za-z.+-]*) return 1 ;; esac; case \"\$1\" in [0-9]*.[0-9]*) return 0 ;; esac; return 1; }
_vmin() { if _vlt \"\$1\" \"\$2\"; then printf '%s' \"\$1\"; else printf '%s' \"\$2\"; fi; }
_vmax() { if _vlt \"\$1\" \"\$2\"; then printf '%s' \"\$2\"; else printf '%s' \"\$1\"; fi; }

# TWO DIFFERENT QUESTIONS, TWO DIFFERENT COMPARISONS — and conflating them silently breaks one of them.
#
#   Where do we migrate FROM?  The OLDER of the two sources. Whatever either claims, a migration that has
#                              not demonstrably run still needs to run, and the older figure is the only
#                              one we can be sure about.
#   Is this a DOWNGRADE?       The NEWER of the two. If ANY evidence says this project has already been at
#                              a version above this checkout, upgrading moves it backwards.
#
# Taking the min for both looks tidy and quietly disables the downgrade guard: a project stamped 0.99.0 with
# 0.24.2 still in node_modules has min = 0.24.2, which compares equal to a 0.24.2 target, so the guard never
# fires — and the upgrade then re-stamps HOUSE.md from 0.99.0 down, destroying the only record that the newer
# migrations ever ran.
#
# EITHER SOURCE ALONE IS ENOUGH. Gating this on node_modules being populated is the same mistake one level
# up: a project whose node_modules was pruned, or never installed after a clone, still has its HOUSE.md
# stamp — and that stamp is the record of which migrations have actually been applied. Reading only the
# installed version there yields 'nothing to migrate from', skips the entire ladder, and then stamps the
# project as current: the gap closed over permanently, which is the exact outcome this block exists to
# prevent. Baseline means BOTH are absent — the toolkit has genuinely never been here.
#
# The probe DECIDES here but ANNOUNCES later. Everything below still has to pass: the downgrade refusal a few
# lines down, and then the two hard preconditions (an Nx workspace, an nx binary). Printing 'migrating from
# the stamp' here meant the run could announce a migration and then refuse to perform one — and since the
# /bespunky-house:upgrade command instructs Claude to treat the [migrate] line as the most consequential thing the upgrade prints,
# that became a model confidently reporting a ladder that never ran. So the note is composed here, where the
# facts are, and emitted by MIGRATE_RUN, where the migration actually happens.
if [ -n \"\$_installed\" ] && ! _vok \"\$_installed\"; then
  echo \"[migrate] WARNING: node_modules/@bespunky/nx-tools declares an unreadable version (\$_installed) — ignoring it.\" >&2
  _installed=''
fi
if [ -n \"\$_stamped\" ] && ! _vok \"\$_stamped\"; then
  echo \"[migrate] WARNING: HOUSE.md's stamp is not a readable version (\$_stamped) — ignoring it. Fix the stamp\" >&2
  echo \"[migrate]   line in HOUSE.md, or re-run the upgrade once to have it rewritten.\" >&2
  _stamped=''
fi
# HOUSE.md WITHOUT A STAMP IS NOT A BASELINE — it is a project from before stamping existed.
#
# HOUSE.md is generator-owned and has existed since nx-tools 0.5.0; the stamp line only since 0.9.1. And the
# scaffolder of that era COPIED the package into node_modules instead of declaring it, so such a project has
# no resolved version either. Both sources absent therefore has two very different meanings, and reading it
# as 'the toolkit has never been here' is the dangerous one: the ladder is skipped, the generators (which no
# longer heal anything) rewrite firebase.config.ts over the only copy of the production credentials, the
# legacy targets and the pre-toggle environment files are left in place, and house-doc then stamps the
# project CURRENT — so no later upgrade will ever migrate it either. One silent run, unrecoverable.
#
# The presence of HOUSE.md is proof the toolkit HAS been applied. So: no stamp but a HOUSE.md means an
# unknown pre-stamping version, and the honest floor is the bottom. 0.0.0 is exact semver, so nx takes it at
# face value and collects the whole ladder rather than resolving it as a range against the registry.
if [ -z \"\$_stamped\" ] && [ -z \"\$_installed\" ] && [ -f HOUSE.md ]; then
  _stamped='0.0.0'
  echo '[migrate] HOUSE.md is present but carries no version stamp — this project predates house stamping.'
  echo '[migrate]   Treating it as the oldest possible state and running the full migration ladder.'
fi
MIGRATE_FROM=''
MIGRATE_NOTE=''
_highest=''
if [ -n \"\$_installed\" ] && [ -n \"\$_stamped\" ]; then
  MIGRATE_FROM=\"\$(_vmin \"\$_installed\" \"\$_stamped\")\"
  _highest=\"\$(_vmax \"\$_installed\" \"\$_stamped\")\"
  [ \"\$_stamped\" != \"\$_installed\" ] \\
    && MIGRATE_NOTE=\"[migrate] installed=\$_installed, HOUSE.md stamp=\$_stamped — migrating from the older of the two (\$MIGRATE_FROM)\"
elif [ -n \"\$_installed\" ]; then
  MIGRATE_FROM=\"\$_installed\"; _highest=\"\$_installed\"
elif [ -n \"\$_stamped\" ]; then
  MIGRATE_FROM=\"\$_stamped\"; _highest=\"\$_stamped\"
  MIGRATE_NOTE=\"[migrate] @bespunky/nx-tools is not in node_modules, but HOUSE.md is stamped \$_stamped — migrating from the stamp\"
fi
# ORDER THEM, DON'T JUST DIFF THEM. A project AHEAD of this checkout is an ordinary state — a teammate
# upgraded from a newer toolkit — and it is not staleness. Treating it as staleness would install a DOWNGRADE,
# run the older generators over the newer shape, and re-stamp HOUSE.md to the older version, recording a
# state nothing ever migrated back down to. Migrations do not walk backwards, so there is no repair path
# either. Refuse before anything is written.
#
# This registers a PREFLIGHT verdict rather than exiting on the spot. It was the first pre-write precondition
# and for a long time the only one, so an inline 'exit 1' was indistinguishable from a gate; now that a dirty
# tree, a protected branch and a detached HEAD are checked alongside it, exiting here would report one blocker
# and hide the rest — three round trips for a run that is wrong in three ways. Nothing between here and
# PREFLIGHT_VERDICT writes anything, so deferring the exit costs nothing.
if [ -n \"\$_highest\" ] && [ \"\$_highest\" != '$NX_TOOLS_VERSION' ] && _vlt '$NX_TOOLS_VERSION' \"\$_highest\"; then
  _refuse downgrade \"[preflight] downgrade: this project is on house tooling \$_highest, which is NEWER than
           this checkout's $NX_TOOLS_VERSION (installed=\${_installed:-none}, HOUSE.md stamp=\${_stamped:-none}).
           Upgrading would install an older payload, run older generators over the newer shape, and re-stamp
           HOUSE.md downwards. Migrations do not walk backwards, so there is no repair path.
           Update your toolkit first, then upgrade:  claude plugin marketplace update claude-toolkit\"
fi"

# Two collection strategies, chosen at render time because --local is known then. The PUBLISHED path is
# entirely native: `nx migrate` fetches the target's migrations from the registry and does its own
# collection, ordering and reporting. That is the path every consumer takes, so it is the one that must be
# native rather than reimplemented.
if [ "$LOCAL_TOOLS" = "1" ]; then
  # --local cannot use that: `nx migrate <pkg>@<ver>` resolves the target FROM THE REGISTRY, and the whole
  # point of --local is a version that is not published yet — it 404s. So collect from the package we just
  # installed, whose own migrations.json is the same file that would have been fetched, and hand the result
  # to the same `--run-migrations` runner. Only the collection differs; ordering and execution stay Nx's.
  #
  # Worth being honest about: this means --local exercises a DIFFERENT collection path from production. It
  # proves a migration's BEHAVIOUR, not that the published range selection works. For that, publish.
  MIGRATE_COLLECT="  node -e \"const fs=require('fs'),m=require('./$NXT_DIR/migrations.json');
  const from=process.argv[1],to=process.argv[2];
  const p=v=>String(v).split('-')[0].split('.').map(Number);
  // Also mirrors tools/check-release-invariants/rules.cjs in the toolkit repo (see _vlt above).
  // Prerelease handling must AGREE with the shell comparator in MIGRATE_PROBE, or the two halves of the
  // same decision disagree. Comparing release cores alone makes 0.24.0-rc.1 equal to 0.24.0, which drops
  // every 0.24.0 migration from a range starting at that rc — exactly the ones an rc has not had run.
  const pre=v=>/^[^+]*-/.test(String(v));
  const c=(a,b)=>{const x=p(a),y=p(b);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)<(y[i]||0)?-1:1}
    if(pre(a)!==pre(b))return pre(a)?-1:1; return 0};
  const out=Object.entries(m.generators||{}).filter(([,g])=>g.version&&c(g.version,from)>0&&c(g.version,to)<=0)
    .sort((a,b)=>c(a[1].version,b[1].version))
    .map(([name,g])=>({version:g.version,layer:g.layer,description:g.description,implementation:g.implementation,package:'@bespunky/nx-tools',name}));
  if(out.length)fs.writeFileSync('migrations.json',JSON.stringify({migrations:out},null,2)+'\\n');
  console.log('[migrate] --local: collected '+out.length+' migration(s) from the working tree')\" \"\$MIGRATE_FROM\" '$NX_TOOLS_VERSION'"
else
  MIGRATE_COLLECT="  NX_MIGRATE_USE_LOCAL=true $NX_RUN migrate '@bespunky/nx-tools@$NX_TOOLS_VERSION' --from=\"@bespunky/nx-tools@\$MIGRATE_FROM\""
fi

MIGRATE_RUN="
if [ -z \"\$MIGRATE_FROM\" ]; then
  echo '[migrate] @bespunky/nx-tools was not installed here before this run — baseline, nothing to migrate from'
elif [ \"\$MIGRATE_FROM\" = '$NX_TOOLS_VERSION' ]; then
  echo \"[migrate] house tooling already at \$MIGRATE_FROM — no migrations to run\"
else
  [ -n \"\$MIGRATE_NOTE\" ] && echo \"\$MIGRATE_NOTE\"
  echo \"[migrate] house tooling \$MIGRATE_FROM -> $NX_TOOLS_VERSION\"
  # --create-commits gives ONE COMMIT PER MIGRATION, which is the difference between a reviewable ladder and
  # a single unreadable blob. An upgrade can apply many one-way deltas across every project in the workspace at
  # once; landing them as one diff makes \`git log -p\` useless exactly where it matters most, and reverting a
  # single bad migration impossible without unpicking it by hand. The pre-upgrade HEAD is the blunt undo for the
  # whole run; these commits are the fine-grained one.
  #
  # Two things Nx's implementation forces us to handle rather than pass the flag blindly:
  #   1. It is a HARD ERROR outside a git repo ('--create-commits requires a git repository'). An upgrade
  #      normally cannot reach here without git, because the restore-point check aborts first — but --no-backup skips
  #      that, and then this would kill an otherwise fine run over a bookkeeping nicety. Detect and drop it.
  #   2. Every commit is built with \`git add -A\`, so whatever is uncommitted when the ladder starts is
  #      committed too — into a dedicated 'checkpoint before running migrations' commit that Nx makes before
  #      the first migration. Preflight has already refused a dirty tree, so that is only ever THIS RUN's own
  #      work so far (the floor, the toolkit install), and the note below says exactly that.
  #   3. That same \`git add -A\` will happily commit node_modules on a repo that does not ignore it — which
  #      is a live case, because add-layer agent exists to retrofit repos of any shape. Thousands of vendored
  #      files landing in someone's history as a side effect of a version bump is far worse than losing the
  #      per-migration granularity, so check first and drop the flag rather than the repo's history.
  _do_commits=0
  if git rev-parse --git-dir >/dev/null 2>&1; then
    # NO COMMITTER IDENTITY = NO COMMITS, and Nx does not treat that as fatal: it reports that it could not
    # create the checkpoint commit, prints a git fatal per migration, and carries on -- after which this
    # script prints UPGRADE_OK. The migrations are applied and stamped, but the commit ladder the user was
    # promised is simply absent and the work is left as a pile of dirty files with a half-staged index.
    # Check first and say so, the same way the node_modules case does, rather than advertising a safety net
    # that will not appear.
    if ! git config user.email >/dev/null 2>&1 || ! git config user.name >/dev/null 2>&1; then
      echo '[migrate] this repository has no git user.name/user.email, so commits cannot be created —'
      echo '[migrate]   running the migrations WITHOUT the per-migration commit ladder. Set an identity'
      echo '[migrate]   with git config user.email to get it.'
    elif [ -d $VENDOR_DIR ] && ! git check-ignore -q $VENDOR_DIR 2>/dev/null; then
      echo '[migrate] $VENDOR_DIR is NOT git-ignored here, and per-migration commits are built with'
      echo '[migrate]   \"git add -A\" — which would commit it. Running the migrations WITHOUT commits.'
      echo '[migrate]   Add $VENDOR_DIR to .gitignore to get the per-migration commit ladder.'
    else
      _do_commits=1
      # Keep our own scratch file out of that checkpoint commit. Nx writes migrations.json at the workspace
      # root, commits it as part of \`git add -A\`, and we delete it afterwards — which leaves the project
      # with a committed-then-deleted file staged for no reason anyone reading the log could reconstruct.
      # .git/info/exclude is the right home for this: per-clone, never committed, and invisible to the
      # project's own .gitignore, so we are not editing a file the repo owns.
      # --git-common-dir, NOT --git-dir. Git reads info/exclude from the COMMON directory, and in a linked
      # worktree those two differ: --git-dir gives .git/worktrees/<name>, so the entry lands somewhere git
      # never looks and the exclude silently does nothing. That is not a corner case here — the house dev
      # loop is worktree-based, so it would be the normal path. They are the same directory in a plain clone
      # and in a submodule, so asking for the common one is right everywhere.
      _gitdir=\"\$(git rev-parse --git-common-dir 2>/dev/null || true)\"
      if [ -n \"\$_gitdir\" ] && mkdir -p \"\$_gitdir/info\" 2>/dev/null; then
        # Append-safe: a file whose last line has no trailing newline would otherwise have our entry glued
        # onto the end of the user's last rule, destroying that rule AND failing to exclude anything. Add
        # the missing newline first when the file is non-empty and does not end in one.
        _ex=\"\$_gitdir/info/exclude\"
        if ! grep -qxF '/migrations.json' \"\$_ex\" 2>/dev/null; then
          if [ -s \"\$_ex\" ] && [ \"\$(tail -c1 \"\$_ex\" | wc -l)\" -eq 0 ]; then printf '\\n' >> \"\$_ex\" 2>/dev/null || true; fi
          echo '/migrations.json' >> \"\$_ex\" 2>/dev/null || true
        fi
      fi
      # The tree was clean when preflight passed, so any change here is THIS run's own: the floor and the
      # toolkit install. Saying the tree has uncommitted changes, with a pointer to a backup, described the
      # user's work on every migrating upgrade of a clean tree when the dirt was the upgrade's own.
      if [ -n \"\$(git status --porcelain 2>/dev/null)\" ]; then
        echo '[migrate] the toolkit install this run just made is committed first, in the checkpoint commit Nx'
        echo '[migrate]   makes before the first migration.'
      fi
    fi
  else
    echo '[migrate] not a git repository — running migrations without per-migration commits'
  fi
  rm -f migrations.json
$MIGRATE_COLLECT
  # POST-CONDITION, and it is the reason this step cannot fail silently.
  #
  # The collect above writes migrations.json only when something is eligible; --run-migrations then
  # consumes it. --if-exists makes an ABSENT file a no-op, which is right for the ordinary case (nothing
  # to migrate) and catastrophic for the other one: if the file was written and then disappeared, the
  # ladder is skipped, nothing says so, and house-doc stamps the project as migrated. So count what was
  # collected, and refuse to continue if that count cannot be accounted for. Refusing here is the whole
  # point -- a stamped-but-unmigrated project is unrecoverable, while a failed upgrade is just a re-run.
  _expected=0
  if [ -f migrations.json ]; then
    _expected=\"\$(node -p '(JSON.parse(require(\"fs\").readFileSync(\"migrations.json\",\"utf8\")).migrations||[]).length' 2>/dev/null || echo 0)\"
  fi
  case \"\$_expected\" in ''|*[!0-9]*) _expected=0 ;; esac
  if [ \"\$_expected\" -gt 0 ]; then
    echo \"[migrate] \$_expected migration(s) to apply.\"
  else
    echo '[migrate] nothing eligible in that range — no migrations to apply.'
  fi
  # NO --commit-prefix, deliberately, and Nx's default is used instead. Any prefix worth reading contains a
  # space, and the package-manager wrapper does not preserve one: yarn re-quotes its arguments through
  # /bin/sh, so a quoted value survives as far as the wrapper and is then word-split. A conventional-commit
  # scope also dies outright there, on the open paren. Both failures are silent in the useful direction --
  # the migrations still run, and the commits are simply mis-titled -- which is the worst kind. Nx applies
  # its own default internally, where no shell is involved, so it cannot be mangled at all.
  #
  # NOTE TO ANYONE EDITING THIS BLOCK: every line here, comments included, lives inside a double-quoted
  # shell string that is executed later. Backticks are COMMAND SUBSTITUTION even in a comment, and so is
  # an unescaped dollar-paren. Prose about a flag has to be written without either.
  if [ \"\$_do_commits\" = '1' ]; then
    NX_MIGRATE_SKIP_INSTALL=true NX_MIGRATE_USE_LOCAL=true $NX_RUN migrate --run-migrations --if-exists --agentic=false --create-commits
  else
    NX_MIGRATE_SKIP_INSTALL=true NX_MIGRATE_USE_LOCAL=true $NX_RUN migrate --run-migrations --if-exists --agentic=false
  fi
  # nx never deletes migrations.json — it only ever writes it. So if it is gone now, something else
  # removed it mid-run (a concurrent upgrade is the way this actually happens), and --if-exists will have
  # quietly applied nothing. Stop BEFORE house-doc writes a stamp that would make this permanent.
  if [ \"\$_expected\" -gt 0 ] && [ ! -f migrations.json ]; then
    echo 'ERROR: the migration list disappeared while it was being applied, so the ladder did NOT run.' >&2
    echo '       This is what two upgrades running at once does. Nothing has been stamped, so the project' >&2
    echo '       is still in its previous state — re-run the upgrade once nothing else is touching it.' >&2
    exit 1
  fi
  rm -f migrations.json
fi"

# --- lay the Nx FLOOR on a repo that has none (always ensured) ---
# `nx init` is the Nx-native answer to "make this existing repo an Nx workspace" — as opposed to
# create-nx-workspace, which is greenfield-only and is what the scaffold path uses. It is what makes every
# layer above reachable in a repo that was never scaffolded by this tool, and it now runs on ANY upgrade of a repo
# without nx.json: the floor is always ensured, everything above it stays opt-in.
#
# HOW depends on the host (see HOST above):
#   node     the repo has a package.json — `nx init` into node_modules, the package manager declared first.
#   wrapper  it has none — `nx init --useDotNxInstallation`: nx.json + ./nx + .nx/nxw.js, nothing that makes the
#            repo a Node project. (The node path used to SEED a package.json here to dodge the wrapper; that
#            turned every Python and Go repo into a Node project for the sake of the tooling, and the reason
#            it was needed — devkit plugins unresolvable under the wrapper — no longer holds on Nx 23.)
#
# `nx init` is also a polite co-owner — it MERGES into an existing .claude/settings.json and its CLAUDE.md
# marker block coexists with the house pointer — so this is safe to run in a repo with prior Claude setup.
# Agent mode is stripped for the one command, as for create-nx-workspace below, and its own AI-agent setup is
# declined: the house configures Claude itself. The one thing it decides that we override: defaultBase master.
NX_DEFAULT_BASE_FIX="node -e \"const f='nx.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));if(j.defaultBase==='master'){j.defaultBase='main';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\\\\n');console.log('[layers] ensure nx: defaultBase master -> main')}\" || true"
if [ "$HOST" = "wrapper" ]; then
  NX_INIT_BLOCK="
if [ ! -f nx.json ]; then
  echo '[layers] ensure nx: no nx.json and no package.json — initialising Nx through its wrapper, no Node project created'
  env -u CLAUDECODE -u OPENCODE npx --yes nx@latest init --useDotNxInstallation=true --interactive=false --aiAgents=none --plugins=skip
  $NX_DEFAULT_BASE_FIX
fi"
else
  NX_INIT_BLOCK="
if [ ! -f nx.json ]; then
  echo '[layers] ensure nx: no nx.json — initialising an Nx workspace in place'
  # DECLARE THE PACKAGE MANAGER BEFORE nx init RUNS, when the repo has not declared one itself.
  #
  # nx init picks its own — npm, absent any lockfile — and takes no flag to say otherwise. So on a repo with no
  # lockfile at all, it would create package-lock.json while everything downstream here used the detected
  # default, leaving TWO lockfiles that disagree: exactly the state this script refuses to inflict on an npm or
  # pnpm project, arrived at from the other direction. An empty lockfile is the signal Nx reads, so writing one
  # first makes nx init agree with us instead of us discovering it did not.
  #
  # Only ever in the genuinely-no-signal case. A repo with any lockfile, or a packageManager field, has already
  # decided, and the detected package manager is that decision.
  if [ ! -f yarn.lock ] && [ ! -f package-lock.json ] && [ ! -f pnpm-lock.yaml ]; then
    echo '[layers] ensure nx: no lockfile — declaring $PM (the house default) so nx init agrees with the rest of this run'
    case '$PM' in
      yarn) : > yarn.lock ;;
      pnpm) : > pnpm-lock.yaml ;;
      npm)  : ;;
    esac
  fi
  env -u CLAUDECODE -u OPENCODE npx --yes nx@latest init --useDotNxInstallation=false --no-interactive
  [ -x node_modules/.bin/nx ] || $PM_INSTALL
  $NX_DEFAULT_BASE_FIX
fi"
fi

# --- the workspace's own Nx has to be runnable before anything migrates or generates ---
# It routinely is not — a fresh clone has no node_modules (or no .nx/installation) at all — and this used to exit
# telling the human to run the install by hand and start over: a whole round trip to type a command this script
# runs of its own accord. So install, then re-check. Placed AFTER the preflight verdict on purpose: an install
# is a write, and every refusal promises nothing was written before it fired.
if [ "$HOST" = "wrapper" ]; then
  NX_RUNTIME_BLOCK="
if [ ! -f .nx/nxw.js ]; then
  echo 'ERROR: nx.json is here, but neither a package.json nor the Nx wrapper (.nx/nxw.js) — there is no Nx' >&2
  echo '       this upgrade can run. Restore the wrapper (npx nx@latest init --useDotNxInstallation) or add a' >&2
  echo '       package.json with nx as a devDependency, then re-run.' >&2
  exit 1
fi
_stage install
# The wrapper installs .nx/installation to match nx.json on its first invocation.
./nx --version >/dev/null"
else
  NX_RUNTIME_BLOCK="
if [ ! -x node_modules/.bin/nx ]; then
  _stage install
  echo '[install] node_modules/.bin/nx is missing — installing the workspace dependencies first.'
  $PM_INSTALL || {
    echo \"ERROR: '$PM_INSTALL' failed, so the workspace has no nx to migrate or generate with.\" >&2
    echo '       Fix the install (network? lockfile? package manager?) and re-run the upgrade.' >&2
    exit 1
  }
fi
if [ ! -x node_modules/.bin/nx ]; then
  echo \"ERROR: node_modules/.bin/nx still not found after '$PM_INSTALL'.\" >&2
  echo '       This workspace has an nx.json but does not depend on nx — add it as a devDependency' >&2
  echo '       (nx add is not available yet), then re-run the upgrade.' >&2
  exit 1
fi"
fi

# @nx/devkit is part of the MECHANISM FLOOR — every house generator imports it, and so does the layer registry.
# A workspace created by create-nx-workspace + nx add @nx/angular gets it transitively; a workspace produced by
# nx init gets nx and NOTHING ELSE. So it is asserted for every node-hosted path rather than assumed from the shape
# the scaffolder happens to produce, pinned to the installed nx version. (The wrapper pins it in nx.json beside
# @bespunky/nx-tools, at install time — see INSTALL_NX_TOOLS.)
DEVKIT_BLOCK=""
if [ "$HOST" = "node" ]; then
  DEVKIT_BLOCK="
if ! node -e \"require.resolve('@nx/devkit')\" >/dev/null 2>&1; then
  _nxv=\"\$(node -p \"require('nx/package.json').version\" 2>/dev/null || echo latest)\"
  echo \"[layers] @nx/devkit missing (an nx init workspace ships only nx) — installing @nx/devkit@\$_nxv\"
  _pm_add_dev $PM \"@nx/devkit@\$_nxv\"
fi"
fi

# --- the RESTORE POINT, decided before anything runs — and READ, never made -----------------------------------
# An upgrade REWRITES files on two counts: the generators regenerate what they own outright (firebase.config.ts, for
# one), and the MIGRATIONS apply one-way deltas with no reverse. So it must start from a point it can be undone to.
#
# PREFLIGHT MAKES THAT POINT FREE. It refuses a dirty tree, so every upgrade that runs at all starts from a clean one,
# and then HEAD already is the pre-upgrade state. The tag this used to build through a throwaway index existed for the
# dirty case — which preflight now refuses — and it was built BEFORE preflight ran, so a refused upgrade had already
# written a tag (and the advice printed on failure, reset --hard to that tag, put a synthetic WIP commit onto the
# user's branch). Reading HEAD writes nothing, so a refusal stays the "nothing has been written" it claims to be.
#
#   UPGRADE_BASE    a diffable commit for UPGRADE_NEXT; the EMPTY TREE for a repository with no commits yet, which is
#                exactly what was there.
#   RESTORE_SHA  the commit a failed run is restored to; empty when there is none.
#   BACKUP_REF   the same, as display text for the summary lines.
BACKUP_REF="(--no-backup)"
RESTORE_SHA=""
UPGRADE_BASE=""
RESTORE_BLOCK=""
if [ "$MODE" = "upgrade" ]; then
  if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if RESTORE_SHA="$(git -C "$TARGET" rev-parse --verify -q HEAD 2>/dev/null)"; then
      BACKUP_REF="HEAD(${RESTORE_SHA:0:7})"
      UPGRADE_BASE="$RESTORE_SHA"
      # Printed by the PROGRAM, after the preflight verdict: a refused run has no restore point to announce.
      RESTORE_BLOCK="
echo 'BACKUP_OK: working tree clean — the pre-upgrade restore point is $BACKUP_REF ($RESTORE_SHA).'
echo '  Review this upgrade: git diff $RESTORE_SHA ; restore a file: git checkout $RESTORE_SHA -- <path>'"
    else
      RESTORE_SHA=""
      BACKUP_REF="(no commits yet)"
      UPGRADE_BASE="$(git -C "$TARGET" hash-object -t tree /dev/null)"
    fi
  elif [ "$BACKUP" = "1" ]; then
    echo "BACKUP_ABORT: '$TARGET' is not a git repository, so an upgrade would change files with no way back." >&2
    echo "  Create a restore point first:  (cd \"$TARGET\" && git init && git add -A && git commit -m 'pre-upgrade')" >&2
    echo "  …or re-run with --no-backup to upgrade without one." >&2
    exit 1
  else
    echo "WARNING: --no-backup on a directory that is not a git repository — there is NO restore point, and the"
    echo "         house migrations are ONE-WAY. If one does the wrong thing to this project there is no undo."
  fi
fi

# --- two lockfiles: damage this toolkit caused, and will otherwise keep believing ----------------------------
# Before nx-tools 0.18.0 the generated post-create.sh hardcoded `yarn install`, while house.sh already
# detected npm and pnpm correctly. So a devcontainer build on an npm project ran yarn and left a yarn.lock
# beside package-lock.json. After that `npm ci` fails for the whole team, and the cause — a container rebuild
# weeks earlier — is nowhere near the symptom.
#
# The 0.18.0 fix made it PERMANENT rather than repairing it: every detector here checks yarn.lock BEFORE
# package-lock.json, so the stray file the old script planted became the evidence every later run trusts, and
# the upgrade itself keeps choosing yarn in an npm project.
#
# The `packageManager` field is an EXPLICIT declaration, not an artifact — the one piece of evidence that settles
# which lockfile is legitimate. Where it names npm or pnpm, a yarn.lock contradicts something the project stated
# about itself, and this toolkit is what put it there: removed. Anywhere else nothing is deleted, only reported.
#
# RENDERED INTO THE PROGRAM, after the preflight verdict — it is a write, and it once ran in this outer shell
# before preflight: a refused upgrade had already deleted the file, and then listed that deletion as the user's own
# dirty change.
STRAY_LOCKFILE_BLOCK=""
if [ "$MODE" = "upgrade" ]; then
  if [ "$PM_SOURCE" = "packageManager-field" ] && [ "$PM" != "yarn" ]; then
    _stray_act="rm -f yarn.lock
    echo \"NOTE: removed a stray yarn.lock — this project declares packageManager: $PM and also has \$_other.\"
    echo '      A pre-0.18 devcontainer build created it by running yarn install regardless of the project'
    echo '      package manager, which breaks $PM ci for everyone and made every later upgrade pick yarn.'
    echo '      If it was tracked, git restore yarn.lock brings it back.'"
  else
    _stray_act="echo \"WARNING: this workspace has TWO lockfiles — yarn.lock and \$_other.\" >&2
    echo '         A pre-0.18 devcontainer build may have created the yarn.lock by running yarn install' >&2
    echo '         regardless of the project package manager. While both exist, this upgrade and post-create.sh' >&2
    echo '         resolve to yarn, and installs from the other lockfile fail.' >&2
    echo '         Nothing was deleted: which one is legitimate cannot be determined from here. Delete the one' >&2
    echo '         that is not yours, or declare it with npm pkg set packageManager=<pm>@<version>, and re-run.' >&2"
  fi
  STRAY_LOCKFILE_BLOCK="
if [ -f yarn.lock ]; then
  _other=''
  [ -f package-lock.json ] && _other=package-lock.json
  [ -f pnpm-lock.yaml ] && _other=pnpm-lock.yaml
  if [ -n \"\$_other\" ]; then
    $_stray_act
  fi
fi"
fi

# --- the ENSURE set, available to the rendered program from its first line ---
# ENSURED, not ACTIVE — the distinction the house keeps strictly apart. ACTIVE is detected-OR-ensured; ENSURED is
# only what this run was explicitly asked to create. The scaffold's first app attaches it before anything can be
# detected, and the planner uses it for BASELINE acts (wiring a provider into app.config.ts, which the project owns
# thereafter) that must never happen on a detect-only upgrade.
ENSURED_BLOCK="
ENSURED='$ENSURE_LAYERS'"

# --- resolve the ACTIVE layer set at run time, inside the target workspace ---
# Detection reads the workspace itself through the INSTALLED registry — the same one the generators guard on — so
# the scaffolder and the generators can never disagree about what this project is. @bespunky/nx-tools must
# therefore be installed BEFORE this runs (INSTALL_NX_TOOLS is, in both modes).
LAYER_RESOLVE_BLOCK="
$DEVKIT_BLOCK
# Detection must not fail SILENTLY. Swallowing the error here reports 'none', which reads as a legitimate bare
# repo — so every layer the project has would be skipped and its house tooling quietly not applied. A sentinel
# distinguishes 'detected nothing' from 'could not detect', and the latter aborts.
DETECTED=\"\$(node '$NXT_DIR/src/layers/cli.js' detect 2>/dev/null || echo '__DETECT_FAILED__')\"
if [ \"\$DETECTED\" = '__DETECT_FAILED__' ]; then
  echo 'ERROR: could not read this workspace layers (the layer registry failed to load).' >&2
  echo '       Refusing to continue: a failed detection is indistinguishable from an empty project, and' >&2
  echo '       acting on it would skip the house tooling for every layer this project actually has.' >&2
  exit 1
fi
ACTIVE=\"\$(printf '%s\\n%s\\n' \"\$DETECTED\" \"\$ENSURED\" | tr ',' '\\n' | sed '/^\$/d' | sort -u | paste -sd, -)\"
echo \"[layers] detected in workspace : \${DETECTED:-none}\"
echo \"[layers] ensured by this run   : \${ENSURED:-none}\"
echo \"[layers] active (union)        : \${ACTIVE:-none}\""

# --- THE PLAN: every house generator this run executes, from the layer registry (one sequence, both modes) ---
# This replaces the hand-written, layer-gated nx g blocks that used to live here. The planner (the installed
# @bespunky/nx-tools src/layers/cli.js plan) derives the sequence from the registered layer descriptors:
#   per-app steps (upgrade only — a scaffold's app generator composes them), then workspace steps in registry order,
#   then house-doc LAST, ungated, because it STAMPS the layer set this run applied.
# Each line it prints is: gen TAB generator TAB arg TAB arg … | warn TAB sentence | partial. Arguments are
# TAB-separated FIELDS, read into an array and passed quoted — never word-split — so a value may carry spaces and
# JSON (house-doc's --branchProjection is the resolved branch-model projection). The planner refuses an argument
# holding a TAB, newline or other control character, and a duplicated flag.
#
# fd 9, not stdin: nx g may read stdin, and would swallow the rest of the plan.
PLAN_RUN_BLOCK="
_UPGRADE_PARTIAL=\${_UPGRADE_PARTIAL:-0}
# THE ATTENTION LIST (nx-tools _utils/upgrade-report.ts): a generator that replaced a value in the project's own
# targets (or kept a target of the project's over the house's) names it in this file too, and the outer summary
# prints every line under UPGRADE_ATTENTION — the warning alone drowns in the generators' output. Inside the
# self-ignoring upgrade lock, so it crosses the Docker boundary and goes with the lock.
[ -d .bespunky-upgrade.lock ] && export BESPUNKY_UPGRADE_REPORT=\"\$PWD/.bespunky-upgrade.lock/report\"
_plan=\"\$(node '$NXT_DIR/src/layers/cli.js' plan --mode=$MODE --active=\"\$ACTIVE\" --ensured=\"\$ENSURED\" --project=$PROJECT --app=\"\$APP\" --voice=$VOICE --staging=$STAGING --nx-tools-version=$NX_TOOLS_VERSION --plugin-version=$PLUGIN_VERSION --package-manager=$PM --branch-projection=\"\${_bm_projection:-}\")\" || {
  echo 'ERROR: the layer planner failed — no house generators were run, and nothing has been stamped.' >&2
  exit 1
}
_tab=\"\$(printf '\\t')\"
while IFS=\"\$_tab\" read -r -u 9 _kind _gen _args; do
  case \"\$_kind\" in
    gen)
      _argv=()
      [ -n \"\$_args\" ] && IFS=\"\$_tab\" read -r -a _argv <<< \"\$_args\"
      echo \"[layers] nx g @bespunky/nx-tools:\$_gen \${_argv[*]+\${_argv[*]}}\"
      $NX_RUN g \"@bespunky/nx-tools:\$_gen\" \${_argv[@]+\"\${_argv[@]}\"} ;;
    warn)
      echo \"[layers] WARNING: \$_gen\" ;;
    partial)
      _UPGRADE_PARTIAL=1 ;;
  esac
done 9<<< \"\$_plan\""

# --- the SCAFFOLD bootstrap: what creates the ensured layers from an empty directory ---
# Derived from the ENSURE set, never hard-wired: scaffold is upgrade with an ensure set against an empty directory.
# The default (`agent`) scaffolds a wrapper-hosted Nx repo with the agent DX and bootstraps no stack at all; the
# `angular` preset lays a package.json host, adds @nx/angular and creates the first app — because its layers say
# so (node, angular's nxPlugin, angular's app-creating adapter), not because this script names them.
NEW_COMMIT_LAYERS="$(printf '%s' "$ENSURE_LAYERS" | sed 's/,/, /g')"

# THE FLOOR, by host. Every scaffold block below is RENDERED only when the ensure set calls for it — the program
# a scaffold runs is exactly the bootstrap of the layers it ensures, nothing gated at run time on a flag.
if [ "$HOST" = "node" ]; then
  # WHICH WORKSPACE create-nx-workspace BUILDS is the LINKING choice, and nothing else (layout is declared after,
  # by a generator — the presets below fix no app/lib directories of their own that we keep):
  #   paths       --preset=apps --workspaces=false — project.json projects, tsconfig.base.json `paths`. The house
  #               default, and today's output exactly.
  #   workspaces  --preset=ts — Nx's TS-solution workspace: package-manager `workspaces`, tsconfig.base.json with
  #               `composite` + a custom condition, a references-only tsconfig.json. Chosen over
  #               `--preset=apps --workspaces=true` because that combination was VERIFIED to produce no
  #               TS-solution at all (Nx 23.2: no `workspaces`, no tsconfig — `apps` ignores the flag), so it
  #               would scaffold `paths` while the summary said `workspaces`. `--workspaces=true` is passed
  #               anyway, so the request is explicit rather than a preset default that could move.
  if [ "$LINKING" = "workspaces" ]; then
    CREATE_WORKSPACE_PRESET="--preset=ts --workspaces=true"
  else
    CREATE_WORKSPACE_PRESET="--preset=apps --workspaces=false"
  fi
  NEW_FLOOR_BLOCK="# THE AGENT-MODE ENV VARS ARE STRIPPED FOR THIS ONE COMMAND, and that is the difference between a working
# scaffold and the wrong one.
#
# create-nx-workspace reads CLAUDECODE / OPENCODE and switches into an \"AI Agent Mode\" that IGNORES
# --preset entirely: it builds from \`nrwl/empty-template\` instead (a TS-solution workspace) and additionally
# litters the repo with AGENTS.md, opencode.json, .codex/, .cursor/, .gemini/. Whether this workspace links by
# \`paths\` or by \`workspaces\` is a choice the user made (--linking), so no environment variable may make it
# for them — in either direction.
#
# The sting is that this only happens when the scaffolder is run FROM Claude Code, which is its primary way
# of being used: run it by hand in a terminal and it does what was asked, run it the way this toolkit intends
# and it silently does something else. Nothing in the script had changed; the environment reinterpreted its
# arguments.
#
# Scoped to this invocation deliberately. These variables are true — an agent IS running this — and other
# tools may reasonably key off them. What is not acceptable is one command redefining the workspace shape.
env -u CLAUDECODE -u OPENCODE $CREATE_WORKSPACE '$PROJECT' $CREATE_WORKSPACE_PRESET --packageManager=yarn --nxCloud=skip --no-interactive
cd \"\$HOUSE_PROJECT_DIR_NAME\""
else
  # No package.json: an empty repository, then the SAME wrapper floor an upgrade lays on a Python or Go repo.
  NEW_FLOOR_BLOCK="mkdir \"\$HOUSE_PROJECT_DIR_NAME\"
cd \"\$HOUSE_PROJECT_DIR_NAME\"
git init -q
$NX_INIT_BLOCK"
fi

# The Nx plugins of the ensured layers (descriptor nxPlugin, e.g. angular -> @nx/angular), in registry order —
# each one is how its layer comes into being, before any house generator needs it.
#
# In a `workspaces` (TS-solution) scaffold each `nx add` runs with NX_IGNORE_UNSUPPORTED_TS_SETUP=true, for that
# command only. Some stack plugins refuse a TS-solution workspace outright in their init (@nx/angular:
# "doesn't support a TypeScript setup with project references"), and upstream's own opt-out — undocumented, printed
# only in that refusal — is this variable: an INLINE prefix on the one command, never an export. The
# house hosts such a stack as an honest hybrid — its projects are project.json islands that consume the
# workspace's packages through their `exports` (docs/features/2026-10-02-workspace-layouts/DECISION.md) — and the
# stack adapter sets the same variable around its own generator calls. A plugin with no such guard ignores it.
NEW_PLUGIN_ENV=""
[ "$LINKING" = "workspaces" ] && NEW_PLUGIN_ENV="NX_IGNORE_UNSUPPORTED_TS_SETUP=true "
NEW_PLUGINS_BLOCK=""
for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
  _plugin="$(house_layer_nx_plugin "$_l")"
  [ -n "$_plugin" ] && NEW_PLUGINS_BLOCK="$NEW_PLUGINS_BLOCK
$NEW_PLUGIN_ENV$NX_RUN add $_plugin$NX_TAG"
done

# The LAYOUT the scaffold was asked for, DECLARED in nx.json \`workspaceLayout\` before the first project exists —
# an empty workspace has nothing to infer a layout from, so every generator after this one (the first app, the
# design system, Nx's own) resolves the choice from Nx's own field. Through the house generator, never a hand
# edit of nx.json here. Not rendered without --layout: today's output declares nothing.
NEW_LAYOUT_BLOCK=""
[ -n "$LAYOUT" ] && NEW_LAYOUT_BLOCK="$NX_RUN g @bespunky/nx-tools:workspace-layout --layout=$LAYOUT"

# The first app, through the HOUSE app generator (never the raw framework generator): the stack adapter creates
# it with the house defaults, then it ATTACHES every capability the workspace wears — each layer's per-app steps,
# the same ones an upgrade runs. This is the SAME one command a developer runs to add any LATER app, so the first app
# and the Nth share one code path. --layers hands it the ensure set: at first-app time nothing this run ensures
# exists yet to be detected (firebase.json, for one).
NEW_APP_BLOCK=""
[ -n "$APP_STACK" ] && NEW_APP_BLOCK="$NX_RUN g @bespunky/nx-tools:app '$APPS_DIR/$APP' --stack=$APP_STACK$APP_STAGING_FLAG --layers=\$ENSURED"

if [ "$MODE" = "new" ]; then
  INNER="set -e
$PM_ADD_FN
mkdir -p \"\$HOUSE_WORK_ROOT\"
cd \"\$HOUSE_WORK_ROOT\"
$ENSURED_BLOCK
# Set the git identity only if unset. In the throwaway Docker image there is none, so this establishes it;
# on the native path the invoking user already HAS a global identity (it's where the name came from), so
# this must not clobber it — hence the conditional. Same result on both paths, no drift.
git config --global user.name >/dev/null 2>&1 || git config --global user.name \"\$HOUSE_GIT_NAME\"
git config --global user.email >/dev/null 2>&1 || git config --global user.email \"\$HOUSE_GIT_EMAIL\"
git config --global init.defaultBranch >/dev/null 2>&1 || git config --global init.defaultBranch main
$NEW_FLOOR_BLOCK
$NEW_PLUGINS_BLOCK
$INSTALL_NX_TOOLS
$NEW_LAYOUT_BLOCK
$NEW_APP_BLOCK
$LAYER_RESOLVE_BLOCK
APP='$APP'
# An upgrade resolved the branch model in its preflight; a scaffold has no preflight, so it resolves here (a new
# repository: undeclared, unless a declaration was already carried in).
$BRANCH_MODEL_BLOCK
$PLAN_RUN_BLOCK
# --local only: correct the manifest's temp-dir tarball spec back to the plain version BEFORE the commit, or
# the scaffold's one commit records a file: path that exists on no machine (and is deleted moments later).
$FINALIZE_LOCAL
# Commit the full scaffold. The floor may have made an initial commit (create-nx-workspace does), but the
# house generators + dep installs ran after it — capture them so the host-side push (gh repo
# create --source --push) ships a clean, complete tree on main.
git add -A
git commit -m 'chore: scaffold BeSpunky project (layers: $NEW_COMMIT_LAYERS)' || true"
else
  INNER="set -e
$PM_ADD_FN
cd \"\$HOUSE_WORK_ROOT/\$HOUSE_PROJECT_DIR_NAME\"
$ENSURED_BLOCK
# PREFLIGHT AND THE PROBE COME FIRST — before nx init, not merely before the install. Both only READ (git
# state, the installed toolkit, HOUSE.md), so they are safe this early, and the gate's refusals claim to stop
# before anything is written. With the floor ahead of them that claim would be false: nx init creates nx.json
# (and, on the node host, a lockfile) in someone's repo before we decided the upgrade should not happen at all.
#
# GATHER, GATHER, DECIDE. The checks and the probe both APPEND verdicts; PREFLIGHT_VERDICT is the single place
# that reports and exits. The probe sits between them on purpose — it writes nothing, and running it first is
# what lets a refusal name the ladder the user is being stopped from running.
_UPGRADE_PARTIAL=0
_stage() { [ -d .bespunky-upgrade.lock ] && printf 'stage=%s\n' \"\$1\" > .bespunky-upgrade.lock/state 2>/dev/null || true; }
_stage preflight
$PREFLIGHT_CHECKS
_stage probe
$MIGRATE_PROBE
$PREFLIGHT_VERDICT
$RESTORE_BLOCK
$STRAY_LOCKFILE_BLOCK
# THE FLOOR — always ensured, so there is no not-an-Nx-workspace refusal any more: a repo without Nx gets it.
$NX_INIT_BLOCK
$NX_RUNTIME_BLOCK
_stage install
$INSTALL_NX_TOOLS
_stage migrate
$MIGRATE_RUN
[ -d .bespunky-upgrade.lock ] && printf 'migrations=%s\n' \"\${_expected:-0}\" >> .bespunky-upgrade.lock/state 2>/dev/null || true
_stage generators
$LAYER_RESOLVE_BLOCK
$CHECK_NAME_FN
_resolve_upgrade_app '$NXT_DIR' '$APP' '$PROJECT'
$PLAN_RUN_BLOCK
$FINALIZE_LOCAL
# A run that skipped generators is not a clean run, and the outer summary prints UPGRADE_OK either way.
# Say so here, while the reason is still on screen, so neither a human nor a model reads that final
# line as everything-was-applied.
if [ \"\$_UPGRADE_PARTIAL\" = '1' ]; then
  echo 'UPGRADE_PARTIAL: some generators were skipped — see the [layers] WARNING lines above. The project'
  echo '  was still stamped, so a later upgrade will NOT retry them on its own; re-run addressing the warning.'
fi"
fi

# --- --print-inner: show the rendered program and stop --------------------------------------------------------
# This script's real product is the ~300-line shell program assembled above, and until now the only way to
# read it was to edit this file and insert a printf — which is what every review of it has had to do, and
# what a maintainer debugging a quoting bug would have to do under pressure. The blocks are nested
# double-quoted strings where a stray backtick or an unescaped quote is live command substitution, so being
# able to LOOK at the output is the difference between checking a change and hoping.
#
# Placed here, after every block is rendered and BEFORE ANYTHING WRITES — before the upgrade lock, and the program
# itself is where every write lives. It once sat after the lock, the backup tag and the stray-lockfile cleanup,
# so "running nothing" deleted a yarn.lock and tagged a dirty tree. It shows exactly what would have run —
# including the mode, layer and package-manager decisions already baked in. Writes to stdout and exits 0, so
# `house.sh upgrade --print-inner <proj> | bash -n /dev/stdin` is a syntax check. The roots are environment
# (INNER_ENV), so the printed program names them as variables.
if [ "$PRINT_INNER" = "1" ]; then
  printf '%s\n' "$INNER" >&3
  exit 0
fi

# --- single writer per project ------------------------------------------------------------------------------
# Two upgrades on one project is not a hypothetical: it is one impatient re-run, or a hook-suggested upgrade landing
# on top of a manual one. They race over node_modules, the lockfile, HOUSE.md — and over `migrations.json`,
# which is the dangerous one. Every upgrade starts its migrate step with `rm -f migrations.json`; if that lands
# between another run's collect and its `--run-migrations`, `--if-exists` turns "the ladder vanished" into
# "nothing to do", that run applies ZERO migrations, and house-doc then stamps the project current. The
# result is a project that claims to be migrated and is not, which no later upgrade will ever revisit.
#
# `mkdir` is the lock because it is atomic on every filesystem that matters — test-then-create is not. The
# PID inside lets a genuinely dead run be taken over rather than wedging the project forever, which is the
# failure mode that makes people delete lock files by hand and lose the protection entirely.
UPGRADE_LOCK=""
if [ "$MODE" = "upgrade" ]; then
  UPGRADE_LOCK="$TARGET/.bespunky-upgrade.lock"
  if ! mkdir "$UPGRADE_LOCK" 2>/dev/null; then
    _holder="$(cat "$UPGRADE_LOCK/pid" 2>/dev/null || echo '')"
    if [ -n "$_holder" ] && kill -0 "$_holder" 2>/dev/null; then
      echo "ERROR: another upgrade is already running for this project (pid $_holder)." >&2
      echo "       Two upgrades at once can leave the project stamped as migrated when it is not." >&2
      echo "       Wait for it to finish, or stop it, then re-run." >&2
      exit 1
    fi
    # The holder is gone — a killed or crashed run. Take it over rather than refusing forever.
    echo "NOTE: found a stale upgrade lock from pid ${_holder:-unknown} (no longer running) — taking it over."
    rm -rf "$UPGRADE_LOCK"
    mkdir "$UPGRADE_LOCK" 2>/dev/null || { echo "ERROR: could not create the upgrade lock at $UPGRADE_LOCK." >&2; exit 1; }
  fi
  printf '%s\n' "$$" > "$UPGRADE_LOCK/pid" 2>/dev/null || true

  # SELF-IGNORING, and it has to be created HERE rather than left to a generator.
  #
  # The lock lives inside the project, and the migration ladder runs `nx migrate --run-migrations
  # --create-commits`, whose checkpoint is built with `git add -A` — so a lock this run is still holding gets
  # swept into a commit, released moments later, and left behind as a tracked file with a phantom deletion in
  # `git status` forever. It has happened twice in the toolkit's own history (abd143e, b8b293b).
  #
  # The `claude-settings` generator also writes a `.gitignore` rule for this path, but that generator runs
  # AFTER the migration step — so on the very first upgrade that carries migrations, the rule lands after the
  # commit that needed it. A guard that only takes effect once you no longer need it is not a guard. A
  # `.gitignore` containing `*` inside the directory ignores the directory and itself, from the moment the
  # lock exists, with no ordering assumption at all — the same self-ignoring pattern the house rules already
  # prescribe for `mocks/` and scratch directories.
  printf '*\n' > "$UPGRADE_LOCK/.gitignore" 2>/dev/null || true

  # Released on ANY exit, including the refusals above this line's own guards and every early failure below.
  trap 'rm -rf "$UPGRADE_LOCK"' EXIT INT TERM

fi

# --- the repository has to be in a state where committing means what it says ----------------------------------
# The migration ladder commits, and Nx builds every one of those commits with `git add -A`. That is fine in a
# normal working tree and actively destructive in two states git can legitimately be in.
if [ "$MODE" = "upgrade" ] && git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # --absolute-git-dir, not --git-dir: the plain form answers RELATIVE to the repository ("`.git`"), and this
  # script's own working directory is not the project, so every `-e "$_gd/MERGE_HEAD"` below silently missed.
  _gd="$(git -C "$TARGET" rev-parse --absolute-git-dir 2>/dev/null || echo '')"

  # 1. AN OPERATION IS ALREADY IN PROGRESS. `git add -A` during an unresolved merge stages the CONFLICT
  #    MARKERS and the checkpoint commit concludes the merge with them in it — a real two-parent commit, so
  #    `git merge` afterwards says "Already up to date" and `git branch --merged` lists a branch whose content
  #    was never actually merged. A restore point does not save you either: one commit does not record the merge
  #    in progress at all. This is the only failure here that corrupts history rather than just failing,
  #    and once pushed it is everyone's problem.
  _busy=""
  [ -n "$_gd" ] && [ -e "$_gd/MERGE_HEAD" ]        && _busy="a merge"
  [ -n "$_gd" ] && [ -d "$_gd/rebase-merge" ]      && _busy="a rebase"
  [ -n "$_gd" ] && [ -d "$_gd/rebase-apply" ]      && _busy="a rebase"
  [ -n "$_gd" ] && [ -e "$_gd/CHERRY_PICK_HEAD" ]  && _busy="a cherry-pick"
  [ -n "$_gd" ] && [ -e "$_gd/REVERT_HEAD" ]       && _busy="a revert"
  if [ -n "$_busy" ]; then
    echo "ERROR: $_busy is in progress in this repository, so the upgrade will not run." >&2
    echo "       The house migrations commit as they go, and git stages EVERYTHING when they do — mid-$_busy" >&2
    echo "       that would commit the unresolved state, and in the merge case record the branch as merged" >&2
    echo "       when its content never was." >&2
    echo "       Finish or abort it first, then re-run the upgrade." >&2
    exit 1
  fi

  # 2. DETACHED HEAD. The migrations would be committed to no branch at all: nothing names them afterwards,
  #    `git checkout <branch>` refuses because the tree is dirty, and forcing it discards the entire run.
  #    And HEAD, the restore point, is not a durable ref here.
  if ! git -C "$TARGET" symbolic-ref -q HEAD >/dev/null 2>&1; then
    echo "ERROR: this repository has a detached HEAD, so the upgrade will not run." >&2
    echo "       The migrations commit as they go; on a detached HEAD those commits belong to no branch and" >&2
    echo "       are lost the moment you check one out." >&2
    echo "       Check out a branch first (git switch -c <name> keeps what is here), then re-run." >&2
    exit 1
  fi
fi

# --- run the rendered command sequence, on whichever runtime we chose ---
# The exit code is CAPTURED rather than allowed to kill the script, because the most useful thing this tool
# can say happens after a failure, not before it. Under `set -e` a mid-run death exited with whatever raw
# errno nx or yarn printed and nothing else — no mention that the migrations had already applied and
# committed, no restore point (that line scrolled past hundreds of install messages ago), and no answer to
# the only two questions anyone has at that moment: what state is my project in, and is re-running safe?
INNER_RC=0
if [ "$RUNTIME" = "native" ]; then
  # Native: the generators run in THIS environment, as the invoking user, writing straight to the host
  # tree — so no mounts, no uid mapping, and no root-owned-files fixup are needed. $INNER's roots are
  # already bound to the real host paths.
  env "${INNER_ENV[@]}" bash -c "$INNER" || INNER_RC=$?
else
  _inner_env_args=()
  for _kv in "${INNER_ENV[@]}"; do _inner_env_args+=(-e "$_kv"); done
  container_run_as_host_user \
    -e HOME=/home/node "${_inner_env_args[@]}" \
    -v "$PROJECTS_DIR":/work -v "$ENGINE_DIR":/engine:ro -w /work \
    "$IMAGE" \
    bash -lc "$INNER" || INNER_RC=$?

  # --- normalize ownership back to the invoking host user (Docker path only) ---
  # On a rootful engine some backends (notably Docker Desktop's WSL2 integration) leave freshly created
  # files owned by root despite running as the host uid, which makes every later host-side operation
  # (git, yarn, the Claude CLI) fail with permission errors; a throwaway ROOT container hands the tree
  # back. On a rootless engine (rootless Docker, Podman) container root already IS the host user, so
  # this is a no-op — chowning there would hand the tree to a subuid. The engine decides; see
  # container-engine.sh. Runs before the gh push so git operations on the tree don't hit permission
  # errors. (The native path never creates foreign-owned files, so it needs none of this.)
  container_restore_ownership "$IMAGE" "$PROJECTS_DIR" "/work/$PROJECT_DIR_NAME"
fi

# --- create + push a private GitHub repo (scaffold mode only; gh auth lives on the host) ---
# Runs OUTSIDE Docker: the bare typescript-node base image has neither `gh` nor the host's
# auth. A linked repo is what App Hosting's GitHub mode rolls out from (linked at
# `firebase apphosting:backends:create`; we generate no workflow files). Non-Firebase projects
# just get a remote to push to.
# Never fail the scaffold over a missing/unauthenticated gh — the local repo already exists.
GITHUB_RESULT=""
if [ "$MODE" = "new" ] && [ "$GITHUB" = "1" ]; then
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    GITHUB_RESULT="GITHUB_SKIP: gh not found or not authenticated — local repo only (run 'gh auth login', then 'gh repo create $PROJECT --private --source \"$TARGET\" --remote=origin --push')"
    echo "$GITHUB_RESULT" >&2
  elif git -C "$TARGET" remote get-url origin >/dev/null 2>&1; then
    GITHUB_RESULT="GITHUB_SKIP: 'origin' remote already set on $TARGET — left as-is"
    echo "$GITHUB_RESULT" >&2
  else
    echo "Creating private GitHub repo '$PROJECT' and pushing..."
    if gh repo create "$PROJECT" --private --source "$TARGET" --remote=origin --push; then
      REPO_URL="$(gh repo view "$PROJECT" --json url -q .url 2>/dev/null || echo '')"
      GITHUB_RESULT="GITHUB_OK ${REPO_URL:-$PROJECT}"
      echo "$GITHUB_RESULT"
    else
      GITHUB_RESULT="GITHUB_SKIP: 'gh repo create' failed — local repo intact; create the remote manually"
      echo "$GITHUB_RESULT" >&2
    fi
  fi
elif [ "$MODE" = "new" ]; then
  GITHUB_RESULT="GITHUB_SKIP: not requested — local repo only (--github creates a private GitHub repo and pushes)"
fi

# --- the run died somewhere: say where, and what that means for the project ------------------------------------
if [ "$INNER_RC" -ne 0 ]; then
  _st=""; _mig=""
  if [ -n "${UPGRADE_LOCK:-}" ] && [ -f "$UPGRADE_LOCK/state" ]; then
    _st="$(sed -n 's/^stage=//p' "$UPGRADE_LOCK/state" 2>/dev/null | tail -1)"
    _mig="$(sed -n 's/^migrations=//p' "$UPGRADE_LOCK/state" 2>/dev/null | tail -1)"
  fi
  # A PREFLIGHT REFUSAL is not a failure: it decided not to start, said why on its own first line (UPGRADE_REFUSED),
  # and wrote nothing — so there is nothing to diagnose and nothing to restore. Adding UPGRADE_FAILED and
  # restore advice on top of it told the reader a run had died and needed undoing.
  [ "$_st" = "refused" ] && exit "$INNER_RC"
  echo "" >&2
  echo "UPGRADE_FAILED $TARGET (exit $INNER_RC)${_st:+ — died during: $_st}" >&2
  _wrote=1
  case "$_st" in
    preflight|probe)
      _wrote=0
      echo "  migrations : NOT started — and nothing had been written yet." >&2 ;;
    install|"")
      echo "  migrations : NOT started — nothing was migrated." >&2 ;;
    migrate)
      echo "  migrations : STARTED and may be partly applied. This is the one case not to re-run blindly:" >&2
      echo "               check 'git log' for 'chore: [nx migration]' commits to see how far it got." >&2 ;;
    generators|*)
      if [ -n "$_mig" ] && [ "$_mig" != "0" ]; then
        echo "  migrations : APPLIED ($_mig) and committed — that part succeeded and does not need redoing." >&2
      else
        echo "  migrations : none were due; nothing was migrated." >&2
      fi
      echo "  stamp      : NOT written (house-doc runs last), so the project still reports its old version" >&2
      echo "               and a re-run will pick up from the same place." >&2
      echo "  re-running : SAFE — the migrations are idempotent and will report no changes the second time." >&2 ;;
  esac
  # RESTORE, NEVER RESET. The way back is to put the FILES back as they were, leaving the branch, its history and
  # anything else the user has done since exactly where they are — a reset --hard moves the branch and discards
  # the working tree wholesale, which is the one undo that can destroy something the upgrade did not make. Restoring
  # leaves the migration commits in history (revert them like any commit, if wanted) and a reviewable diff.
  if [ "$_wrote" = "1" ]; then
    echo "  restore    : $BACKUP_REF" >&2
    if [ -n "$RESTORE_SHA" ]; then
      echo "               put every tracked file back:  git -C '$TARGET' restore --source=$RESTORE_SHA --staged --worktree -- ." >&2
      echo "               then list what the run ADDED: git -C '$TARGET' clean -n   (review before removing with -f)" >&2
    else
      echo "               (no restore point — not a git repository, or no commits yet)" >&2
    fi
  fi
  exit "$INNER_RC"
fi

# --- what, if anything, does this run still need from the human? ---------------------------------------------
#
# THE UPGRADE IS OVER; THIS IS NOT A RE-RUN. Some of what an upgrade writes is read by Claude Code only when a
# session starts (`.claude/settings.json` — enabled plugins, marketplaces, output style; `.mcp.json` — MCP
# servers; the hooks belonging to plugins this run enabled) and some of what it writes to `.devcontainer/`
# — mounts, runArgs, containerEnv, features — applies only when a container is CREATED. Neither can be made
# to take effect mid-session, and that is the one genuinely irreducible boundary in the whole flow.
#
# What was avoidable was having MORE than one of them, and having them in the MIDDLE. So this states exactly
# one boundary, chosen by what actually changed, and states it at the end:
#
#   rebuild-container  .devcontainer/ moved. It SUBSUMES a restart — a rebuild is a new session, and its
#                      post-create reinstalls the plugins — so it is never reported alongside one.
#   restart-session    session-scoped config moved, but nothing that needs a new container.
#   none               nothing this run wrote requires either. The common case, and worth saying plainly:
#                      silence here has previously been read as "probably restart, to be safe".
#   unknown            no git base to compare against, so the honest answer is that it cannot tell.
#
# SEPARATELY, `UPGRADE_RELOAD` names the generated GUIDANCE files that changed. These are `@`-imported at
# session start too, but their content needs no restart at all — reading the file puts it in context
# immediately. Naming them is what lets the caller close that gap in-session instead of banking it into a
# boundary it does not deserve.
#
# DETECT, DON'T EXECUTE — the same rule the SessionStart version hook lives by. This prints a fact. It never
# rebuilds a container and never restarts anything: both throw away the session the human is working in, and
# a script cannot know what that costs them right now.
# A FUNCTION, and marked for extraction, because this is the half that regresses silently. A boundary that
# stops being reported does not look like a bug — it looks like a clean run, right up until someone spends an
# afternoon on settings that were never in effect. tools/test-scaffold/upgrade-next.test.sh evaluates the block
# between these markers against real git fixtures; keep them intact and keep the function self-contained
# (no globals beyond its arguments), or the test silently covers nothing.
# --->8--- UPGRADE_NEXT
_upgrade_next() {   # <target> <base-sha|''> — sets UPGRADE_NEXT and UPGRADE_RELOAD
  local target="$1" base="$2" changed=""
  UPGRADE_NEXT="unknown"
  UPGRADE_RELOAD=""
  [ -n "$base" ] || return 0
  # Committed deltas (the migration ladder commits as it goes) + working-tree edits + brand-new untracked
  # files, which `git diff` alone would miss entirely — and a first retrofit creates most of these files.
  # BOTH RELATIVE TO THE PROJECT. `ls-files` answers relative to its -C directory, but `diff --name-only` answers
  # relative to the REPOSITORY ROOT — so in a project that is a subdirectory of its repo, a changed
  # `.devcontainer/devcontainer.json` came back as `web/.devcontainer/…`, missed every anchor below, and an upgrade
  # that needed a rebuild reported `none`. `--relative` makes the diff speak the same coordinates (and limits it
  # to the project, which is the question asked).
  changed="$( { git -C "$target" diff --relative --name-only "$base" 2>/dev/null
                git -C "$target" ls-files --others --exclude-standard 2>/dev/null; } | sort -u )"
  UPGRADE_NEXT="none"
  # THE ANCHORS ARE LOAD-BEARING — do not relax `^\.claude/settings\.json$` to `^\.claude/`.
  #
  # The house devcontainer bind-mounts `${localWorkspaceFolder}/.claude/data` onto `/home/node/.claude`, so
  # Claude Code's entire runtime state — the plugin cache, installed_plugins.json, auth — physically lives
  # INSIDE the project this function is diffing. And `/bespunky-house:upgrade` step 1 runs `claude plugin update`, which writes
  # there on the way in. Match `.claude/` as a prefix and every upgrade ever run reports `restart-session`,
  # earned by nothing but the upgrade's own bookkeeping — and a boundary that fires on every run is a boundary
  # everyone learns to ignore, which is exactly what this line exists to prevent. `.claude/data/` is also
  # gitignored, so this is belt and braces; the anchor is the half that does not depend on a project having
  # been upgraded yet.
  if printf '%s\n' "$changed" | grep -q '^\.devcontainer/'; then
    UPGRADE_NEXT="rebuild-container"
  elif printf '%s\n' "$changed" | grep -qE '^(\.claude/settings\.json|\.mcp\.json)$'; then
    UPGRADE_NEXT="restart-session"
  fi
  # `|| true` IS LOad-BEARING under this script's `set -euo pipefail`. grep exits 1 when it matches nothing,
  # an assignment takes the exit status of its command substitution, and `set -e` then kills the script — so
  # the NO-GUIDANCE-CHANGED case (an ordinary steady-state upgrade) would die silently right here, after every
  # generator had run, printing no UPGRADE_NEXT, no UPGRADE_OK, and no error. Found by running a real upgrade twice:
  # the first changed HOUSE.md and passed, the second did not and exited 1 with an empty tail.
  UPGRADE_RELOAD="$(printf '%s\n' "$changed" | grep -E '^(HOUSE\.rules\.md|HOUSE\.md|CLAUDE\.md)$' | tr '\n' ' ' || true)"
  UPGRADE_RELOAD="${UPGRADE_RELOAD% }"
}
# ---8<--- UPGRADE_NEXT

# What the generators need a HUMAN to look at (nx-tools _utils/upgrade-report.ts): a value of the project's replaced
# inside a house target, a value with no record to tell an edit from an older house value, a deploy-contract value
# re-asserted, a target of the project's own kept over the house's. Generators append one line each to the report
# file in the upgrade lock (BESPUNKY_UPGRADE_REPORT, exported by the plan runner); their warnings alone drown in the
# run's output. Each line says what happened and what to do; none of it failed the run. Silent when there is none.
# --->8--- UPGRADE_ATTENTION
_upgrade_attention() {   # <upgrade lock dir, or ''>
  [ -n "$1" ] && [ -s "$1/report" ] || return 0
  echo "UPGRADE_ATTENTION: $(grep -c . "$1/report") thing(s) this run changed or kept in the project's own targets — read each:"
  sed 's/^/  /' "$1/report"
}
# ---8<--- UPGRADE_ATTENTION

if [ "$MODE" = "upgrade" ]; then
  _upgrade_next "$TARGET" "$UPGRADE_BASE"
  echo "UPGRADE_NEXT: $UPGRADE_NEXT"
  case "$UPGRADE_NEXT" in
    rebuild-container)
      echo "  .devcontainer/ changed, and the image (house.Dockerfile, the package lists), mounts, runArgs,"
      echo "  containerEnv and features only apply when the container is created. Run"
      echo "  'Dev Containers: Rebuild Container' when it suits you — that also"
      echo "  delivers the session-scoped config below, so no separate restart is needed." ;;
    restart-session)
      echo "  Session-scoped config changed (.claude/settings.json and/or .mcp.json). Claude Code reads those"
      echo "  at session start, so restart the session when it suits you. No container rebuild is needed." ;;
    none)
      echo "  Nothing this run wrote needs a new session or a container rebuild." ;;
    unknown)
      echo "  No git base to compare against, so this run cannot tell what changed. If .devcontainer/,"
      echo "  .claude/settings.json or .mcp.json moved, rebuild or restart accordingly." ;;
  esac
  if [ -n "$UPGRADE_RELOAD" ]; then
    echo "UPGRADE_RELOAD: $UPGRADE_RELOAD"
    echo "  Generated house guidance changed. It is @-imported at session start, but reading the file now puts"
    echo "  it in context immediately — no restart required for its content."
  fi
fi

if [ "$MODE" = "new" ]; then
  echo "NEW_OK $TARGET ($RUNTIME_DESC layers=$ENSURE_LAYERS host=$HOST${APP_STACK:+ app=$APPS_DIR/$APP}${LAYOUT:+ layout=$LAYOUT}${LINKING_ARG:+ linking=$LINKING} voice=$VOICE github=$GITHUB) ${GITHUB_RESULT:-}"
else
  # THE SUMMARY STATES WHAT THE PROJECT IS NOW, read back from the project — never the run's own inputs. It used
  # to echo them: `app=apps/<repo>` was the DEFAULT app name, printed for a repo that has no app at all, and
  # `firebase=0` was "--firebase was not passed", printed for a project whose Firebase layer the upgrade had just
  # detected and upgraded. So: the layer set house-doc STAMPED (the final, detected one — firebase included when
  # present), and the app only when it exists (as the project graph resolved it).
  _final_layers="$(grep -o '@bespunky/house-tooling:stamp[^>]*' "$TARGET/HOUSE.md" 2>/dev/null | head -1 \
    | grep -o 'layers=[a-z0-9,-]*' | head -1 | cut -d= -f2)"
  # The app's root, as the program resolved it from the project graph (`_resolve_upgrade_app`), handed over through
  # the lock's state file — empty when the app is not one of the workspace's apps, and then not printed.
  _app_dir=""
  [ -n "${UPGRADE_LOCK:-}" ] && [ -f "$UPGRADE_LOCK/state" ] && _app_dir="$(sed -n 's/^app=//p' "$UPGRADE_LOCK/state" 2>/dev/null | tail -1)"
  # voice: whether the project's devcontainer now bridges audio — read from its ownership marker, which records the
  # answer the devcontainer generator was actually given (an explicit --voice, or the project's earlier choice
  # carried forward). The flag alone said voice=0 for a project that had just been upgraded WITH voice.
  _voice=0
  grep -qE '"voice"[[:space:]]*:[[:space:]]*true' "$TARGET/.devcontainer/.bespunky-devcontainer.json" 2>/dev/null && _voice=1
  echo "UPGRADE_OK $TARGET ($RUNTIME_DESC layers=${_final_layers:-unknown}${_app_dir:+ app=$_app_dir} voice=$_voice backup=$BACKUP_REF)"
  # UPGRADE_OK says the run COMPLETED, never that its output builds: the ladder and the generators rewrite source
  # across the workspace and nothing here compiles, lints or tests it. A template that rendered a syntax error into a
  # generator-owned file reached UPGRADE_OK in a real project on two separate runs. So the line that reads like a
  # verdict is followed by the check it is not, scoped to exactly what this run touched (the restore point is the
  # pre-upgrade HEAD; `affected` with no --head includes the uncommitted generator output). Only where there are
  # Node projects to run it against.
  if [ -n "$RESTORE_SHA" ] && printf ',%s,' "${_final_layers:-}" | grep -q ',node,'; then
    echo "UPGRADE_VERIFY: nothing was built, linted or tested. Before landing it: $NX_RUN affected -t build lint test --base=$RESTORE_SHA"
  fi
  _upgrade_attention "${UPGRADE_LOCK:-}"
fi
