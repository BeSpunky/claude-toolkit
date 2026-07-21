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
    --*)          echo "ERROR: unknown flag '$1'" >&2; exit 1;;
    *)            break;;
  esac
done

# --- is the local Node new enough to skip Docker entirely? ---
# The bar is compile-generators.mts: TypeScript run directly by node, which needs type-stripping ON BY
# DEFAULT — Node 22.18+ (flagged/experimental before that). Anything older, or no local node/yarn at all,
# falls back to the image. Inside a devcontainer this is always true, which is why `--repair` runs there
# with no Docker. Mirrors local_node_ok() in tools/publish-nx-tools/publish.sh.
local_node_ok() {
  command -v node >/dev/null && command -v yarn >/dev/null || return 1
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

# --- devcontainer generator args ---
# Append (never overwrite) so --firebase and --voice compose in either order.
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
ensure_nx_tools; yarn nx g @bespunky/nx-tools:firebase-emulators --project=$APP --workspaceName=$PROJECT$APP_STAGING_FLAG"
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
STAGE_BLOCK="rm -rf '$STAGE_DIR'
cp -r '$ASSETS_ROOT/nx-tools' '$STAGE_DIR'
node '$ASSETS_ROOT/compile-generators.mts' '$STAGE_DIR'
ensure_nx_tools() {
  rm -rf node_modules/@bespunky/nx-tools
  mkdir -p node_modules/@bespunky
  cp -r '$STAGE_DIR' node_modules/@bespunky/nx-tools
}"

# --- per-workspace house generators (used by both modes; idempotent; run once per workspace) ---
# The PER-APP generators (serve, serve-options, firebase-emulators) are deliberately NOT here: in
# scaffold mode the `app` generator applies them to the new app; in repair mode they run explicitly
# against the existing app (see each mode's INNER below). These workspace-level ones are identical in
# both modes regardless of how many apps the workspace has.
WORKSPACE_GEN_BLOCK="ensure_nx_tools; yarn nx g @bespunky/nx-tools:devcontainer --name=$PROJECT --nodeMajor=$MAJOR$DEVCONTAINER_FLAGS
ensure_nx_tools; yarn nx g @bespunky/nx-tools:claude-settings
ensure_nx_tools; yarn nx g @bespunky/nx-tools:angular-ai
ensure_nx_tools; yarn nx g @bespunky/nx-tools:playwright
ensure_nx_tools; yarn nx g @bespunky/nx-tools:shared-browser
ensure_nx_tools; yarn nx g @bespunky/nx-tools:worktree-domains
# The window identity — an emoji + a quiet, project-coloured status band in .vscode/settings.json, so this
# project's VSCode window is distinguishable from every other open window. Runs BEFORE the design system, so
# at scaffold time there is deliberately no primary token to read and the colour is a stable hash of the
# project NAME (source=name-hash) — distinct per project from moment zero. It upgrades to the real brand
# colour later, once the design system has real tokens (the bespunky-vscode-identity skill + its offer hook).
# Idempotent + --repair-safe: the provenance ratchet means this name-hash pass never downgrades a colour a
# project has since moved to design-system or a hand-picked one.
ensure_nx_tools; yarn nx g @bespunky/nx-tools:window-identity --name=$PROJECT
# The design system — the workspace's single source of visual truth, present from moment zero (a design
# system retrofitted after five screens of hardcoded hex is not a design system, it's an archaeology dig).
# Runs AFTER the app exists so it can open the sass channel on it; a LATER app wires itself, because the
# \`app\` generator composes the same per-app design-system-styles generator. --scope is load-bearing: the
# underlying publishable-lib defaults to the @bespunky npm scope (the toolkit's own), which would be wrong
# for every consumer project. Idempotent in --repair (the token file is seeded, never overwritten — a
# repair must not restore placeholder tokens over the project's real design).
ensure_nx_tools; yarn nx g @bespunky/nx-tools:design-system --scope=$PROJECT
ensure_nx_tools; yarn nx g @bespunky/nx-tools:house-doc --nxToolsVersion=$NX_TOOLS_VERSION --pluginVersion=$PLUGIN_VERSION
# Persist @bespunky/nx-tools as a real devDependency so the house generators (the app generator
# for adding further apps, plus the reusable-tool extraction generators mark-extractable /
# adopt-extracted) survive 'yarn install' and stay runnable in the project's devcontainer. Graceful
# until the package is first published (see tools/publish-nx-tools); once published, --repair adds
# it to existing projects.
yarn add -D @bespunky/nx-tools@^$NX_TOOLS_VERSION || echo 'NOTE: @bespunky/nx-tools not on npm yet — publish it (tools/publish-nx-tools), then scaffold --repair to add it.'"

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
ensure_nx_tools; yarn nx g @bespunky/nx-tools:app 'apps/$APP' $APP_FIREBASE_FLAG$APP_STAGING_FLAG
$WORKSPACE_GEN_BLOCK
# Commit the full scaffold. \`yarn create nx-workspace\` made an initial commit, but the
# house generators + dep installs ran after it — capture them so the host-side push (gh repo
# create --source --push) ships a clean, complete tree on \`main\`.
git add -A
git commit -m 'chore: scaffold BeSpunky project (Nx + Angular + house generators)' || true"
else
  INNER="set -e
cd '$WORK_ROOT/$PROJECT'
if [ ! -x node_modules/.bin/nx ]; then
  echo 'ERROR: node_modules/.bin/nx not found - run \"yarn install\" in the project first, then re-run --repair.' >&2
  exit 1
fi
$STAGE_BLOCK
# Repair re-applies the per-app house config to the EXISTING app (the \`app\` generator CREATES
# apps; it is not the heal path), then the workspace-level generators. All idempotent.
ensure_nx_tools; yarn nx g @bespunky/nx-tools:serve --project=$APP
ensure_nx_tools; yarn nx g @bespunky/nx-tools:serve-options --project=$APP$REPAIR_FIREBASE_BLOCK
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
  trap 'rm -rf "$STAGE_DIR"' EXIT
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
