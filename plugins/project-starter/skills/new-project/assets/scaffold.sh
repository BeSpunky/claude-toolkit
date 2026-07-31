#!/usr/bin/env bash
# Scaffold a BeSpunky-standard project, OR sync the house generators on an existing project.
#
# Default mode  : full scaffold (Nx + Angular + app + house generators + devcontainer + Claude settings).
# Sync mode     : bring an EXISTING workspace up to the current house standard — detect which layers it has,
#                 run the versioned MIGRATIONS between where it is and where this checkout is, then re-apply
#                 the generators that own their output outright. Not convergence: the generators no longer
#                 recognise every shape the toolkit ever produced. Each one-way change ships instead as a
#                 migration keyed to the version that introduced it, collected and ordered by `nx migrate`.
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
#                  Opt out with --no-github. Sync mode never touches the remote.
#                  Why a repo always: Firebase App Hosting deploys are GitHub-driven — linking the repo
#                  at `firebase apphosting:backends:create` is what makes Firebase provision its own
#                  Cloud Build CI/CD. We generate NO deploy workflow; the repo existing from minute one
#                  is what lets Firebase's native mechanism take over (so we never track its evolving
#                  deploy methodology). Non-Firebase projects still benefit from having a remote.
#
# Usage:
#   scaffold.sh [--firebase] [--voice] [--no-github] [--docker] <project-name> [app-name]          # full scaffold
#   scaffold.sh --sync [--ensure=<layers>] [--firebase] [--voice] [--no-backup] [--yes] [--docker] [--local] <project-path|project-name> [app-name]
#
#   --local installs @bespunky/nx-tools from the WORKING TREE (npm pack) instead of the registry — for
#           developing the toolkit itself, where the version under test is not published yet.
#
#   --staging (scaffold or sync) additionally scaffolds the staging environment bundle; requires --firebase.
#   --ensure=<csv> brings layers into being: nx,agent,firebase for a sync; also web,angular,design-system
#                  for a scaffold. Everything else is DETECTED, never ensured.
#
# Sync auto-backup: --sync snapshots the project to a git tag (sync-backup-<ts>) BEFORE running
# any generator, so a regenerated file (e.g. firebase.config.ts) is always recoverable — review with
# `git diff <tag>`, restore with `git checkout <tag> -- <path>`. A clean tree needs no tag (HEAD is the
# restore point). If a backup is wanted but impossible (not a git repo) or fails, sync ABORTS rather
# than change files unprotected. Opt out with --no-backup.
#
# Sync CONSENT GATE (--yes): a sync rewrites generated files and takes minutes — it must never
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
# Leading flags (--sync, --ensure, --firebase, --staging, --voice, --local, --no-github, --no-backup, --yes, --docker)
# may be given in any order.
# PROJECTS_DIR env overrides target root in full mode (default: ~/projects).
#
# WHERE IT RUNS. Docker was never the requirement — a modern NODE is (Docker only ever existed here to
# supply one when the host's Node was too old). So this runs on the LOCAL Node when it's new enough —
# Node 22.18+, the bar for compile-generators.mts's unflagged type-stripping — with no daemon, no image
# pull and no mounts; that is exactly the case INSIDE a devcontainer, so `--sync` works there directly.
# Otherwise it falls back to the typescript-node base image via `docker run`, exactly as before. Both
# paths run the SAME rendered command sequence, so they cannot drift (mirrors tools/publish-nx-tools).
# Force the image with --docker. Never nvm.
set -euo pipefail

# The command line is the first place anyone looks, and until now it was the one place that said nothing:
# `--help` was answered with "unknown flag", and a bare invocation printed a raw bash parameter-expansion
# error whose usage string named only `--firebase`. Every flag below is real and several change what the
# run WRITES, so they belong here rather than only in a header comment nobody runs.
usage() {
  cat <<'USAGE'
scaffold.sh — create a BeSpunky-standard project, or bring an existing one up to the house standard.

  scaffold.sh [flags] <project-name> [app-name]              # SCAFFOLD a new project
  scaffold.sh --sync [flags] <project-path|name> [app-name]  # SYNC an existing one

Flags must come BEFORE the project path.

  --sync            Sync an existing project instead of creating one: run the versioned house
                    migrations, then re-apply the generators that own their output.
  --ensure=<csv>    Layers to BRING INTO BEING (everything else is detected, never ensured).
                      sync    : nx, agent, firebase
                      scaffold: also js, web, angular, design-system, navigation
                    `--ensure=agent` on a bare repo is the usual retrofit: Nx in place plus the
                    stack-agnostic DX layer (devcontainer, Claude settings, window identity, HOUSE.md).
  --firebase        Include the Firebase layer (emulator suite, Cloud Functions app, devcontainer wiring).
  --staging         Also scaffold the staging environment bundle. Requires --firebase.
  --voice           Bridge WSLg audio into the devcontainer and provision bespunky-voice (WSL only).
  --local           Install @bespunky/nx-tools from the WORKING TREE (npm pack) instead of the registry.
                    For developing the toolkit itself; leaves the project holding an unpublished build.
  --yes, -y         Assert that a human explicitly agreed to this sync, in this conversation. The sync
                    refuses to run unattended without it. Never pass it to satisfy the gate.
  --no-backup       Skip the pre-sync git restore point. Migrations are ONE-WAY; there is no undo without it.
  --no-github       Scaffold only: do not create a private GitHub repo.
  --docker          Force the container even when the local Node would do.
  --print-inner     Render the command sequence this run would execute, print it, and exit without
                    running anything. For debugging the scaffolder itself.
  --help, -h        This message.

Environment: PROJECTS_DIR (default ~/projects) is where a scaffold creates the project.
             NX_CHANNEL=next scaffolds on the Nx beta line.
USAGE
}

MODE="scaffold"
FIREBASE=0
VOICE=0    # --voice: bridge WSLg audio into the devcontainer + provision bespunky-voice (WSL-only; opt-in).
STAGING=0  # --staging: also scaffold a first-class staging environment (requires --firebase).
GITHUB=1   # scaffold mode creates a private GitHub repo by default; --no-github opts out.
BACKUP=1   # sync snapshots the project to a git tag BEFORE mutating; --no-backup opts out.
CONSENT=0  # --yes: asserts a human explicitly agreed to this sync (see the consent gate above).
FORCE_DOCKER=0  # --docker: use the base image even when the local Node would do (escape hatch).
ENSURE_ARG=""   # --ensure=<csv>: layers to BRING INTO BEING (see the layer model below). Empty = detect only.
LOCAL_TOOLS=0   # --local: install @bespunky/nx-tools from the WORKING TREE instead of npm (toolkit dev).
PRINT_INNER=0   # --print-inner: render the command sequence to stdout and exit, running nothing.
while [ "${1:-}" != "" ]; do
  case "$1" in
    --sync)       MODE="sync";   shift;;
    --firebase)   FIREBASE=1;    shift;;
    --voice)      VOICE=1;       shift;;
    --staging)    STAGING=1;     shift;;
    --no-github)  GITHUB=0;      shift;;
    --no-backup)  BACKUP=0;      shift;;
    --yes|-y)     CONSENT=1;     shift;;
    --docker)     FORCE_DOCKER=1; shift;;
    --local)      LOCAL_TOOLS=1;  shift;;
    --print-inner) PRINT_INNER=1; shift;;
    --ensure=*)   ENSURE_ARG="${1#--ensure=}"; shift;;
    # The space form takes the NEXT argument as its value, so `--ensure --yes <proj>` would silently swallow
    # `--yes` as a layer list — and the consent gate runs before layer validation, so the user would be told
    # they hadn't consented rather than that they'd mistyped. Reject a flag-shaped value outright.
    --ensure)     case "${2:-}" in
                    ''|-*) echo "ERROR: --ensure needs a comma-separated layer list, got '${2:-}'." >&2
                           echo "       Did you mean --ensure=<layers>? Known layers: nx,agent,js,web,angular,design-system,navigation,firebase" >&2
                           exit 1;;
                  esac
                  ENSURE_ARG="$2"; shift 2;;
    --help|-h)    usage; exit 0;;
    # Lists the valid flags rather than only naming the bad one. Costs two lines and answers the question
    # the reader actually has — including the one case that will keep arriving for a while, `--repair`,
    # which is the old name for `--sync` and is still written into the HOUSE.md of any project generated
    # before that rename. No special case for it: it is simply not a flag, and the list says what is.
    #
    # MATCHES `-*`, NOT `--*`. A single-dash unknown (`-h`, `-v`, `-x`) used to fall through to the `*)`
    # break and then hit the after-the-path guard below, which answered a bare `scaffold.sh -h` with
    # "it comes AFTER the project path" — of an invocation that has no path at all, and then advised
    # putting the flag first, where it already was. An unknown flag is an unknown flag wherever it sits.
    -*)           echo "ERROR: unknown flag '$1'" >&2
                  echo "       Run 'scaffold.sh --help' for the full list." >&2
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
# So a flag written after the project path is not rejected, it is silently absorbed as the APP NAME: `--sync
# <proj> --local` renders `nx g …:serve --project=--local` with --local itself still off. Worse, `--sync
# <proj> --yes` reports that the user has not consented, which sends the reader looking at the wrong thing
# entirely — the same mis-diagnosis the --ensure guard above exists to prevent, one argument over. Catch it
# where the mistake actually is.
for _arg in "$@"; do
  case "$_arg" in
    # `-*`, not just `--*`: `-y` is an accepted alias for `--yes`, so `--sync <proj> -y` was absorbed as the
    # app name and answered with "refusing to sync without consent" — the exact mis-diagnosis this guard
    # exists to prevent, just one dash short of catching it.
    -*)  echo "ERROR: '$_arg' looks like a flag, but it comes AFTER the project path, so it would be read" >&2
         echo "       as a positional argument (the app name). Flags must come FIRST:" >&2
         echo "         scaffold.sh $_arg ... <project> [app-name]" >&2
         exit 1;;
  esac
done
# $3 and beyond are silently ignored otherwise, which hides a typo'd flag or a mis-quoted path.
[ "$#" -le 2 ] || { echo "ERROR: too many arguments — expected at most <project> [app-name], got: $*" >&2; exit 1; }

# --- whose package manager is this? ---------------------------------------------------------------------------
# A SCAFFOLD creates the project, so it sets the house standard: yarn. A SYNC does not get that choice. The
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
# true, which is why `--sync` runs there with no Docker. Mirrors publish.sh's local_node_ok().
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
# Pin the workspace's @bespunky/nx-tools to the SAME version these assets ship (read from
# the source package.json), so the installed runtime executors can never lag the applied project.json
# shape — a 0.x MINOR bump (e.g. 0.3→0.4) would otherwise fall outside a hard-coded caret and silently
# leave the project on the previous executor. Derived, never hand-maintained.
NX_TOOLS_VERSION="$(grep -m1 '"version"' "$ASSETS_DIR/nx-tools/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
[ -n "$NX_TOOLS_VERSION" ] || NX_TOOLS_VERSION="0.4.0"
# The plugin version that ships these assets, read from the manifest three levels up (assets/ lives at
# <plugin>/skills/new-project/assets). Together with NX_TOOLS_VERSION it is STAMPED into the project by the
# house-doc generator (into HOUSE.md's header — root-level and committed, so it reaches every clone), which
# is what lets project-starter's SessionStart hook notice — with a few greps, not a Docker run — that the
# installed toolkit has moved past this project, and ask for a sync. NX_TOOLS_VERSION is the one the hook
# actually compares (it determines what the generators produce); PLUGIN_VERSION is provenance. Derived, never
# hand-maintained; "unknown" if the manifest can't be read (a raw assets checkout), which the hook reads as
# "behind" and resolves by syncing.
PLUGIN_VERSION="$(grep -m1 '"version"' "$ASSETS_DIR/../../../.claude-plugin/plugin.json" 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
[ -n "$PLUGIN_VERSION" ] || PLUGIN_VERSION="unknown"
GIT_NAME="$(git config --global user.name 2>/dev/null || whoami)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "$(whoami)@localhost")"

# --- resolve TARGET + PROJECT + APP based on mode ---
# A missing argument is a usage question, not a bash error. `${1:?…}` printed a raw parameter-expansion
# message ("scaffold.sh: line 213: 1: Usage: …") whose embedded usage line named only --firebase — the most
# likely discovery path in the whole script, advertising a fraction of the flags.
if [ "$#" -eq 0 ]; then
  usage >&2
  echo >&2
  echo "ERROR: no project given." >&2
  exit 1
fi

if [ "$MODE" = "scaffold" ]; then
  PROJECT="$1"
  APP="${2:-$PROJECT}"
  PROJECTS_DIR="${PROJECTS_DIR:-$HOME/projects}"
  TARGET="$PROJECTS_DIR/$PROJECT"
  [ -e "$TARGET" ] && { echo "ERROR: '$TARGET' already exists. Choose another name (or use --sync)." >&2; exit 1; }
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
  PROJECT="$(basename "$TARGET")"
  PROJECTS_DIR="$(dirname "$TARGET")"
  # --- infer the app when one wasn't given ---
  # Read the PROJECT NAMES out of apps/*/project.json rather than counting directories. Two reasons the old
  # "sole directory under apps/" rule failed exactly where it mattered:
  #
  #   1. Every Firebase workspace has apps/functions beside the app, so there were always two directories
  #      and inference never ran at all. It then fell back to the PROJECT FOLDER name, which is right only
  #      by coincidence — rename the folder, or clone it under a different name, and the sync targets a
  #      project that does not exist, skips both per-app generators, and still stamps the project current.
  #   2. A project's Nx name and its directory name are independent. The name is what --project= needs.
  #
  # apps/functions is the house Cloud Functions app, created by the firebase-emulators generator; it is
  # never the app a sync means. Excluding it by name is narrow and honest — if a workspace really does have
  # two candidate apps, inference declines and says so, which is the correct answer rather than a guess.
  APP="${2:-}"
  if [ -z "$APP" ] && [ -d "$TARGET/apps" ]; then
    _cands=()
    for _pj in "$TARGET"/apps/*/project.json; do
      [ -f "$_pj" ] || continue
      _nm="$(grep -m1 '"name"' "$_pj" 2>/dev/null | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
      [ -n "$_nm" ] || _nm="$(basename "$(dirname "$_pj")")"
      [ "$_nm" = "functions" ] && continue
      _cands+=("$_nm")
    done
    if [ "${#_cands[@]}" -eq 1 ]; then
      APP="${_cands[0]}"
    elif [ "${#_cands[@]}" -gt 1 ]; then
      echo "NOTE: this workspace has more than one app (${_cands[*]}), so the app to refresh can't be inferred."
      echo "      Defaulting to '$PROJECT'. Pass one explicitly to target a different app:"
      echo "        scaffold.sh --sync <project> <app-name>"
    else
      # No project.json anywhere under apps/ — fall back to the old rule, which is right for a
      # single-app workspace that predates project.json-per-app.
      apps_list=("$TARGET"/apps/*/)
      if [ "${#apps_list[@]}" -eq 1 ] && [ -d "${apps_list[0]}" ]; then
        APP="$(basename "${apps_list[0]}")"
      fi
    fi
  fi
  APP="${APP:-$PROJECT}"
fi

# --- names are EXECUTED, so validate them before anything else touches them ------------------------------------
# $PROJECT and $APP are interpolated into the rendered command sequence (--project=, --name=, --scope=,
# --workspaceName=) which is then run by `bash -c`. They are not always typed by the user: $APP is INFERRED
# from the sole directory under apps/, and $PROJECT from the directory name — so a cloned repository can
# choose them. A directory literally named `$(...)` or containing a backtick therefore becomes a command
# substitution evaluated at render time, from nothing more than `git clone` plus a sync the user was invited
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
      echo "         scaffold.sh --sync <project-path> <app-name>" >&2
      exit 1 ;;
  esac
}
_check_name project "$PROJECT"
_check_name app "$APP"

# --- resolve the package manager + the three commands the rendered sequences use -------------------------------
# Scaffold sets the house standard (it is creating the project); sync adopts whatever the project already
# uses. Everything downstream goes through these three variables, so a new package manager is one case here
# rather than twenty call sites.
if [ "$MODE" = "scaffold" ]; then
  PM="yarn"; PM_SOURCE="house-default"
else
  read -r PM PM_SOURCE <<< "$(detect_package_manager "$TARGET")"
fi

# PM_ADD_DEV pins EXACTLY — every one of these carries an explicit exact-save flag, and that is load-bearing
# rather than a style choice (see INSTALL_NX_TOOLS for why an accidental caret silently skips the migration
# ladder). npm in particular defaults to `save-prefix=^` and WILL write `^0.24.3` without `--save-exact`;
# yarn 1 and pnpm happen to default to exact today, but that is a default, and a project's `.npmrc` /
# `.yarnrc` can change it under us. Say it out loud in all three.
case "$PM" in
  yarn) PM_INSTALL="yarn install";  PM_EXEC="yarn";           PM_ADD_DEV="yarn add -D -E" ;;
  # `npx --no-install` deliberately: nx is in node_modules by this point, and without the flag a typo or a
  # pruned package would silently fetch something from the registry and run it instead of failing.
  npm)  PM_INSTALL="npm install";   PM_EXEC="npx --no-install"; PM_ADD_DEV="npm install --save-dev --save-exact" ;;
  # `-w` is REQUIRED inside a pnpm WORKSPACE — there `pnpm add` at the root refuses outright
  # (ERR_PNPM_ADDING_TO_ROOT) unless you say you meant the root, and the root is exactly where house tooling
  # belongs. But it is FATAL outside one: `--workspace-root may only be used inside a workspace`, exit 1
  # (verified on pnpm 11.9.0). This used to be tolerated because the install was gated and trailed by a
  # `|| echo NOTE:`; now that installing the toolkit is unconditional and runs under `set -e`, passing it
  # unconditionally would abort every sync on a plain pnpm repo. So ask the workspace which shape it is.
  pnpm) PM_INSTALL="pnpm install";  PM_EXEC="pnpm exec";       PM_ADD_DEV="pnpm add -D -E"
        [ -f "$TARGET/pnpm-workspace.yaml" ] && PM_ADD_DEV="pnpm add -D -w -E" ;;
esac
if [ "$MODE" = "sync" ]; then
  if [ "$PM_SOURCE" = "house-default" ]; then
    echo "Package manager: $PM (this project declares none — using the house default)"
  else
    echo "Package manager: $PM (from $PM_SOURCE — the project's choice, not imposed)"
  fi
fi

# Resolved and VALIDATED before the consent gate below. Argument validation is pure string work — it
# reads nothing, writes nothing, and reaches no network — so doing it first costs nothing and stops the
# script answering a typo with the wrong complaint: `--ensure=bogus` used to be met with "refusing to
# sync without consent", because the gate ran first. A malformed request should be told it is malformed.
# (It also settles FIREBASE before the banner below reports it, so `--ensure=firebase` announces itself.)
# --- THE LAYER SET -------------------------------------------------------------------------------------------
# A project is not one shape; it is a STACK OF LAYERS, each with its own detector and its own generators. This
# is what lets --sync run on a repo that is not the scaffolder's own Angular+Firebase shape — including a
# plain TypeScript repo, or this toolkit itself.
#
# Two distinct questions, deliberately separated:
#   DETECT — what does this workspace already HAVE? Read from the workspace (see src/layers/registry.ts), at
#            run time, inside the target. Never declared, never inferred from flags.
#   ENSURE — which layers should this run BRING INTO BEING? An explicit request, never a guess. Creating an
#            Angular app in someone's repo because a flag defaulted to it is exactly the kind of surprise a
#            sync must never spring.
#
# The generators that run = the union. Detected layers get REFRESHED (that is what sync is); ensured layers
# get created and then refreshed by the same blocks. Which is the whole simplification: SCAFFOLD IS SYNC
# WITH A FULL ENSURE SET AGAINST AN EMPTY DIRECTORY. One rendered sequence below serves both modes, so the
# two can no longer drift the way two hand-maintained command lists did.
if [ "$MODE" = "scaffold" ]; then
  # A new project is the house shape by definition — the user asked for exactly this.
  ENSURE_DEFAULT="nx,agent,web,angular,design-system"
  [ "$FIREBASE" = "1" ] && ENSURE_DEFAULT="$ENSURE_DEFAULT,firebase"
else
  # A sync ensures NOTHING by default. It refreshes what is there and adds no capability the project didn't
  # ask for — the difference between "bring my house tooling up to date" and "turn my library into an Angular
  # app". `--ensure=agent` on a bare repo is the interesting case: house DX, no framework opinion.
  ENSURE_DEFAULT=""
fi
ENSURE_LAYERS="${ENSURE_ARG:-$ENSURE_DEFAULT}"
# NORMALISE AWAY WHITESPACE before anything reads this. Every consumer below matches on comma-delimited
# globs (`*,agent,*`), while the VALIDATOR word-splits — so `--ensure="nx, agent"` passes validation, prints
# a banner claiming both layers, and then matches nothing: the agent⇒nx implication misfires and
# `layer_active agent` is false, so the devcontainer, Claude settings, window identity and HOUSE.md are all
# silently skipped. A csv a human typed with spaces is a csv, not a different request.
ENSURE_LAYERS="$(printf '%s' "$ENSURE_LAYERS" | tr -d '[:space:]')"

# `--firebase` IS an ensure request for the `firebase` layer — they are two spellings of one intent, and
# keeping them as separate concepts is a bug rather than a nuance.
#
# It regressed exactly that way: layering gated the emulator generator on `layer_active firebase`, whose
# detector is `firebase.json` — a file that by definition does NOT exist on the project you are adding
# Firebase to. So `--sync --firebase` silently skipped the wiring while still handing the devcontainer
# `--firebase=true`, producing a Firebase-flavoured container (gcloud CLI, vsfire, emulator ports) attached
# to no emulators at all. Worse, this script's own error text advised that exact command as the way to add
# Firebase. Tying the two together makes the flag mean what it says, in both directions.
case ",$ENSURE_LAYERS," in
  *,firebase,*) FIREBASE=1 ;;
  *) [ "$FIREBASE" = "1" ] && ENSURE_LAYERS="${ENSURE_LAYERS:+$ENSURE_LAYERS,}firebase" ;;
esac

# `agent` is the one layer a run cannot sensibly omit once it is touching the project at all: it is the
# devcontainer, the Claude settings and HOUSE.md — the reason to run this tool. Ensuring it implies `nx`,
# because every house generator runs through `nx g`.
case ",$ENSURE_LAYERS," in
  *,agent,*) case ",$ENSURE_LAYERS," in *,nx,*) ;; *) ENSURE_LAYERS="nx,$ENSURE_LAYERS" ;; esac ;;
esac

# Validate against the registry's ids here, in the outer shell, where the error still has a human in front of
# it — rather than letting a typo silently ensure nothing at all.
KNOWN_LAYERS="nx,agent,js,web,angular,design-system,navigation,firebase"
# WHAT THIS SCRIPT CAN ACTUALLY ENSURE IN SYNC MODE, and nothing more. `nx` (nx init) and `agent` (the
# house generators) are the two it has code for. The rest are created by the SCAFFOLD path — an Nx preset,
# `nx add @nx/angular`, the app generator — which exists only for a brand-new project.
#
# So accepting `--ensure=web` on an existing repo would be a promise the script cannot keep. It ran the
# `web` generators against an app that isn't there and died mid-sequence; worse, had it survived it would
# have STAMPED `web` as applied, and the next run — which re-detects — would not see it, so the tooling
# would rot silently with the stamp claiming otherwise. Refusing up front, with the registry's own hint for
# how to add the layer natively, is the honest move: add the layer with Nx's tooling, then sync, and
# detection picks it up on its own. This is the same reason the ensure/detect split exists at all.
#
# `firebase` IS ensurable here, unlike the rest: the `firebase-emulators` generator genuinely creates that
# layer from nothing (firebase.json, apps/functions, the env files, the emulator project) against an app
# that already exists. That is precisely the "retrofit Firebase onto an existing project" case, and it is
# reached through `--firebase`, which the block above folds into this ensure set.
SYNC_ENSURABLE="nx,agent,firebase"
# Scaffold can create more — it builds the workspace from nothing — but still not everything. `js` and
# `navigation` have no creating step on this path either (their generators are on-demand), so accepting
# them here would silently produce a workspace missing the very layer that was asked for.
SCAFFOLD_ENSURABLE="nx,agent,web,angular,design-system,firebase"
if [ -n "$ENSURE_LAYERS" ]; then
  for _l in $(printf '%s' "$ENSURE_LAYERS" | tr ',' ' '); do
    case ",$KNOWN_LAYERS," in
      *",$_l,"*) ;;
      *) echo "ERROR: unknown layer '$_l' in --ensure. Known layers: $KNOWN_LAYERS" >&2; exit 1;;
    esac
    if [ "$MODE" = "scaffold" ]; then
      case ",$SCAFFOLD_ENSURABLE," in
        *",$_l,"*) ;;
        *)
          echo "ERROR: a scaffold cannot ENSURE the '$_l' layer — nothing on this path creates it." >&2
          echo "       Scaffold the project, then add it with its own generator:" >&2
          case "$_l" in
            js)         echo "         nx g @bespunky/nx-tools:publishable-lib <name> --nonAngular" >&2;;
            navigation) echo "         nx g @bespunky/nx-tools:navigation-core" >&2;;
          esac
          echo "       Ensurable by a scaffold: $SCAFFOLD_ENSURABLE" >&2
          exit 1;;
      esac
    fi
    if [ "$MODE" = "sync" ]; then
      case ",$SYNC_ENSURABLE," in
        *",$_l,"*) ;;
        *)
          echo "ERROR: --sync cannot ENSURE the '$_l' layer — it can only refresh a layer that is already there." >&2
          echo "       A sync brings house tooling up to date; it does not add a framework to your project." >&2
          echo "       Add the layer with Nx's own tooling, then re-run --sync and it will be DETECTED:" >&2
          case "$_l" in
            js)            echo "         nx add @nx/js" >&2;;
            web|angular)   echo "         nx add @nx/angular  # then: nx g @bespunky/nx-tools:app apps/<name>" >&2;;
            design-system) echo "         nx g @bespunky/nx-tools:design-system --scope=<scope>" >&2;;
            navigation)    echo "         nx g @bespunky/nx-tools:navigation-core" >&2;;
          esac
          echo "       Ensurable by --sync: $SYNC_ENSURABLE" >&2
          exit 1;;
      esac
    fi
  done
fi
[ -n "$ENSURE_LAYERS" ] && echo "Layers to ensure: $ENSURE_LAYERS"

# --- sync consent gate (see the header) ---
# The point of this gate is that it cannot be satisfied by inference. A sync is a real, minutes-long,
# file-rewriting action; the hook that notices a stale project can only SAY so. Consent has to come from a
# human, and this is where that is enforced instead of hoped for.
#
# It runs FIRST — before the runtime decision below, before any network call, before anything is read or
# written. An unconsented sync must fail for want of CONSENT, not trip over a missing daemon on its way to
# the same place: "docker not found" would send an agent off to fix Docker and come back (which is precisely
# the inference this gate exists to stop) — and, worse, is now a lie, since the local Node usually suffices.
if [ "$MODE" = "sync" ]; then
  if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
    echo "ERROR: refusing to sync in CI — a sync rewrites generated files and no human is here to agree." >&2
    echo "       Run it locally, review the diff against the backup tag, and commit the result." >&2
    exit 1
  fi

  if [ "$CONSENT" != "1" ]; then
    if [ -t 0 ] && [ -t 1 ]; then
      echo "About to sync '$TARGET': re-runs the house generators, REWRITING generated files"
      echo "(HOUSE.md, .claude/settings.json, .devcontainer/*, serve/worktree/design-system targets)."
      echo "A pre-sync snapshot is taken first (git tag), unless --no-backup."
      printf "Proceed? [y/N] "
      read -r reply
      case "$reply" in
        [yY] | [yY][eE][sS]) ;;
        *) echo "Aborted — nothing was changed." >&2; exit 1 ;;
      esac
    else
      echo "ERROR: refusing to sync without consent — nothing is attached to this shell to ask." >&2
      echo "       A sync rewrites generated files and takes several minutes." >&2
      echo "       If (and ONLY if) the user has explicitly agreed to it, re-run with --yes." >&2
      exit 1
    fi
  fi
fi

# --- runtime decision: local Node vs Docker (AFTER the consent gate, so an unconsented sync never gets
#     here). Docker was never the requirement — a modern Node is. When the local Node is new enough we run
#     the generators NATIVELY (no daemon, no image, no mounts) with the path roots bound to real host dirs;
#     otherwise we fall back to the base image, binding the roots to the container mount points. The
#     WORKSPACE_GEN_BLOCK/INNER below are rendered ONCE against these roots, so the two paths cannot drift. ---
if [ "$FORCE_DOCKER" = "0" ] && local_node_ok; then
  RUNTIME="native"
  echo "Node $(node -v) is new enough — running the generators natively (no Docker)."
  WORK_ROOT="$PROJECTS_DIR"          # where the <project> dir lives (host path)
  ASSETS_ROOT="$ASSETS_DIR"          # nx-tools + compile-generators.mts (host path)
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
  RUNTIME_DESC="image=$IMAGE"
fi
[ -n "$NX_CHANNEL" ] && echo "Nx channel: $NX_CHANNEL (Nx-lag rule — beta toolchain accepted)"
[ "$FIREBASE" = "1" ] && echo "Firebase: opt-in ENABLED (Firebase CLI + Google Cloud CLI + emulator ports)"
[ "$VOICE" = "1" ] && echo "Voice: opt-in ENABLED (WSLg audio bridge + espeak-ng + bespunky-voice plugin — WSL-only)"

# --- devcontainer generator args ---
# Append (never overwrite) so --firebase and --voice compose in either order. The LAYER flags are resolved at
# run time (they depend on detection), so they are appended inside the rendered sequence, not here.
# SCAFFOLD-TIME ONLY. On a scaffold the flags ARE the truth: nothing exists yet to detect, so --firebase
# and --voice are the whole instruction. On a SYNC they are not — see DC_LAYER_FLAGS in the rendered
# sequence, which resolves these from the workspace itself. Passing the flags on a sync is what silently
# stripped the Firebase devcontainer: /sync deliberately adds no flags of its own, so an ordinary sync told
# the generator firebase=false about a project whose firebase layer was detected and refreshed moments
# later — removing the Firebase CLI, the gcloud feature, vsfire, and every forwarded emulator port.
DEVCONTAINER_FLAGS=""
if [ "$MODE" = "scaffold" ]; then
  [ "$FIREBASE" = "1" ] && DEVCONTAINER_FLAGS="$DEVCONTAINER_FLAGS --firebase=true"
  [ "$VOICE" = "1" ]    && DEVCONTAINER_FLAGS="$DEVCONTAINER_FLAGS --voice=true"
fi

# --- Firebase opt-in plumbing ---
#   Scaffold mode: the house `app` generator owns the per-app Firebase wiring; we just tell it
#     whether this is a Firebase workspace. firebase.json doesn't exist yet at first-app time, so
#     the generator can't auto-detect — pass the answer explicitly (the generator auto-detects only
#     for LATER apps, when firebase.json is already committed).
#   Sync mode: the app already exists, so we re-apply the per-app Firebase generator directly to
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
# Rendered UNCONDITIONALLY and gated at RUN time by `layer_active firebase`, exactly like every other layer
# block. Building it only when `--firebase` was passed inverted the layer model: a project WITH firebase.json
# detects the layer, reports it active — and then ran nothing, because the block was an empty string and the
# rendered `if` contained only a `:`. So a plain `--sync` on a Firebase project silently skipped the emulator
# wiring, which is precisely the case that needs it most: this generator owns the emulator suite's shape
# outright and rewrites it every run. (Retiring the legacy per-app `emulators*` targets is no longer its job
# — that is a one-way move, and it belongs to migration 0.24.1.) Projects were left carrying the old shape
# while the sync reported success.
#
# DETECTION drives refresh; `--firebase` only ever controls whether the layer is ENSURED (created where it
# does not yet exist) — which it does by joining the ensure set above, not by gating this call.
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
# and no double quotes. Verify with `scaffold.sh --print-inner …` — it renders the whole program without
# executing it, and ANY stderr during rendering means something in a string was evaluated that should not
# have been. Pipe it into `bash -n /dev/stdin` to syntax-check the result.
# ============================================================================================================
SYNC_FIREBASE_BLOCK="
  $PM_EXEC nx g @bespunky/nx-tools:firebase-emulators --project=$APP --workspaceName=$PROJECT$APP_STAGING_FLAG"

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
# PINNED EXACTLY, no caret — see PM_ADD_DEV, where every package manager is given an explicit exact-save
# flag. `^0.24.0` lets an ordinary `yarn install` float the project to a newer published minor with no
# migration having run; the migrator would then read that newer version as where the project already is and
# skip the whole ladder. `nx migrate` is the only thing that should ever move this. (The migrate step no
# longer *depends* on the pin — it passes an explicit `--from` derived below — but an exact pin keeps the
# declared version and the applied project shape describing the same thing, which is what the stamp claims.)
INSTALL_NX_TOOLS="$PM_ADD_DEV @bespunky/nx-tools@$NX_TOOLS_VERSION"
FINALIZE_LOCAL=""   # only --local needs a post-run manifest correction; see below.
if [ "$LOCAL_TOOLS" = "1" ]; then
  # --local: install the WORKING TREE instead of the registry, for developing the toolkit itself.
  #
  # Still a real install — npm packs the assets into a tarball and installs that, so the package is declared,
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
  cp -r '$ASSETS_ROOT/nx-tools' \"\$_local_stage/nx-tools\"
  mkdir -p \"\$_local_stage/ts\"
  (cd \"\$_local_stage/ts\" && npm init -y >/dev/null 2>&1 && npm install --no-save --no-audit --no-fund --silent 'typescript@^5' && node '$ASSETS_ROOT/compile-generators.mts' \"\$_local_stage/nx-tools\")
  _local_tgz=\"\$(cd \"\$_local_stage/nx-tools\" && npm pack --silent --pack-destination \"\$_local_stage\")\"
  echo \"[tools] --local: installing the working tree (\$_local_tgz) instead of the published package\"
  $PM_ADD_DEV \"\$_local_stage/\$_local_tgz\"
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
fi

# --- run the house MIGRATIONS (sync mode) ---------------------------------------------------------------------
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
#   rm -f migrations.json — Nx never deletes it. Left behind, the next sync re-executes the same ladder
#                           against an already-migrated tree, and it litters the project besides.
MIGRATE_PROBE="
_installed=''
[ -f node_modules/@bespunky/nx-tools/package.json ] \\
  && _installed=\"\$(node -p \"require('./node_modules/@bespunky/nx-tools/package.json').version\" 2>/dev/null || echo '')\"
# ANCHORED on the stamp marker, not on a bare 'nx-tools=' anywhere in the file. HOUSE.md is prose, and an
# unanchored match takes the FIRST hit in the document — so a sentence like 'pin @bespunky/nx-tools=9.9.9'
# in the guidance above the stamp becomes the project's recorded version, and the downgrade guard below then
# hard-refuses a perfectly ordinary sync. The hook reads the same stamp and anchors it this way too.
_stamped=\"\$(grep -o '@bespunky/house-tooling:stamp[^>]*' HOUSE.md 2>/dev/null | head -1 \\
  | grep -o 'nx-tools=[0-9][0-9A-Za-z.+_-]*' | head -1 | cut -d= -f2)\"
# Version ordering, and it is worth doing properly because BOTH the migration floor and the downgrade
# refusal hang off it — get it wrong in one direction and migrations are skipped, in the other and a valid
# sync is hard-refused.
#
# \`sort -V\` is not the tool. It places 0.24.0-rc.1 AFTER 0.24.0 (the opposite of semver, so an rc stamp
# reads as a phantom downgrade), it orders 1.2 before 1.2.0 (they are the same version), it treats
# 1.0.0+build as distinct from 1.0.0 (build metadata carries no precedence), and it sorts a non-numeric
# string ABOVE every number — so one hand-mangled character in a HOUSE.md stamp refuses every future sync.
# All four were reproduced against the previous implementation.
#
# So: compare the leading numeric segments numerically, padded to three, ignoring anything after them; then
# break a tie on prerelease presence (a prerelease is BELOW its own release — an rc has not had the
# release's migrations run against it). Node does the parsing because node is already a hard requirement
# here and this is not worth hand-rolling in sh a second time. Anything unparseable degrades to 'equal',
# which makes the sync a no-op for that comparison rather than a refusal: refusing on garbage would block
# a user over a typo they cannot see.
# The same ordering is implemented in the toolkit's tools/check-release-invariants/rules.cjs, which
# guards releases there. This copy exists because scaffold.sh runs in CONSUMER projects, where that
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
#                              a version above this checkout, syncing moves it backwards.
#
# Taking the min for both looks tidy and quietly disables the downgrade guard: a project stamped 0.99.0 with
# 0.24.2 still in node_modules has min = 0.24.2, which compares equal to a 0.24.2 target, so the guard never
# fires — and the sync then re-stamps HOUSE.md from 0.99.0 down, destroying the only record that the newer
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
# /sync command instructs Claude to treat the [migrate] line as the most consequential thing the sync prints,
# that became a model confidently reporting a ladder that never ran. So the note is composed here, where the
# facts are, and emitted by MIGRATE_RUN, where the migration actually happens.
if [ -n \"\$_installed\" ] && ! _vok \"\$_installed\"; then
  echo \"[migrate] WARNING: node_modules/@bespunky/nx-tools declares an unreadable version (\$_installed) — ignoring it.\" >&2
  _installed=''
fi
if [ -n \"\$_stamped\" ] && ! _vok \"\$_stamped\"; then
  echo \"[migrate] WARNING: HOUSE.md's stamp is not a readable version (\$_stamped) — ignoring it. Fix the stamp\" >&2
  echo \"[migrate]   line in HOUSE.md, or re-run the sync once to have it rewritten.\" >&2
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
# project CURRENT — so no later sync will ever migrate it either. One silent run, unrecoverable.
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
# synced from a newer toolkit — and it is not staleness. Treating it as staleness would install a DOWNGRADE,
# run the older generators over the newer shape, and re-stamp HOUSE.md to the older version, recording a
# state nothing ever migrated back down to. Migrations do not walk backwards, so there is no repair path
# either. Refuse before anything is written.
if [ -n \"\$_highest\" ] && [ \"\$_highest\" != '$NX_TOOLS_VERSION' ] && _vlt '$NX_TOOLS_VERSION' \"\$_highest\"; then
  echo \"ERROR: this project is on house tooling \$_highest, which is NEWER than this checkout's $NX_TOOLS_VERSION.\" >&2
  echo \"       (installed=\${_installed:-none}, HOUSE.md stamp=\${_stamped:-none})\" >&2
  echo '       Syncing would DOWNGRADE it and re-stamp it, and migrations cannot walk backwards.' >&2
  echo '       Update your toolkit first, then sync:  claude plugin marketplace update claude-toolkit' >&2
  exit 1
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
  MIGRATE_COLLECT="  node -e \"const fs=require('fs'),m=require('./node_modules/@bespunky/nx-tools/migrations.json');
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
    .map(([name,g])=>({version:g.version,description:g.description,implementation:g.implementation,package:'@bespunky/nx-tools',name}));
  if(out.length)fs.writeFileSync('migrations.json',JSON.stringify({migrations:out},null,2)+'\\n');
  console.log('[migrate] --local: collected '+out.length+' migration(s) from the working tree')\" \"\$MIGRATE_FROM\" '$NX_TOOLS_VERSION'"
else
  MIGRATE_COLLECT="  NX_MIGRATE_USE_LOCAL=true $PM_EXEC nx migrate '@bespunky/nx-tools@$NX_TOOLS_VERSION' --from=\"@bespunky/nx-tools@\$MIGRATE_FROM\""
fi

# Where a user's swept-up uncommitted work can be recovered from — which depends entirely on whether this run
# took a restore point. Resolved at render time, because --no-backup is known then.
if [ "$BACKUP" = "1" ]; then
  UNCOMMITTED_RECOVERY="They are in the backup tag above if you need them back out."
else
  UNCOMMITTED_RECOVERY="This run was given --no-backup, so there is NO restore point: git is the only copy."
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
  # a single unreadable blob. A sync can apply many one-way deltas across every project in the workspace at
  # once; landing them as one diff makes \`git log -p\` useless exactly where it matters most, and reverting a
  # single bad migration impossible without unpicking it by hand. The backup tag is the blunt undo for the
  # whole run; these commits are the fine-grained one.
  #
  # Two things Nx's implementation forces us to handle rather than pass the flag blindly:
  #   1. It is a HARD ERROR outside a git repo ('--create-commits requires a git repository'). A sync
  #      normally cannot reach here without git, because the backup aborts first — but --no-backup skips
  #      that, and then this would kill an otherwise fine run over a bookkeeping nicety. Detect and drop it.
  #   2. Every commit is built with \`git add -A\`, so anything uncommitted when the sync started is committed
  #      too — into a dedicated 'checkpoint before running migrations' commit that Nx makes before the first
  #      migration. That is Nx's design, not something we can scope down, so the only honest thing is to say
  #      so before it happens; the backup tag already captured that work.
  #   3. That same \`git add -A\` will happily commit node_modules on a repo that does not ignore it — which
  #      is a live case, because --ensure=agent exists to retrofit repos of any shape. Thousands of vendored
  #      files landing in someone's history as a side effect of a version bump is far worse than losing the
  #      per-migration granularity, so check first and drop the flag rather than the repo's history.
  _do_commits=0
  if git rev-parse --git-dir >/dev/null 2>&1; then
    # NO COMMITTER IDENTITY = NO COMMITS, and Nx does not treat that as fatal: it reports that it could not
    # create the checkpoint commit, prints a git fatal per migration, and carries on -- after which this
    # script prints SYNC_OK. The migrations are applied and stamped, but the commit ladder the user was
    # promised is simply absent and the work is left as a pile of dirty files with a half-staged index.
    # Check first and say so, the same way the node_modules case does, rather than advertising a safety net
    # that will not appear.
    if ! git config user.email >/dev/null 2>&1 || ! git config user.name >/dev/null 2>&1; then
      echo '[migrate] this repository has no git user.name/user.email, so commits cannot be created —'
      echo '[migrate]   running the migrations WITHOUT the per-migration commit ladder. Set an identity'
      echo '[migrate]   with git config user.email to get it.'
    elif [ -d node_modules ] && ! git check-ignore -q node_modules 2>/dev/null; then
      echo '[migrate] node_modules is NOT git-ignored here, and per-migration commits are built with'
      echo '[migrate]   \"git add -A\" — which would commit it. Running the migrations WITHOUT commits.'
      echo '[migrate]   Add node_modules to .gitignore to get the per-migration commit ladder.'
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
      if [ -n \"\$(git status --porcelain 2>/dev/null)\" ]; then
        echo '[migrate] NOTE: this tree has uncommitted changes. Nx commits each migration with \"git add -A\",'
        echo '[migrate]   so those changes are committed too, in the checkpoint commit it makes before the'
        echo '[migrate]   first migration.'
        # Rendered against THIS run: naming a backup tag that --no-backup never created sends someone
        # looking for a recovery point that does not exist, at the one moment they actually need it.
        echo '[migrate]   $UNCOMMITTED_RECOVERY'
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
  # point -- a stamped-but-unmigrated project is unrecoverable, while a failed sync is just a re-run.
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
    NX_MIGRATE_SKIP_INSTALL=true NX_MIGRATE_USE_LOCAL=true $PM_EXEC nx migrate --run-migrations --if-exists --agentic=false --create-commits
  else
    NX_MIGRATE_SKIP_INSTALL=true NX_MIGRATE_USE_LOCAL=true $PM_EXEC nx migrate --run-migrations --if-exists --agentic=false
  fi
  # nx never deletes migrations.json — it only ever writes it. So if it is gone now, something else
  # removed it mid-run (a concurrent sync is the way this actually happens), and --if-exists will have
  # quietly applied nothing. Stop BEFORE house-doc writes a stamp that would make this permanent.
  if [ \"\$_expected\" -gt 0 ] && [ ! -f migrations.json ]; then
    echo 'ERROR: the migration list disappeared while it was being applied, so the ladder did NOT run.' >&2
    echo '       This is what two syncs running at once does. Nothing has been stamped, so the project' >&2
    echo '       is still in its previous state — re-run the sync once nothing else is touching it.' >&2
    exit 1
  fi
  rm -f migrations.json
fi"

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

# Run the layer-1 ensure only when this run was actually ASKED to create an Nx workspace. A sync that
# merely detects must never conjure one — "this isn't an Nx workspace" is a fact to report, not to fix unasked.
ENSURE_NX_BLOCK=""
case ",$ENSURE_LAYERS," in *,nx,*) ENSURE_NX_BLOCK="$NX_INIT_BLOCK" ;; esac

# --- resolve the ACTIVE layer set at run time, inside the target workspace ---
# Detection reads the workspace itself through the same registry the generators guard on, so the scaffolder
# and the generators can never disagree about what this project is. Degrades to "nothing detected" rather than
# failing the run: on a fresh scaffold the workspace legitimately has no layers yet, and an ensure set that
# names them is the whole instruction.
LAYER_RESOLVE_BLOCK="
# @bespunky/nx-tools must be INSTALLED before detection, not merely before the first generator: detection
# reads the layer registry out of node_modules/@bespunky/nx-tools, so without it the require fails, DETECTED
# comes back empty, and every layer the workspace actually has is silently missed. INSTALL_NX_TOOLS runs
# above for exactly this reason.

# @nx/devkit is the MECHANISM FLOOR — every house generator imports it, and so does the layer registry. A
# workspace created by \`create-nx-workspace\` + \`nx add @nx/angular\` gets it transitively, which is why this
# was never needed before; a workspace produced by \`nx init\` gets \`nx\` and NOTHING ELSE. So it is asserted
# here, for every path, rather than assumed from the shape the scaffolder happens to produce. Pinned to the
# installed nx version: a devkit that doesn't match its nx is its own failure mode.
if ! node -e \"require.resolve('@nx/devkit')\" >/dev/null 2>&1; then
  _nxv=\"\$(node -p \"require('nx/package.json').version\" 2>/dev/null || echo latest)\"
  echo \"[layers] @nx/devkit missing (an \\\`nx init\\\` workspace ships only nx) — installing @nx/devkit@\$_nxv\"
  $PM_ADD_DEV \"@nx/devkit@\$_nxv\"
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
# collapses scaffold and sync into one path: the difference between them is now entirely in the ensure set,
# not in two separately-maintained command lists that drifted every time one was edited.
#
# The PER-APP generators (serve, serve-options, firebase-emulators) are deliberately NOT here: in scaffold
# mode the `app` generator applies them to the new app; in sync mode they run explicitly against the
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
  # firebase comes from DETECTION, exactly like web and angular. A sync must describe the project it is
  # looking at, not the flags it happened to be invoked with.
  if layer_active firebase; then DC_LAYER_FLAGS=\"\$DC_LAYER_FLAGS --firebase=true\"; else DC_LAYER_FLAGS=\"\$DC_LAYER_FLAGS --firebase=false\"; fi
  # voice has no layer to detect — nothing it installs leaves a trace in the workspace. Its previous answer
  # lives in the ownership marker the generator itself wrote, so carry that forward rather than silently
  # revoking it; an explicit --voice on this run still wins.
  _dc_voice='$VOICE'
  if [ \"\$_dc_voice\" != '1' ] && [ -f .devcontainer/.bespunky-devcontainer.json ]; then
    grep -q '\"voice\"[[:space:]]*:[[:space:]]*true' .devcontainer/.bespunky-devcontainer.json 2>/dev/null && _dc_voice=1
  fi
  if [ \"\$_dc_voice\" = '1' ]; then DC_LAYER_FLAGS=\"\$DC_LAYER_FLAGS --voice=true\"; fi
  $PM_EXEC nx g @bespunky/nx-tools:devcontainer --name=$PROJECT --nodeMajor=$MAJOR\$DC_LAYER_FLAGS$DEVCONTAINER_FLAGS
  $PM_EXEC nx g @bespunky/nx-tools:claude-settings
  # The window identity — an emoji + a quiet, project-coloured status band in .vscode/settings.json, so this
  # project's VSCode window is distinguishable from every other open window. Runs BEFORE the design system, so
  # at scaffold time there is deliberately no primary token to read and the colour is a stable hash of the
  # project NAME (source=name-hash) — distinct per project from moment zero. It upgrades to the real brand
  # colour later, once the design system has real tokens (the bespunky-vscode-identity skill + its offer hook).
  # Idempotent + --sync-safe: the provenance ratchet means this name-hash pass never downgrades a colour a
  # project has since moved to design-system or a hand-picked one.
  $PM_EXEC nx g @bespunky/nx-tools:window-identity --name=$PROJECT
fi
# --- web layer: the dev loop. Framework-agnostic by design — the shared browser is pure CDP and the
#     worktree-domains proxy forwards any localhost port, so neither needs Angular.
if layer_active web; then
  $PM_EXEC nx g @bespunky/nx-tools:playwright
  $PM_EXEC nx g @bespunky/nx-tools:shared-browser
  $PM_EXEC nx g @bespunky/nx-tools:worktree-domains
fi
# --- angular layer: the Angular CLI MCP server + the Angular agent skills' gitignore rule.
if layer_active angular; then
  $PM_EXEC nx g @bespunky/nx-tools:angular-ai
fi
# --- design-system layer: the workspace's single source of visual truth, present from moment zero (a design
#     system retrofitted after five screens of hardcoded hex is not a design system, it's an archaeology dig).
#     Runs AFTER the app exists so it can open the sass channel on it; a LATER app wires itself, because the
#     \`app\` generator composes the same per-app design-system-styles generator. --scope is load-bearing: the
#     underlying publishable-lib defaults to the @bespunky npm scope (the toolkit's own), which would be wrong
#     for every consumer project. Idempotent in --sync (the token file is seeded, never overwritten — a
#     sync must not restore placeholder tokens over the project's real design).
if layer_active design-system; then
  $PM_EXEC nx g @bespunky/nx-tools:design-system --scope=$PROJECT
fi
# --- HOUSE.md last: it STAMPS the layer set, so it must run after every layer above has had its turn (a
#     design system created moments ago has to appear in the stamp that records this run).
if layer_active agent; then
  $PM_EXEC nx g @bespunky/nx-tools:house-doc --nxToolsVersion=$NX_TOOLS_VERSION --pluginVersion=$PLUGIN_VERSION --packageManager=$PM --layers=\"\$ACTIVE\"
fi
# @bespunky/nx-tools is installed UP FRONT now (see INSTALL_NX_TOOLS), so nothing is added here — it is
# already a declared devDependency by the time any generator runs, which is what makes it survive the
# \`installPackagesTask\` several generators fire mid-sequence.
"

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
# THE AGENT-MODE ENV VARS ARE STRIPPED FOR THIS ONE COMMAND, and that is the difference between a working
# scaffold and a dead one.
#
# create-nx-workspace reads CLAUDECODE / OPENCODE and switches into an \"AI Agent Mode\" that IGNORES
# --preset entirely: it builds from \`nrwl/empty-template\` instead, which is the TS-solution layout
# (packages/ + a root tsconfig.json with project references + package.json-based Nx config) and additionally
# litters the repo with AGENTS.md, opencode.json, .codex/, .cursor/, .gemini/. \`nx add @nx/angular\` then
# REFUSES that workspace outright — \"The Angular framework doesn't support a TypeScript setup with project
# references\" — so the scaffold died at its first real step.
#
# The sting is that this only happens when the scaffolder is run FROM Claude Code, which is its primary way
# of being used: run it by hand in a terminal and it works, run it the way this toolkit intends and it does
# not. Nothing in the script had changed; the environment silently reinterpreted its arguments.
#
# Scoped to this invocation deliberately. These variables are true — an agent IS running this — and other
# tools may reasonably key off them. What is not acceptable is one command redefining the workspace shape
# the entire house standard is built on. Every house generator reads project.json (\`readProjectConfiguration\`),
# which the TS-solution layout does not use, so this is not a cosmetic preference.
env -u CLAUDECODE -u OPENCODE $CREATE_WORKSPACE '$PROJECT' --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive --workspaces=false
cd '$PROJECT'
yarn nx add @nx/angular${NX_TAG}
$INSTALL_NX_TOOLS
# Create the first app through the HOUSE \`app\` generator (NOT raw @nx/angular:application): it
# delegates to @nx/angular:application with the house defaults AND applies the per-app config
# (serve host 0.0.0.0, plus the full Firebase wiring when --firebase=true). This is the SAME one
# command a developer runs to add any LATER app — first app and Nth app share one code path, so a
# second app can never silently miss the configuration the first app got.
$PM_EXEC nx g @bespunky/nx-tools:app 'apps/$APP' $APP_FIREBASE_FLAG$APP_STAGING_FLAG
$LAYER_RESOLVE_BLOCK
$WORKSPACE_GEN_BLOCK
# Commit the full scaffold. \`yarn create nx-workspace\` made an initial commit, but the
# house generators + dep installs ran after it — capture them so the host-side push (gh repo
# create --source --push) ships a clean, complete tree on \`main\`.
git add -A
git commit -m 'chore: scaffold BeSpunky project (Nx + Angular + house generators)' || true
$FINALIZE_LOCAL"
else
  INNER="set -e
cd '$WORK_ROOT/$PROJECT'
# THE PROBE COMES FIRST — before \`nx init\`, not merely before the install. It reads only node_modules and
# HOUSE.md, so it is safe this early, and its downgrade refusal claims to stop \"before anything is written\".
# With ENSURE_NX_BLOCK ahead of it that claim was false: on --ensure=nx or --ensure=agent, \`nx init\` had
# already created nx.json, a package.json and a lockfile in someone's repo before we decided the sync should
# not happen at all. A guard that fires after the first write is a guard that arrives too late.
_SYNC_PARTIAL=0
_stage() { [ -d .bespunky-sync.lock ] && printf 'stage=%s\n' \"\$1\" > .bespunky-sync.lock/state 2>/dev/null || true; }
_stage probe
$MIGRATE_PROBE
$ENSURE_NX_BLOCK
if [ ! -f nx.json ]; then
  echo 'ERROR: not an Nx workspace (no nx.json), and this run was not asked to create one.' >&2
  echo '       Re-run with --ensure=agent to initialise Nx in place and apply the house DX layer' >&2
  echo '       (devcontainer, Claude settings, window identity, HOUSE.md) — no framework opinion.' >&2
  exit 1
fi
if [ ! -x node_modules/.bin/nx ]; then
  echo \"ERROR: node_modules/.bin/nx not found - run '$PM_INSTALL' in the project first, then re-run --sync.\" >&2
  exit 1
fi
_stage install
$INSTALL_NX_TOOLS
_stage migrate
$MIGRATE_RUN
[ -d .bespunky-sync.lock ] && printf 'migrations=%s\n' \"\${_expected:-0}\" >> .bespunky-sync.lock/state 2>/dev/null || true
_stage generators
$LAYER_RESOLVE_BLOCK
# Sync re-applies the per-app house config to the EXISTING app (the \`app\` generator CREATES apps; it is
# not the heal path), then the workspace-level generators. All idempotent — and all gated on the layer they
# belong to, so a repo with no app never has an app's config applied to a project that isn't there.
# Gated on \`web\`, NOT \`angular\`: both are framework-agnostic now — the composer drives a \`dev-server\`
# target by name, and serve-options just sets host on whatever dev-server is there. An Angular leaf is
# written only when the project has no dev-server of its own (see the serve generator's THE SEAM).
#
# AND gated on the PROJECT EXISTING. \"The web layer is present\" and \"a project named \$APP exists\" are
# different claims: the layer is satisfied by ANY project with a dev-server, while \$APP is inferred (the
# sole dir under apps/, else the repo name) and can easily name nothing at all. Running a per-app generator
# against a project that isn't there is how a sync dies mid-sequence on a repo whose app is called
# something else — a failure about the wrong thing entirely.
project_exists() {
  node -e \"const {FsTree}=require('nx/src/generators/tree');const {getProjects}=require('@nx/devkit');process.exit([...getProjects(new FsTree(process.cwd(),false)).keys()].includes(process.argv[1])?0:1)\" \"\$1\" >/dev/null 2>&1
}
if layer_active web; then
  if project_exists '$APP'; then
    $PM_EXEC nx g @bespunky/nx-tools:serve --project=$APP
    $PM_EXEC nx g @bespunky/nx-tools:serve-options --project=$APP
  else
    echo \"[layers] WARNING: web layer present, but no project named '$APP' — SKIPPING the per-app generators.\"
    echo \"[layers]   This sync is INCOMPLETE: migrations and workspace generators ran, but this app's own\"
    echo \"[layers]   serve wiring was not refreshed. Re-run naming the app:\"
    echo \"[layers]     scaffold.sh --sync <project> <app-name>\"
    _SYNC_PARTIAL=1
  fi
fi
# \`angular\` is in the gate because the generator REQUIRES it (it writes environment files,
# firebase.config.ts and the app.config.ts provider) and asserts that with its own requireLayer. Without it
# the gate would open on any repo carrying a firebase.json — a functions-only or hosting-only site — and the
# generator's guard would then abort the whole sync over a layer the project never claimed to have.
if layer_active firebase && layer_active angular && project_exists '$APP'; then$SYNC_FIREBASE_BLOCK
elif layer_active firebase; then
  echo '[layers] WARNING: firebase detected, but the emulator wiring needs an Angular app here — SKIPPING it.'
  echo '[layers]   This sync is INCOMPLETE for the Firebase layer.'
  _SYNC_PARTIAL=1
fi
$WORKSPACE_GEN_BLOCK
$FINALIZE_LOCAL
# A run that skipped generators is not a clean run, and the outer summary prints SYNC_OK either way.
# Say so here, while the reason is still on screen, so neither a human nor a model reads that final
# line as everything-was-applied.
if [ \"\$_SYNC_PARTIAL\" = '1' ]; then
  echo 'SYNC_PARTIAL: some generators were skipped — see the [layers] WARNING lines above. The project'
  echo '  was still stamped, so a later sync will NOT retry them on its own; re-run addressing the warning.'
fi"
fi

# --- single writer per project ------------------------------------------------------------------------------
# Two syncs on one project is not a hypothetical: it is one impatient re-run, or a hook-suggested sync landing
# on top of a manual one. They race over node_modules, the lockfile, HOUSE.md — and over `migrations.json`,
# which is the dangerous one. Every sync starts its migrate step with `rm -f migrations.json`; if that lands
# between another run's collect and its `--run-migrations`, `--if-exists` turns "the ladder vanished" into
# "nothing to do", that run applies ZERO migrations, and house-doc then stamps the project current. The
# result is a project that claims to be migrated and is not, which no later sync will ever revisit.
#
# `mkdir` is the lock because it is atomic on every filesystem that matters — test-then-create is not. The
# PID inside lets a genuinely dead run be taken over rather than wedging the project forever, which is the
# failure mode that makes people delete lock files by hand and lose the protection entirely.
SYNC_LOCK=""
if [ "$MODE" = "sync" ]; then
  SYNC_LOCK="$TARGET/.bespunky-sync.lock"
  if ! mkdir "$SYNC_LOCK" 2>/dev/null; then
    _holder="$(cat "$SYNC_LOCK/pid" 2>/dev/null || echo '')"
    if [ -n "$_holder" ] && kill -0 "$_holder" 2>/dev/null; then
      echo "ERROR: another sync is already running for this project (pid $_holder)." >&2
      echo "       Two syncs at once can leave the project stamped as migrated when it is not." >&2
      echo "       Wait for it to finish, or stop it, then re-run." >&2
      exit 1
    fi
    # The holder is gone — a killed or crashed run. Take it over rather than refusing forever.
    echo "NOTE: found a stale sync lock from pid ${_holder:-unknown} (no longer running) — taking it over."
    rm -rf "$SYNC_LOCK"
    mkdir "$SYNC_LOCK" 2>/dev/null || { echo "ERROR: could not create the sync lock at $SYNC_LOCK." >&2; exit 1; }
  fi
  printf '%s\n' "$$" > "$SYNC_LOCK/pid" 2>/dev/null || true
  # Released on ANY exit, including the refusals above this line's own guards and every early failure below.
  trap 'rm -rf "$SYNC_LOCK"' EXIT INT TERM
fi

# --- the repository has to be in a state where committing means what it says ----------------------------------
# The migration ladder commits, and Nx builds every one of those commits with `git add -A`. That is fine in a
# normal working tree and actively destructive in two states git can legitimately be in.
if [ "$MODE" = "sync" ] && git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # --absolute-git-dir, not --git-dir: the plain form answers RELATIVE to the repository ("`.git`"), and this
  # script's own working directory is not the project, so every `-e "$_gd/MERGE_HEAD"` below silently missed.
  _gd="$(git -C "$TARGET" rev-parse --absolute-git-dir 2>/dev/null || echo '')"

  # 1. AN OPERATION IS ALREADY IN PROGRESS. `git add -A` during an unresolved merge stages the CONFLICT
  #    MARKERS and the checkpoint commit concludes the merge with them in it — a real two-parent commit, so
  #    `git merge` afterwards says "Already up to date" and `git branch --merged` lists a branch whose content
  #    was never actually merged. The backup tag does not save you either: it has one parent, so it does not
  #    record the merge at all. This is the only failure here that corrupts history rather than just failing,
  #    and once pushed it is everyone's problem.
  _busy=""
  [ -n "$_gd" ] && [ -e "$_gd/MERGE_HEAD" ]        && _busy="a merge"
  [ -n "$_gd" ] && [ -d "$_gd/rebase-merge" ]      && _busy="a rebase"
  [ -n "$_gd" ] && [ -d "$_gd/rebase-apply" ]      && _busy="a rebase"
  [ -n "$_gd" ] && [ -e "$_gd/CHERRY_PICK_HEAD" ]  && _busy="a cherry-pick"
  [ -n "$_gd" ] && [ -e "$_gd/REVERT_HEAD" ]       && _busy="a revert"
  if [ -n "$_busy" ]; then
    echo "ERROR: $_busy is in progress in this repository, so the sync will not run." >&2
    echo "       The house migrations commit as they go, and git stages EVERYTHING when they do — mid-$_busy" >&2
    echo "       that would commit the unresolved state, and in the merge case record the branch as merged" >&2
    echo "       when its content never was." >&2
    echo "       Finish or abort it first, then re-run the sync." >&2
    exit 1
  fi

  # 2. DETACHED HEAD. The migrations would be committed to no branch at all: nothing names them afterwards,
  #    `git checkout <branch>` refuses because the tree is dirty, and forcing it discards the entire run.
  #    The backup path makes it worse by reporting HEAD as the restore point, which is not a durable ref here.
  if ! git -C "$TARGET" symbolic-ref -q HEAD >/dev/null 2>&1; then
    echo "ERROR: this repository has a detached HEAD, so the sync will not run." >&2
    echo "       The migrations commit as they go; on a detached HEAD those commits belong to no branch and" >&2
    echo "       are lost the moment you check one out." >&2
    echo "       Check out a branch first (git switch -c <name> keeps what is here), then re-run." >&2
    exit 1
  fi
fi

# --- auto-backup before sync. Sync REWRITES files on two counts now: the generators regenerate what they
#     own outright (firebase.config.ts, for one, unconditionally), and the MIGRATIONS apply one-way deltas
#     across every project in the workspace. Migrations in particular have no reverse — `nx migrate` walks
#     forwards only — so this snapshot is the sole undo, and it matters more than it did under convergence.
#     Take it FIRST, making any clobbered customization recoverable. The snapshot is a
#     TAG built through a throwaway index: HEAD, the branch, the real index and the working tree are
#     left untouched, while committed + uncommitted + untracked content (minus .gitignore) is
#     captured, so sync still runs on the exact current tree. Scaffold mode has nothing to back up
#     (brand-new project). Opt out with --no-backup — but if a backup is wanted and CAN'T be made,
#     ABORT rather than mutate unprotected ("backup before executing any changes"). ---
BACKUP_REF="(--no-backup)"
# Say it out loud. Under convergence a sync re-asserted state and re-running was the informal undo; under
# migrations it applies ONE-WAY deltas that have no reverse, so the restore point is the only way back and
# turning it off is a materially bigger decision than it was. The only other trace of that choice was
# `backup=(--no-backup)` in the final SYNC_OK line, printed after everything had already happened.
if [ "$MODE" = "sync" ] && [ "$BACKUP" != "1" ]; then
  echo "WARNING: --no-backup — no restore point will be taken, and the house migrations are ONE-WAY."
  echo "         If a migration does the wrong thing to this project there is no undo. Ctrl+C now if that"
  echo "         was not deliberate."
fi
if [ "$MODE" = "sync" ] && [ "$BACKUP" = "1" ]; then
  if ! git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "BACKUP_ABORT: '$TARGET' is not a git repository, so sync can't snapshot it before changing files." >&2
    echo "  Create a restore point first:  (cd \"$TARGET\" && git init && git add -A && git commit -m 'pre-sync')" >&2
    echo "  …or re-run with --no-backup to sync without one." >&2
    exit 1
  fi
  if [ -z "$(git -C "$TARGET" status --porcelain 2>/dev/null)" ] && git -C "$TARGET" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    # Clean tree: HEAD already IS the pre-sync state — no redundant tag.
    BACKUP_REF="HEAD($(git -C "$TARGET" rev-parse --short HEAD))"
    echo "BACKUP_OK: working tree clean — pre-sync restore point is $BACKUP_REF. Undo a change with: git -C \"$TARGET\" checkout HEAD -- <path>"
  else
    BACKUP_TAG="sync-backup-$(date +%Y%m%d-%H%M%S)"
    BACKUP_INDEX="$(mktemp -u)"
    HEAD_PARENT=""
    git -C "$TARGET" rev-parse --verify -q HEAD >/dev/null 2>&1 && HEAD_PARENT="-p HEAD"
    if GIT_INDEX_FILE="$BACKUP_INDEX" git -C "$TARGET" add -A >/dev/null 2>&1 \
      && _backup_tree="$(GIT_INDEX_FILE="$BACKUP_INDEX" git -C "$TARGET" write-tree 2>/dev/null)" \
      && _backup_commit="$(GIT_AUTHOR_NAME="$GIT_NAME" GIT_AUTHOR_EMAIL="$GIT_EMAIL" GIT_COMMITTER_NAME="$GIT_NAME" GIT_COMMITTER_EMAIL="$GIT_EMAIL" git -C "$TARGET" commit-tree "$_backup_tree" $HEAD_PARENT -m "chore: pre-sync backup ($BACKUP_TAG)" 2>/dev/null)" \
      && git -C "$TARGET" tag "$BACKUP_TAG" "$_backup_commit" >/dev/null 2>&1; then
      rm -f "$BACKUP_INDEX"
      BACKUP_REF="$BACKUP_TAG"
      echo "BACKUP_OK: snapshotted the project (incl. uncommitted + untracked) to tag '$BACKUP_TAG'. Review sync's changes: git -C \"$TARGET\" diff $BACKUP_TAG ; restore a file: git -C \"$TARGET\" checkout $BACKUP_TAG -- <path>"
    else
      rm -f "$BACKUP_INDEX"
      echo "BACKUP_ABORT: could not create the git snapshot — aborting so nothing changes without a backup. (Check 'git -C \"$TARGET\" status', or re-run with --no-backup.)" >&2
      exit 1
    fi
  fi
fi

# --- two lockfiles: damage this toolkit caused, and will otherwise keep believing ----------------------------
# Before nx-tools 0.18.0 the generated post-create.sh hardcoded `yarn install`, while scaffold.sh already
# detected npm and pnpm correctly. So a devcontainer build on an npm project ran yarn and left a yarn.lock
# beside package-lock.json. After that `npm ci` fails for the whole team, and the cause — a container rebuild
# weeks earlier — is nowhere near the symptom.
#
# The 0.18.0 fix made it PERMANENT rather than repairing it: every detector here checks yarn.lock BEFORE
# package-lock.json, so the stray file the old script planted became the evidence every later run trusts, and
# the sync itself keeps choosing yarn in an npm project.
#
# Placed after the backup deliberately: a deletion below is inside the restore point, so it can be undone.
if [ "$MODE" = "sync" ] && [ -f "$TARGET/yarn.lock" ]; then
  _other=""
  [ -f "$TARGET/package-lock.json" ] && _other="package-lock.json"
  [ -f "$TARGET/pnpm-lock.yaml" ]    && _other="pnpm-lock.yaml"
  if [ -n "$_other" ]; then
    # The `packageManager` field is an EXPLICIT declaration, not an artifact — the one piece of evidence that
    # settles which lockfile is legitimate. Where it names npm or pnpm, a yarn.lock contradicts something the
    # project stated about itself, and this toolkit is what put it there.
    if [ "$PM_SOURCE" = "packageManager-field" ] && [ "$PM" != "yarn" ]; then
      rm -f "$TARGET/yarn.lock"
      echo "NOTE: removed a stray yarn.lock — this project declares packageManager: $PM and also has $_other."
      echo "      A pre-0.18 devcontainer build created it by running 'yarn install' regardless of the project's"
      echo "      package manager, which breaks '$PM ci' for everyone and made every later sync pick yarn."
      echo "      It is in the restore point above if you actually wanted it."
    else
      echo "WARNING: this workspace has TWO lockfiles — yarn.lock and $_other." >&2
      echo "         A pre-0.18 devcontainer build may have created the yarn.lock by running 'yarn install'" >&2
      echo "         regardless of the project's package manager. While both exist, this sync and post-create.sh" >&2
      echo "         resolve to yarn, and '$_other'-based installs (npm ci / pnpm i --frozen-lockfile) fail." >&2
      echo "         Nothing was deleted: which one is legitimate cannot be determined from here. Delete the one" >&2
      echo "         that is not yours, or declare it — npm pkg set packageManager=<pm>@<version> — and re-run." >&2
    fi
  fi
fi

# --- --print-inner: show the rendered program and stop --------------------------------------------------------
# This script's real product is the ~300-line shell program assembled above, and until now the only way to
# read it was to edit this file and insert a printf — which is what every review of it has had to do, and
# what a maintainer debugging a quoting bug would have to do under pressure. The blocks are nested
# double-quoted strings where a stray backtick or an unescaped quote is live command substitution, so being
# able to LOOK at the output is the difference between checking a change and hoping.
#
# Placed here, after every block is rendered but before anything executes, so it shows exactly what would
# have run — including the mode, layer and package-manager decisions already baked in. Writes to stdout and
# exits 0, so `scaffold.sh --sync --print-inner <proj> | bash -n /dev/stdin` is a syntax check.
if [ "$PRINT_INNER" = "1" ]; then
  printf '%s\n' "$INNER" >&3
  exit 0
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
  bash -c "$INNER" || INNER_RC=$?
else
  docker run --rm \
    -u "$(id -u):$(id -g)" \
    -e HOME=/home/node \
    -v "$PROJECTS_DIR":/work -v "$ASSETS_DIR":/assets:ro -w /work \
    "$IMAGE" \
    bash -lc "$INNER" || INNER_RC=$?

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

# --- the run died somewhere: say where, and what that means for the project ------------------------------------
if [ "$INNER_RC" -ne 0 ]; then
  _st=""; _mig=""
  if [ -n "${SYNC_LOCK:-}" ] && [ -f "$SYNC_LOCK/state" ]; then
    _st="$(sed -n 's/^stage=//p' "$SYNC_LOCK/state" 2>/dev/null | tail -1)"
    _mig="$(sed -n 's/^migrations=//p' "$SYNC_LOCK/state" 2>/dev/null | tail -1)"
  fi
  echo "" >&2
  echo "SYNC_FAILED $TARGET (exit $INNER_RC)${_st:+ — died during: $_st}" >&2
  case "$_st" in
    probe|install|"")
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
  echo "  restore    : $BACKUP_REF" >&2
  case "$BACKUP_REF" in
    "(--no-backup)") echo "               (no restore point was taken — this run was given --no-backup)" >&2 ;;
    *)               echo "               git -C '$TARGET' reset --hard $BACKUP_REF" >&2 ;;
  esac
  exit "$INNER_RC"
fi

if [ "$MODE" = "scaffold" ]; then
  echo "SCAFFOLD_OK $TARGET ($RUNTIME_DESC app=apps/$APP firebase=$FIREBASE voice=$VOICE github=$GITHUB) ${GITHUB_RESULT:-}"
else
  echo "SYNC_OK $TARGET ($RUNTIME_DESC app=apps/$APP firebase=$FIREBASE voice=$VOICE backup=$BACKUP_REF)"
fi
