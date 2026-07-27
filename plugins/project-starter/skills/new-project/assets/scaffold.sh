#!/usr/bin/env bash
# Scaffold a BeSpunky-standard project, OR repair the house generators on an existing project.
#
# Default mode  : full scaffold (Nx + Angular + app + house generators + devcontainer + Claude settings).
# Repair mode   : re-run ONLY the three house generators on an existing project (all idempotent).
# Firebase opt-in: when --firebase is passed, the devcontainer gets the Firebase CLI + Google Cloud CLI
#                  features, the toba.vsfire extension, labeled portsAttributes, and explicit SAME-PORT
#                  forwardPorts for the dev server + emulator suite (required: the Firebase SDK in the
#                  host browser calls the emulators at hardcoded localhost:<port>, which only resolves
#                  when container ports forward to identical host ports). The firebase-emulators
#                  generator additionally scaffolds Cloud Functions as an Nx app (apps/functions), the
#                  workspace-level `firebase` emulator project, and the seed/cache/reset tooling.
#                  NEVER enabled by default.
# Voice opt-in   : when --voice is passed, the devcontainer bridges WSL2's WSLg PulseAudio server
#                  (remoteEnv PULSE_SERVER + the /mnt/wslg bind mount) and post-create.sh self-adapts
#                  on that mount to install the espeak-ng TTS floor + pulseaudio-utils and pre-install
#                  the bespunky-voice plugin — so /voice speaks the moment the container opens. WSL-only
#                  (the /mnt/wslg source is WSL-specific), which is why it's opt-in, not always-on.
#                  NEVER enabled by default.
# GitHub repo    : full scaffold creates a PRIVATE GitHub repo via `gh` and pushes to it. This runs
#                  host-side AFTER the Docker scaffold (gh auth lives on the host, not in the bare base
#                  image). Skipped gracefully (local repo only) when gh is missing/unauthenticated.
#                  Opt out with --no-github. Repair mode never touches the remote.
#                  Why a repo always: Firebase App Hosting deploys are GitHub-driven — linking the repo
#                  at `firebase apphosting:backends:create` is what makes Firebase provision its own
#                  Cloud Build CI/CD. We generate NO deploy workflow; the repo existing from minute one
#                  is what lets Firebase's native mechanism take over (so we never track its evolving
#                  deploy methodology). Non-Firebase projects still benefit from having a remote.
#
# Usage:
#   scaffold.sh [--firebase] [--voice] [--no-github] [--docker] <project-name> [app-name]          # full scaffold
#   scaffold.sh --repair [--firebase] [--voice] [--no-backup] [--yes] [--docker] <project-path|project-name> [app-name]
#
# Repair auto-backup: --repair snapshots the project to a git tag (repair-backup-<ts>) BEFORE running
# any generator, so a regenerated file (e.g. firebase.config.ts) is always recoverable — review with
# `git diff <tag>`, restore with `git checkout <tag> -- <path>`. A clean tree needs no tag (HEAD is the
# restore point). If a backup is wanted but impossible (not a git repo) or fails, repair ABORTS rather
# than change files unprotected. Opt out with --no-backup.
#
# Repair CONSENT GATE (--yes): a repair rewrites generated files and takes minutes — it must never
# happen because something *inferred* that it should. The SessionStart hook that
# detects a stale project deliberately only RELAYS that fact; this gate is what makes that boundary
# structural rather than a matter of an agent's good behavior:
#   - on a TTY  : a human is present → prompt, and proceed only on an explicit "yes".
#   - no TTY    : nobody can be asked (an agent's shell, a script) → REFUSE unless --yes is passed, which
#                 ASSERTS a human has explicitly agreed in this session. An agent may pass it only after
#                 the user actually said yes — never to satisfy the gate.
#   - CI=true   : there is no human to consent, and --yes cannot conjure one → REFUSE unconditionally.
# Scaffold mode has no gate: creating a NEW project is the thing the user just asked for, and it can't
# clobber anything that already exists.
#
# Leading flags (--repair, --firebase, --voice, --no-github, --no-backup, --yes, --docker) may be given in any order.
# PROJECTS_DIR env overrides target root in full mode (default: ~/projects).
#
# WHERE IT RUNS. Docker was never the requirement — a modern NODE is (Docker only ever existed here to
# supply one when the host's Node was too old). So this runs on the LOCAL Node when it's new enough —
# Node 22.18+, the bar for compile-generators.mts's unflagged type-stripping — with no daemon, no image
# pull and no mounts; that is exactly the case INSIDE a devcontainer, so `--repair` works there directly.
# Otherwise it falls back to the typescript-node base image via `docker run`, exactly as before. Both
# paths run the SAME rendered command sequence, so they cannot drift (mirrors tools/publish-nx-tools).
# Force the image with --docker. Never nvm.
set -euo pipefail

MODE="scaffold"
FIREBASE=0
VOICE=0    # --voice: bridge WSLg audio into the devcontainer + provision bespunky-voice (WSL-only; opt-in).
STAGING=0  # --staging: also scaffold a first-class staging environment (requires --firebase).
GITHUB=1   # scaffold mode creates a private GitHub repo by default; --no-github opts out.
BACKUP=1   # repair snapshots the project to a git tag BEFORE mutating; --no-backup opts out.
CONSENT=0  # --yes: asserts a human explicitly agreed to this repair (see the consent gate above).
FORCE_DOCKER=0  # --docker: use the base image even when the local Node would do (escape hatch).
ENSURE_ARG=""   # --ensure=<csv>: layers to BRING INTO BEING (see the layer model below). Empty = detect only.
while [ "${1:-}" != "" ]; do
  case "$1" in
    --repair)     MODE="repair"; shift;;
    --firebase)   FIREBASE=1;    shift;;
    --voice)      VOICE=1;       shift;;
    --staging)    STAGING=1;     shift;;
    --no-github)  GITHUB=0;      shift;;
    --no-backup)  BACKUP=0;      shift;;
    --yes|-y)     CONSENT=1;     shift;;
    --docker)     FORCE_DOCKER=1; shift;;
    --ensure=*)   ENSURE_ARG="${1#--ensure=}"; shift;;
    --ensure)     ENSURE_ARG="${2:?--ensure needs a comma-separated layer list}"; shift 2;;
    --*)          echo "ERROR: unknown flag '$1'" >&2; exit 1;;
    *)            break;;
  esac
done

# --- whose package manager is this? ---------------------------------------------------------------------------
# A SCAFFOLD creates the project, so it sets the house standard: yarn. A REPAIR does not get that choice. The
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
# true, which is why `--repair` runs there with no Docker. Mirrors publish.sh's local_node_ok().
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

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Pin the workspace's @bespunky/nx-tools to the SAME version the staged generators come from (read from
# the source package.json), so the installed runtime executors can never lag the applied project.json
# shape — a 0.x MINOR bump (e.g. 0.3→0.4) would otherwise fall outside a hard-coded caret and silently
# leave the project on the previous executor. Derived, never hand-maintained.
NX_TOOLS_VERSION="$(grep -m1 '"version"' "$ASSETS_DIR/nx-tools/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$NX_TOOLS_VERSION" ] || NX_TOOLS_VERSION="0.4.0"
# The plugin version that ships these assets, read from the manifest three levels up (assets/ lives at
# <plugin>/skills/new-project/assets). Together with NX_TOOLS_VERSION it is STAMPED into the project by the
# house-doc generator (into HOUSE.md's header — root-level and committed, so it reaches every clone), which
# is what lets project-starter's SessionStart hook notice — with a few greps, not a Docker run — that the
# installed toolkit has moved past this project, and ask for a repair. NX_TOOLS_VERSION is the one the hook
# actually compares (it determines what the generators produce); PLUGIN_VERSION is provenance. Derived, never
# hand-maintained; "unknown" if the manifest can't be read (a raw assets checkout), which the hook reads as
# "behind" and resolves by repairing.
PLUGIN_VERSION="$(grep -m1 '"version"' "$ASSETS_DIR/../../../.claude-plugin/plugin.json" 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
[ -n "$PLUGIN_VERSION" ] || PLUGIN_VERSION="unknown"
GIT_NAME="$(git config --global user.name 2>/dev/null || whoami)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "$(whoami)@localhost")"

# --- resolve TARGET + PROJECT + APP based on mode ---
if [ "$MODE" = "scaffold" ]; then
  PROJECT="${1:?Usage: scaffold.sh [--firebase] <project-name> [app-name]   |   scaffold.sh --repair [--firebase] <project-path|name> [app-name]}"
  APP="${2:-$PROJECT}"
  PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"
  TARGET="$PROJECTS_DIR/$PROJECT"
  [ -e "$TARGET" ] && { echo "ERROR: '$TARGET' already exists. Choose another name (or use --repair)." >&2; exit 1; }
else
  TARGET_INPUT="${1:?Usage: scaffold.sh --repair [--firebase] <project-path|project-name> [app-name]}"
  if [ -d "$TARGET_INPUT" ]; then
    TARGET="$(cd "$TARGET_INPUT" && pwd)"
  else
    PROJECTS_DIR_FALLBACK="${PROJECTS_DIR:-$HOME/projects}"
    TARGET="$PROJECTS_DIR_FALLBACK/$TARGET_INPUT"
  fi
  [ -d "$TARGET" ] || { echo "ERROR: '$TARGET' does not exist." >&2; exit 1; }
  PROJECT="$(basename "$TARGET")"
  PROJECTS_DIR="$(dirname "$TARGET")"
  # Infer app name if not given: the sole dir under apps/, else the project name.
  APP="${2:-}"
  if [ -z "$APP" ] && [ -d "$TARGET/apps" ]; then
    apps_list=("$TARGET"/apps/*/)
    if [ "${#apps_list[@]}" -eq 1 ] && [ -d "${apps_list[0]}" ]; then
      APP="$(basename "${apps_list[0]}")"
    fi
  fi
  APP="${APP:-$PROJECT}"
fi

# --- resolve the package manager + the three commands the rendered sequences use -------------------------------
# Scaffold sets the house standard (it is creating the project); repair adopts whatever the project already
# uses. Everything downstream goes through these three variables, so a new package manager is one case here
# rather than twenty call sites.
if [ "$MODE" = "scaffold" ]; then
  PM="yarn"; PM_SOURCE="house-default"
else
  read -r PM PM_SOURCE <<< "$(detect_package_manager "$TARGET")"
fi

case "$PM" in
  yarn) PM_INSTALL="yarn install";  PM_EXEC="yarn";           PM_ADD_DEV="yarn add -D" ;;
  # `npx --no-install` deliberately: nx is in node_modules by this point, and without the flag a typo or a
  # pruned package would silently fetch something from the registry and run it instead of failing.
  npm)  PM_INSTALL="npm install";   PM_EXEC="npx --no-install"; PM_ADD_DEV="npm install --save-dev" ;;
  # `-w` is REQUIRED, not optional tidiness: in a pnpm WORKSPACE, `pnpm add` at the root refuses outright
  # (ERR_PNPM_ADDING_TO_ROOT) unless you say you meant the root — and the root is exactly where house
  # tooling belongs. Passing it unconditionally is right for both shapes, since a non-workspace repo's root
  # IS its workspace root.
  pnpm) PM_INSTALL="pnpm install";  PM_EXEC="pnpm exec";       PM_ADD_DEV="pnpm add -D -w" ;;
esac
if [ "$MODE" = "repair" ]; then
  if [ "$PM_SOURCE" = "house-default" ]; then
    echo "Package manager: $PM (this project declares none — using the house default)"
  else
    echo "Package manager: $PM (from $PM_SOURCE — the project's choice, not imposed)"
  fi
fi

# --- repair consent gate (see the header) ---
# The point of this gate is that it cannot be satisfied by inference. A repair is a real, minutes-long,
# file-rewriting action; the hook that notices a stale project can only SAY so. Consent has to come from a
# human, and this is where that is enforced instead of hoped for.
#
# It runs FIRST — before the runtime decision below, before any network call, before anything is read or
# written. An unconsented repair must fail for want of CONSENT, not trip over a missing daemon on its way to
# the same place: "docker not found" would send an agent off to fix Docker and come back (which is precisely
# the inference this gate exists to stop) — and, worse, is now a lie, since the local Node usually suffices.
if [ "$MODE" = "repair" ]; then
  if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    echo "ERROR: refusing to repair in CI — a repair rewrites generated files and no human is here to agree." >&2
    echo "       Run it locally, review the diff against the backup tag, and commit the result." >&2
    exit 1
  fi

  if [ "$CONSENT" != "1" ]; then
    if [ -t 0 ] && [ -t 1 ]; then
      echo "About to repair '$TARGET': re-runs the house generators, REWRITING generated files"
      echo "(HOUSE.md, .claude/settings.json, .devcontainer/*, serve/worktree/design-system targets)."
      echo "A pre-repair snapshot is taken first (git tag), unless --no-backup."
      printf "Proceed? [y/N] "
      read -r reply
      case "$reply" in
        [yY] | [yY][eE][sS]) ;;
        *) echo "Aborted — nothing was changed." >&2; exit 1 ;;
      esac
    else
      echo "ERROR: refusing to repair without consent — nothing is attached to this shell to ask." >&2
      echo "       A repair rewrites generated files and takes several minutes." >&2
      echo "       If (and ONLY if) the user has explicitly agreed to it, re-run with --yes." >&2
      exit 1
    fi
  fi
fi

# --- runtime decision: local Node vs Docker (AFTER the consent gate, so an unconsented repair never gets
#     here). Docker was never the requirement — a modern Node is. When the local Node is new enough we run
#     the generators NATIVELY (no daemon, no image, no mounts) with the path roots bound to real host dirs;
#     otherwise we fall back to the base image, binding the roots to the container mount points. STAGE_BLOCK/
#     WORKSPACE_GEN_BLOCK/INNER below are rendered ONCE against these roots, so the two paths cannot drift. ---
if [ "$FORCE_DOCKER" = "0" ] && local_node_ok; then
  RUNTIME="native"
  echo "Node $(node -v) is new enough — running the generators natively (no Docker)."
  WORK_ROOT="$PROJECTS_DIR"          # where the <project> dir lives (host path)
  ASSETS_ROOT="$ASSETS_DIR"          # nx-tools + compile-generators.mts (host path)
  STAGE_DIR="$(mktemp -d)"           # nx-tools staging dir (native, cleaned up after the run)
  MAJOR="$(node -p 'process.versions.node.split(".")[0]')"   # generated devcontainer's nodeMajor = this Node's
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
  MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
    | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=18' | head -1 || true)"
  [ -n "${MAJOR:-}" ] || MAJOR=24
  IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
  echo "Base image: $IMAGE"
  WORK_ROOT="/work"                  # PROJECTS_DIR is mounted here (see docker run -v below)
  ASSETS_ROOT="/assets"              # ASSETS_DIR is mounted here (ro)
  STAGE_DIR="/tmp/bespunky-nx-tools" # nx-tools staging dir inside the container
  RUNTIME_DESC="image=$IMAGE"
fi
[ -n "$NX_CHANNEL" ] && echo "Nx channel: $NX_CHANNEL (Nx-lag rule — beta toolchain accepted)"
[ "$FIREBASE" = "1" ] && echo "Firebase: opt-in ENABLED (Firebase CLI + Google Cloud CLI + emulator ports)"
[ "$VOICE" = "1" ] && echo "Voice: opt-in ENABLED (WSLg audio bridge + espeak-ng + bespunky-voice plugin — WSL-only)"

# --- THE LAYER SET -------------------------------------------------------------------------------------------
# A project is not one shape; it is a STACK OF LAYERS, each with its own detector and its own generators. This
# is what lets --repair run on a repo that is not the scaffolder's own Angular+Firebase shape — including a
# plain TypeScript repo, or this toolkit itself.
#
# Two distinct questions, deliberately separated:
#   DETECT — what does this workspace already HAVE? Read from the workspace (see src/layers/registry.ts), at
#            run time, inside the target. Never declared, never inferred from flags.
#   ENSURE — which layers should this run BRING INTO BEING? An explicit request, never a guess. Creating an
#            Angular app in someone's repo because a flag defaulted to it is exactly the kind of surprise a
#            repair must never spring.
#
# The generators that run = the union. Detected layers get REFRESHED (that is what repair is); ensured layers
# get created and then refreshed by the same blocks. Which is the whole simplification: SCAFFOLD IS REPAIR
# WITH A FULL ENSURE SET AGAINST AN EMPTY DIRECTORY. One rendered sequence below serves both modes, so the
# two can no longer drift the way two hand-maintained command lists did.
if [ "$MODE" = "scaffold" ]; then
  # A new project is the house shape by definition — the user asked for exactly this.
  ENSURE_DEFAULT="nx,agent,web,angular,design-system"
  [ "$FIREBASE" = "1" ] && ENSURE_DEFAULT="$ENSURE_DEFAULT,firebase"
else
  # A repair ensures NOTHING by default. It refreshes what is there and adds no capability the project didn't
  # ask for — the difference between "bring my house tooling up to date" and "turn my library into an Angular
  # app". `--ensure=agent` on a bare repo is the interesting case: house DX, no framework opinion.
  ENSURE_DEFAULT=""
fi
ENSURE_LAYERS="${ENSURE_ARG:-$ENSURE_DEFAULT}"

# `agent` is the one layer a run cannot sensibly omit once it is touching the project at all: it is the
# devcontainer, the Claude settings and HOUSE.md — the reason to run this tool. Ensuring it implies `nx`,
# because every house generator runs through `nx g`.
case ",$ENSURE_LAYERS," in
  *,agent,*) case ",$ENSURE_LAYERS," in *,nx,*) ;; *) ENSURE_LAYERS="nx,$ENSURE_LAYERS" ;; esac ;;
esac

# Validate against the registry's ids here, in the outer shell, where the error still has a human in front of
# it — rather than letting a typo silently ensure nothing at all.
KNOWN_LAYERS="nx,agent,js,web,angular,design-system,navigation,firebase"
# WHAT THIS SCRIPT CAN ACTUALLY ENSURE IN REPAIR MODE, and nothing more. `nx` (nx init) and `agent` (the
# house generators) are the two it has code for. The rest are created by the SCAFFOLD path — an Nx preset,
# `nx add @nx/angular`, the app generator — which exists only for a brand-new project.
#
# So accepting `--ensure=web` on an existing repo would be a promise the script cannot keep. It ran the
# `web` generators against an app that isn't there and died mid-sequence; worse, had it survived it would
# have STAMPED `web` as applied, and the next run — which re-detects — would not see it, so the tooling
# would rot silently with the stamp claiming otherwise. Refusing up front, with the registry's own hint for
# how to add the layer natively, is the honest move: add the layer with Nx's tooling, then repair, and
# detection picks it up on its own. This is the same reason the ensure/detect split exists at all.
REPAIR_ENSURABLE="nx,agent"
if [ -n "$ENSURE_LAYERS" ]; then
  for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
    case ",$KNOWN_LAYERS," in
      *",$_l,"*) ;;
      *) echo "ERROR: unknown layer '$_l' in --ensure. Known layers: $KNOWN_LAYERS" >&2; exit 1;;
    esac
    if [ "$MODE" = "repair" ]; then
      case ",$REPAIR_ENSURABLE," in
        *",$_l,"*) ;;
        *)
          echo "ERROR: --repair cannot ENSURE the '$_l' layer — it can only refresh a layer that is already there." >&2
          echo "       A repair brings house tooling up to date; it does not add a framework to your project." >&2
          echo "       Add the layer with Nx's own tooling, then re-run --repair and it will be DETECTED:" >&2
          case "$_l" in
            js)            echo "         nx add @nx/js" >&2;;
            web|angular)   echo "         nx add @nx/angular  # then: nx g @bespunky/nx-tools:app apps/<name>" >&2;;
            design-system) echo "         nx g @bespunky/nx-tools:design-system --scope=<scope>" >&2;;
            navigation)    echo "         nx g @bespunky/nx-tools:navigation-core" >&2;;
            firebase)      echo "         re-run with --repair --firebase (which wires Firebase onto an existing app)" >&2;;
          esac
          echo "       Ensurable by --repair: $REPAIR_ENSURABLE" >&2
          exit 1;;
      esac
    fi
  done
fi
[ -n "$ENSURE_LAYERS" ] && echo "Layers to ensure: $ENSURE_LAYERS"

# --- devcontainer generator args ---
# Append (never overwrite) so --firebase and --voice compose in either order. The LAYER flags are resolved at
# run time (they depend on detection), so they are appended inside the rendered sequence, not here.
DEVCONTAINER_FLAGS=""
[ "$FIREBASE" = "1" ] && DEVCONTAINER_FLAGS="$DEVCONTAINER_FLAGS --firebase=true"
[ "$VOICE" = "1" ]    && DEVCONTAINER_FLAGS="$DEVCONTAINER_FLAGS --voice=true"

# --- Firebase opt-in plumbing ---
#   Scaffold mode: the house `app` generator owns the per-app Firebase wiring; we just tell it
#     whether this is a Firebase workspace. firebase.json doesn't exist yet at first-app time, so
#     the generator can't auto-detect — pass the answer explicitly (the generator auto-detects only
#     for LATER apps, when firebase.json is already committed).
#   Repair mode: the app already exists, so we re-apply the per-app Firebase generator directly to
#     it (the `app` generator CREATES apps; it is not the heal path). The generator adds `firebase`
#     + `@angular/fire` to package.json and runs the package-manager install post-commit (via
#     installPackagesTask), so versions resolve to current at scaffold time. No shell-side `yarn add`.
APP_FIREBASE_FLAG="--firebase=false"
[ "$FIREBASE" = "1" ] && APP_FIREBASE_FLAG="--firebase=true"
# --staging (opt-in) requires Firebase; it adds environment.staging.ts + a `staging` build config +
# apphosting.staging.yaml so the workflow's staging App Hosting backend builds its own config/database.
[ "$STAGING" = "1" ] && [ "$FIREBASE" != "1" ] && { echo "ERROR: --staging requires --firebase." >&2; exit 1; }
APP_STAGING_FLAG=""
[ "$STAGING" = "1" ] && APP_STAGING_FLAG=" --staging=true"
REPAIR_FIREBASE_BLOCK=""
if [ "$FIREBASE" = "1" ]; then
  REPAIR_FIREBASE_BLOCK="
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:firebase-emulators --project=$APP --workspaceName=$PROJECT$APP_STAGING_FLAG"
fi

# --- house tooling: stage @bespunky/nx-tools (used by both modes) ---
# @bespunky/nx-tools is bundled scaffold-time tooling: we copy it into node_modules but never
# declare it in package.json (it must not ship in the generated project). The cost of that is
# that every 'yarn install' prunes it. Several generators run installPackagesTask as their
# post-commit step — the `app` generator (via its @nx/angular + firebase-emulators delegates) and
# the playwright generator — so an install fires mid-sequence and deletes nx-tools out from under
# whatever generator runs next. So we compile ONE copy into a stage dir and re-establish it before
# EVERY generator via ensure_nx_tools. This is robust to the order and count of install-triggering
# generators; reordering alone is NOT, since the generator that runs after an install would
# otherwise find nx-tools already pruned. This block (which DEFINES ensure_nx_tools) must run
# before the first @bespunky/nx-tools generator call in either mode.
#
# THE COMPILE BRINGS ITS OWN TYPESCRIPT — it never uses the workspace's. Two independent reasons, one fix:
#   1. compile-generators.mts uses the CLASSIC compiler API (ts.transpileModule / ts.ModuleKind), which the
#      native-port TypeScript 7.x no longer exposes from its main entry (its `.` export is now just
#      lib/version.cjs). `typescript` on npm now resolves to 7.x, so any workspace that has moved on dies
#      with "Cannot read properties of undefined (reading 'CommonJS')". Angular pinning 5.x is the only
#      reason this hasn't bitten yet — it is a timer, not a safety property.
#   2. A workspace need not have TypeScript AT ALL. A repo that just got `nx init` (the non-Angular layer-1
#      path) has none, and installing one into the consumer to satisfy OUR build step would be the tool
#      leaking its needs into the project.
# So the pin lives in a sibling dir that exists only for this compile. The stage itself stays a PURE copy of
# the plugin (no node_modules), which is what lets ensure_nx_tools keep copying it wholesale.
# tools/publish-nx-tools/publish.sh pins the same version for reason (1) — one failure mode, one fix, both places.
STAGE_BLOCK="rm -rf '$STAGE_DIR' '$STAGE_DIR-ts'
cp -r '$ASSETS_ROOT/nx-tools' '$STAGE_DIR'
mkdir -p '$STAGE_DIR-ts'
(cd '$STAGE_DIR-ts' && npm init -y >/dev/null 2>&1 && npm install --no-save --no-audit --no-fund --silent 'typescript@^5' && node '$ASSETS_ROOT/compile-generators.mts' '$STAGE_DIR')
ensure_nx_tools() {
  rm -rf node_modules/@bespunky/nx-tools
  mkdir -p node_modules/@bespunky
  cp -r '$STAGE_DIR' node_modules/@bespunky/nx-tools
}"

# --- ensure the `nx` layer on a repo that has none (the layer-1 ENSURE) ---
# `nx init` is the Nx-native answer to "make this existing repo an Nx workspace" — as opposed to
# create-nx-workspace, which is greenfield-only and is what the scaffold path uses. It is what makes every
# layer above reachable in a repo that was never scaffolded by this tool.
#
# THE ROOT package.json COMES FIRST, and that is not a nicety. Run against a directory without one, `nx init`
# chooses the "dot-nx" installation (.nx/nxw.js + a wrapper script) — in which neither `typescript` nor
# `@nx/devkit` is resolvable from the workspace root and `nx add` FAILS OUTRIGHT. Every house generator is a
# devkit generator, so that mode cannot host this toolkit at all. Seeding a minimal package.json first forces
# the normal node_modules installation, which can. One hosting model, no dot-nx branch.
#
# `nx init` is also a polite co-owner — it MERGES into an existing .claude/settings.json and its CLAUDE.md
# marker block coexists with the house pointer — so this is safe to run in a repo with prior Claude setup.
# The one thing it decides that we override: it sets defaultBase to "master".
NX_INIT_BLOCK="
if [ ! -f nx.json ]; then
  echo '[layers] ensure nx: no nx.json — initialising an Nx workspace in place'
  if [ ! -f package.json ]; then
    echo '[layers] ensure nx: seeding a minimal root package.json (forces the node_modules install mode, not dot-nx)'
    printf '{\\n  \"name\": \"%s\",\\n  \"version\": \"0.0.0\",\\n  \"private\": true\\n}\\n' '$PROJECT' > package.json
  fi
  # DECLARE THE PACKAGE MANAGER BEFORE nx init RUNS, when the repo hasn't declared one itself.
  #
  # \`nx init\` picks its own — npm, absent any lockfile — and takes no flag to say otherwise. So on a repo
  # with no lockfile at all, it would create package-lock.json while everything downstream here used the
  # detected default (yarn), leaving TWO lockfiles that disagree: exactly the state this script refuses to
  # inflict on an npm or pnpm project, arrived at from the other direction. An empty lockfile is the signal
  # Nx reads, so writing one first makes nx init agree with us instead of us discovering it didn't.
  #
  # Only ever in the genuinely-no-signal case. A repo with any lockfile, or a \`packageManager\` field, has
  # already decided, and \$PM above is that decision.
  if [ ! -f yarn.lock ] && [ ! -f package-lock.json ] && [ ! -f pnpm-lock.yaml ]; then
    echo '[layers] ensure nx: no lockfile — declaring $PM (the house default) so nx init agrees with the rest of this run'
    case '$PM' in
      yarn) : > yarn.lock ;;
      pnpm) : > pnpm-lock.yaml ;;
      npm)  : ;;
    esac
  fi
  npx --yes nx@latest init --useDotNxInstallation=false --no-interactive
  [ -x node_modules/.bin/nx ] || $PM_INSTALL
  node -e \"const f='nx.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));if(j.defaultBase==='master'){j.defaultBase='main';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\\n');console.log('[layers] ensure nx: defaultBase master -> main')}\" || true
fi"

# Run the layer-1 ensure only when this run was actually ASKED to create an Nx workspace. A repair that
# merely detects must never conjure one — "this isn't an Nx workspace" is a fact to report, not to fix unasked.
ENSURE_NX_BLOCK=""
case ",$ENSURE_LAYERS," in *,nx,*) ENSURE_NX_BLOCK="$NX_INIT_BLOCK" ;; esac

# --- resolve the ACTIVE layer set at run time, inside the target workspace ---
# Detection reads the workspace itself through the same registry the generators guard on, so the scaffolder
# and the generators can never disagree about what this project is. Degrades to "nothing detected" rather than
# failing the run: on a fresh scaffold the workspace legitimately has no layers yet, and an ensure set that
# names them is the whole instruction.
LAYER_RESOLVE_BLOCK="
# The staged package has to be in place BEFORE detection, not merely before the first generator: detection
# reads the registry out of node_modules/@bespunky/nx-tools, so without this the require fails, DETECTED
# comes back empty, and every layer the workspace actually has is silently missed.
ensure_nx_tools

# @nx/devkit is the MECHANISM FLOOR — every house generator imports it, and so does the layer registry. A
# workspace created by \`create-nx-workspace\` + \`nx add @nx/angular\` gets it transitively, which is why this
# was never needed before; a workspace produced by \`nx init\` gets \`nx\` and NOTHING ELSE. So it is asserted
# here, for every path, rather than assumed from the shape the scaffolder happens to produce. Pinned to the
# installed nx version: a devkit that doesn't match its nx is its own failure mode.
if ! node -e \"require.resolve('@nx/devkit')\" >/dev/null 2>&1; then
  _nxv=\"\$(node -p \"require('nx/package.json').version\" 2>/dev/null || echo latest)\"
  echo \"[layers] @nx/devkit missing (an \\\`nx init\\\` workspace ships only nx) — installing @nx/devkit@\$_nxv\"
  $PM_ADD_DEV \"@nx/devkit@\$_nxv\"
  ensure_nx_tools
fi

ENSURED='$ENSURE_LAYERS'
# Detection must not fail SILENTLY. Swallowing the error here reports 'none', which reads as a legitimate
# bare repo — so every layer the project has would be skipped and its house tooling quietly not applied. A
# sentinel distinguishes 'detected nothing' from 'could not detect', and the latter aborts.
DETECTED=\"\$(node -e \"const {FsTree}=require('nx/src/generators/tree');const {detectLayers}=require('@bespunky/nx-tools/src/layers/registry');console.log(detectLayers(new FsTree(process.cwd(),false)).join(','))\" 2>/dev/null || echo '__DETECT_FAILED__')\"
if [ \"\$DETECTED\" = '__DETECT_FAILED__' ]; then
  echo 'ERROR: could not read this workspace layers (the layer registry failed to load).' >&2
  echo '       Refusing to continue: a failed detection is indistinguishable from an empty project, and' >&2
  echo '       acting on it would skip the house tooling for every layer this project actually has.' >&2
  exit 1
fi
ACTIVE=\"\$(printf '%s\\n%s\\n' \"\$DETECTED\" \"\$ENSURED\" | tr ',' '\\n' | sed '/^\$/d' | sort -u | paste -sd, -)\"
echo \"[layers] detected in workspace : \${DETECTED:-none}\"
echo \"[layers] ensured by this run   : \${ENSURED:-none}\"
echo \"[layers] active (union)        : \${ACTIVE:-none}\"
layer_active() { case \",\$ACTIVE,\" in *\",\$1,\"*) return 0;; esac; return 1; }"

# --- per-workspace house generators, GATED BY LAYER (one sequence, both modes) ---
# Every block below is rendered unconditionally and gated at RUN time on the layer it belongs to. That is what
# collapses scaffold and repair into one path: the difference between them is now entirely in the ensure set,
# not in two separately-maintained command lists that drifted every time one was edited.
#
# The PER-APP generators (serve, serve-options, firebase-emulators) are deliberately NOT here: in scaffold
# mode the `app` generator applies them to the new app; in repair mode they run explicitly against the
# existing app (see each mode's INNER below).
WORKSPACE_GEN_BLOCK="
# --- agent layer: the stack-agnostic house DX. The ONLY block a bare, frameworkless repo runs — and the
#     reason layering exists, since none of it needs Angular, a design system, or anything to serve.
if layer_active agent; then
  # Both layer flags are passed EXPLICITLY, including the false cases. The generator defaults \`web\` to true
  # (the common shape), so omitting it on a library-only repo would silently forward :80 and mount the shared
  # browser volumes into a container that has nothing to serve.
  if layer_active web; then DC_LAYER_FLAGS=' --web=true'; else DC_LAYER_FLAGS=' --web=false'; fi
  if layer_active angular; then DC_LAYER_FLAGS=\"\$DC_LAYER_FLAGS --angular=true\"; else DC_LAYER_FLAGS=\"\$DC_LAYER_FLAGS --angular=false\"; fi
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:devcontainer --name=$PROJECT --nodeMajor=$MAJOR\$DC_LAYER_FLAGS$DEVCONTAINER_FLAGS
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:claude-settings
  # The window identity — an emoji + a quiet, project-coloured status band in .vscode/settings.json, so this
  # project's VSCode window is distinguishable from every other open window. Runs BEFORE the design system, so
  # at scaffold time there is deliberately no primary token to read and the colour is a stable hash of the
  # project NAME (source=name-hash) — distinct per project from moment zero. It upgrades to the real brand
  # colour later, once the design system has real tokens (the bespunky-vscode-identity skill + its offer hook).
  # Idempotent + --repair-safe: the provenance ratchet means this name-hash pass never downgrades a colour a
  # project has since moved to design-system or a hand-picked one.
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:window-identity --name=$PROJECT
fi
# --- web layer: the dev loop. Framework-agnostic by design — the shared browser is pure CDP and the
#     worktree-domains proxy forwards any localhost port, so neither needs Angular.
if layer_active web; then
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:playwright
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:shared-browser
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:worktree-domains
fi
# --- angular layer: the Angular CLI MCP server + the Angular agent skills' gitignore rule.
if layer_active angular; then
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:angular-ai
fi
# --- design-system layer: the workspace's single source of visual truth, present from moment zero (a design
#     system retrofitted after five screens of hardcoded hex is not a design system, it's an archaeology dig).
#     Runs AFTER the app exists so it can open the sass channel on it; a LATER app wires itself, because the
#     \`app\` generator composes the same per-app design-system-styles generator. --scope is load-bearing: the
#     underlying publishable-lib defaults to the @bespunky npm scope (the toolkit's own), which would be wrong
#     for every consumer project. Idempotent in --repair (the token file is seeded, never overwritten — a
#     repair must not restore placeholder tokens over the project's real design).
if layer_active design-system; then
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:design-system --scope=$PROJECT
fi
# --- HOUSE.md last: it STAMPS the layer set, so it must run after every layer above has had its turn (a
#     design system created moments ago has to appear in the stamp that records this run).
if layer_active agent; then
  ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:house-doc --nxToolsVersion=$NX_TOOLS_VERSION --pluginVersion=$PLUGIN_VERSION --layers=\"\$ACTIVE\"
fi
# Persist @bespunky/nx-tools as a real devDependency so the house generators (the app generator
# for adding further apps, plus the reusable-tool extraction generators mark-extractable /
# adopt-extracted) survive 'yarn install' and stay runnable in the project's devcontainer. Graceful
# until the package is first published (see tools/publish-nx-tools); once published, --repair adds
# it to existing projects.
$PM_ADD_DEV @bespunky/nx-tools@^$NX_TOOLS_VERSION || echo 'NOTE: @bespunky/nx-tools not on npm yet — publish it (tools/publish-nx-tools), then scaffold --repair to add it.'"

if [ "$MODE" = "scaffold" ]; then
  INNER="set -e
mkdir -p '$WORK_ROOT'
cd '$WORK_ROOT'
# Set the git identity only if unset. In the throwaway Docker image there is none, so this establishes it;
# on the native path the invoking user already HAS a global identity (it's where \$GIT_NAME came from), so
# this must not clobber it — hence the conditional. Same result on both paths, no drift.
git config --global user.name >/dev/null 2>&1 || git config --global user.name '$GIT_NAME'
git config --global user.email >/dev/null 2>&1 || git config --global user.email '$GIT_EMAIL'
git config --global init.defaultBranch >/dev/null 2>&1 || git config --global init.defaultBranch main
$CREATE_WORKSPACE '$PROJECT' --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive
cd '$PROJECT'
yarn nx add @nx/angular${NX_TAG}
$STAGE_BLOCK
# Create the first app through the HOUSE \`app\` generator (NOT raw @nx/angular:application): it
# delegates to @nx/angular:application with the house defaults AND applies the per-app config
# (serve host 0.0.0.0, plus the full Firebase wiring when --firebase=true). This is the SAME one
# command a developer runs to add any LATER app — first app and Nth app share one code path, so a
# second app can never silently miss the configuration the first app got.
ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:app 'apps/$APP' $APP_FIREBASE_FLAG$APP_STAGING_FLAG
$LAYER_RESOLVE_BLOCK
$WORKSPACE_GEN_BLOCK
# Commit the full scaffold. \`yarn create nx-workspace\` made an initial commit, but the
# house generators + dep installs ran after it — capture them so the host-side push (gh repo
# create --source --push) ships a clean, complete tree on \`main\`.
git add -A
git commit -m 'chore: scaffold BeSpunky project (Nx + Angular + house generators)' || true"
else
  INNER="set -e
cd '$WORK_ROOT/$PROJECT'
$ENSURE_NX_BLOCK
if [ ! -f nx.json ]; then
  echo 'ERROR: not an Nx workspace (no nx.json), and this run was not asked to create one.' >&2
  echo '       Re-run with --ensure=agent to initialise Nx in place and apply the house DX layer' >&2
  echo '       (devcontainer, Claude settings, window identity, HOUSE.md) — no framework opinion.' >&2
  exit 1
fi
if [ ! -x node_modules/.bin/nx ]; then
  echo \"ERROR: node_modules/.bin/nx not found - run '$PM_INSTALL' in the project first, then re-run --repair.\" >&2
  exit 1
fi
$STAGE_BLOCK
$LAYER_RESOLVE_BLOCK
# Repair re-applies the per-app house config to the EXISTING app (the \`app\` generator CREATES apps; it is
# not the heal path), then the workspace-level generators. All idempotent — and all gated on the layer they
# belong to, so a repo with no app never has an app's config applied to a project that isn't there.
# Gated on \`web\`, NOT \`angular\`: both are framework-agnostic now — the composer drives a \`dev-server\`
# target by name, and serve-options just sets host on whatever dev-server is there. An Angular leaf is
# written only when the project has no dev-server of its own (see the serve generator's THE SEAM).
#
# AND gated on the PROJECT EXISTING. \"The web layer is present\" and \"a project named \$APP exists\" are
# different claims: the layer is satisfied by ANY project with a dev-server, while \$APP is inferred (the
# sole dir under apps/, else the repo name) and can easily name nothing at all. Running a per-app generator
# against a project that isn't there is how a repair dies mid-sequence on a repo whose app is called
# something else — a failure about the wrong thing entirely.
project_exists() {
  node -e \"const {FsTree}=require('nx/src/generators/tree');const {getProjects}=require('@nx/devkit');process.exit([...getProjects(new FsTree(process.cwd(),false)).keys()].includes(process.argv[1])?0:1)\" \"\$1\" >/dev/null 2>&1
}
if layer_active web; then
  if project_exists '$APP'; then
    ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:serve --project=$APP
    ensure_nx_tools; $PM_EXEC nx g @bespunky/nx-tools:serve-options --project=$APP
  else
    echo \"[layers] web layer present, but no project named '$APP' — skipping the per-app serve generators.\"
    echo \"[layers]   Pass the app name explicitly to refresh it:  scaffold.sh --repair <project> <app-name>\"
  fi
fi
if layer_active firebase && project_exists '$APP'; then$REPAIR_FIREBASE_BLOCK
  :
fi
$WORKSPACE_GEN_BLOCK"
fi

# --- auto-backup before repair (repair re-runs the house generators, which REWRITE files — e.g.
#     firebase.config.ts is regenerated when a legacy/pre-per-service shape is detected — so snapshot
#     the project to git FIRST, making any clobbered customization recoverable). The snapshot is a
#     TAG built through a throwaway index: HEAD, the branch, the real index and the working tree are
#     left untouched, while committed + uncommitted + untracked content (minus .gitignore) is
#     captured, so repair still runs on the exact current tree. Scaffold mode has nothing to back up
#     (brand-new project). Opt out with --no-backup — but if a backup is wanted and CAN'T be made,
#     ABORT rather than mutate unprotected ("backup before executing any changes"). ---
BACKUP_REF="(--no-backup)"
if [ "$MODE" = "repair" ] && [ "$BACKUP" = "1" ]; then
  if ! git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "BACKUP_ABORT: '$TARGET' is not a git repository, so repair can't snapshot it before changing files." >&2
    echo "  Create a restore point first:  (cd \"$TARGET\" && git init && git add -A && git commit -m 'pre-repair')" >&2
    echo "  …or re-run with --no-backup to repair without one." >&2
    exit 1
  fi
  if [ -z "$(git -C "$TARGET" status --porcelain 2>/dev/null)" ] && git -C "$TARGET" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    # Clean tree: HEAD already IS the pre-repair state — no redundant tag.
    BACKUP_REF="HEAD($(git -C "$TARGET" rev-parse --short HEAD))"
    echo "BACKUP_OK: working tree clean — pre-repair restore point is $BACKUP_REF. Undo a change with: git -C \"$TARGET\" checkout HEAD -- <path>"
  else
    BACKUP_TAG="repair-backup-$(date +%Y%m%d-%H%M%S)"
    BACKUP_INDEX="$(mktemp -u)"
    HEAD_PARENT=""
    git -C "$TARGET" rev-parse --verify -q HEAD >/dev/null 2>&1 && HEAD_PARENT="-p HEAD"
    if GIT_INDEX_FILE="$BACKUP_INDEX" git -C "$TARGET" add -A >/dev/null 2>&1 \
      && _backup_tree="$(GIT_INDEX_FILE="$BACKUP_INDEX" git -C "$TARGET" write-tree 2>/dev/null)" \
      && _backup_commit="$(GIT_AUTHOR_NAME="$GIT_NAME" GIT_AUTHOR_EMAIL="$GIT_EMAIL" GIT_COMMITTER_NAME="$GIT_NAME" GIT_COMMITTER_EMAIL="$GIT_EMAIL" git -C "$TARGET" commit-tree "$_backup_tree" $HEAD_PARENT -m "chore: pre-repair backup ($BACKUP_TAG)" 2>/dev/null)" \
      && git -C "$TARGET" tag "$BACKUP_TAG" "$_backup_commit" >/dev/null 2>&1; then
      rm -f "$BACKUP_INDEX"
      BACKUP_REF="$BACKUP_TAG"
      echo "BACKUP_OK: snapshotted the project (incl. uncommitted + untracked) to tag '$BACKUP_TAG'. Review repair's changes: git -C \"$TARGET\" diff $BACKUP_TAG ; restore a file: git -C \"$TARGET\" checkout $BACKUP_TAG -- <path>"
    else
      rm -f "$BACKUP_INDEX"
      echo "BACKUP_ABORT: could not create the git snapshot — aborting so nothing changes without a backup. (Check 'git -C \"$TARGET\" status', or re-run with --no-backup.)" >&2
      exit 1
    fi
  fi
fi

# --- run the rendered command sequence, on whichever runtime we chose ---
if [ "$RUNTIME" = "native" ]; then
  # Native: the generators run in THIS environment, as the invoking user, writing straight to the host
  # tree — so no mounts, no uid mapping, and no root-owned-files fixup are needed. $INNER's roots are
  # already bound to the real host paths. Clean up the staging dir on any exit.
  trap 'rm -rf "$STAGE_DIR" "$STAGE_DIR-ts"' EXIT
  bash -c "$INNER"
else
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e HOME=/home/node \
    -v "$PROJECTS_DIR":/work -v "$ASSETS_DIR":/assets:ro -w /work \
    "$IMAGE" \
    bash -lc "$INNER"

  # --- normalize ownership back to the invoking host user (Docker path only) ---
  # Some Docker backends (notably Docker Desktop's WSL2 integration) leave freshly created files
  # owned by root despite the `-u` flag above, which makes every later host-side operation
  # (git, yarn, the Claude CLI) fail with permission errors. A throwaway ROOT container hands the
  # whole project tree back to the host uid:gid — the only context that can chown root-owned files
  # without host sudo. Idempotent: a no-op when files are already user-owned. Runs before the gh
  # push so git operations on the tree don't hit permission errors. (The native path never creates
  # root-owned files, so it needs none of this.)
  docker run --rm \
    -v "$PROJECTS_DIR":/work -w /work \
    "$IMAGE" \
    chown -R "$(id -u):$(id -g)" "/work/$PROJECT"
fi

# --- create + push a private GitHub repo (scaffold mode only; gh auth lives on the host) ---
# Runs OUTSIDE Docker: the bare typescript-node base image has neither `gh` nor the host's
# auth. The repo is what lets Firebase App Hosting take over CI/CD — linking it at
# `firebase apphosting:backends:create` makes Firebase provision its own Cloud Build deploys
# (so we generate no workflow files). Non-Firebase projects just get a remote to push to.
# Never fail the scaffold over a missing/unauthenticated gh — the local repo already exists.
GITHUB_RESULT=""
if [ "$MODE" = "scaffold" ] && [ "$GITHUB" = "1" ]; then
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
elif [ "$MODE" = "scaffold" ]; then
  GITHUB_RESULT="GITHUB_SKIP: --no-github"
fi

if [ "$MODE" = "scaffold" ]; then
  echo "SCAFFOLD_OK $TARGET ($RUNTIME_DESC app=apps/$APP firebase=$FIREBASE voice=$VOICE github=$GITHUB) ${GITHUB_RESULT:-}"
else
  echo "REPAIR_OK $TARGET ($RUNTIME_DESC app=apps/$APP firebase=$FIREBASE voice=$VOICE backup=$BACKUP_REF)"
fi
