#!/usr/bin/env bash
# Scaffold a BeSpunky-standard project, OR repair the house generators on an existing project.
#
# Default mode  : full scaffold (Nx + Angular + app + house generators + devcontainer + Claude settings).
# Repair mode   : re-run ONLY the three house generators on an existing project (all idempotent).
# Firebase opt-in: when --firebase is passed, the devcontainer gets the Firebase CLI + Google Cloud CLI
#                  features, the toba.vsfire extension, and labeled portsAttributes for the emulator
#                  suite. (No explicit forwardPorts — VS Code auto-detects and forwards each binding to
#                  a free host port, so multiple devcontainers can run in parallel without collision.)
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
#   scaffold.sh [--firebase] [--no-github] <project-name> [app-name]         # full scaffold
#   scaffold.sh --repair [--firebase] <project-path|project-name> [app-name] # re-apply house generators
#
# Leading flags (--repair, --firebase, --no-github) may be given in any order.
# PROJECTS_DIR env overrides target root in full mode (default: ~/projects).
# Node comes from the typescript-node devcontainer base image, run via Docker - NO nvm.
set -euo pipefail

MODE="scaffold"
FIREBASE=0
GITHUB=1   # scaffold mode creates a private GitHub repo by default; --no-github opts out.
while [ "${1:-}" != "" ]; do
  case "$1" in
    --repair)     MODE="repair"; shift;;
    --firebase)   FIREBASE=1;    shift;;
    --no-github)  GITHUB=0;      shift;;
    --*)          echo "ERROR: unknown flag '$1'" >&2; exit 1;;
    *)            break;;
  esac
done

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_NAME="$(git config --global user.name 2>/dev/null || whoami)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || echo "$(whoami)@localhost")"

# --- guards (apply to both modes) ---
command -v docker >/dev/null || { echo "ERROR: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: docker daemon not accessible" >&2; exit 1; }
command -v curl >/dev/null || { echo "ERROR: curl not found" >&2; exit 1; }

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

# --- resolve newest Node major that has a typescript-node devcontainer image ---
echo "Resolving latest typescript-node base image..."
MAJOR="$(curl -fsSL 'https://mcr.microsoft.com/v2/devcontainers/typescript-node/tags/list' \
  | grep -oE '[0-9]+-bookworm' | sed 's/-bookworm//' | sort -rn | awk '$1>=18' | head -1 || true)"
[ -n "${MAJOR:-}" ] || MAJOR=24
IMAGE="mcr.microsoft.com/devcontainers/typescript-node:${MAJOR}"
echo "Base image: $IMAGE"
[ "$FIREBASE" = "1" ] && echo "Firebase: opt-in ENABLED (Firebase CLI + Google Cloud CLI + emulator ports)"

# --- devcontainer generator args ---
DEVCONTAINER_FLAGS=""
[ "$FIREBASE" = "1" ] && DEVCONTAINER_FLAGS=" --firebase=true"

# --- firebase-emulators block (only when --firebase): scaffold emulator config + Nx targets + app init.
#     The generator itself adds `firebase` + `@angular/fire` to package.json and runs the package-manager install
#     post-commit (via installPackagesTask), so versions resolve to current at scaffold time. No shell-side `yarn add`. ---
FIREBASE_BLOCK=""
if [ "$FIREBASE" = "1" ]; then
  FIREBASE_BLOCK="
ensure_nx_tools; yarn nx g @bespunky/nx-tools:firebase-emulators --project=$APP --workspaceName=$PROJECT"
fi

# --- house-generators block (used by both modes; idempotent) ---
# @bespunky/nx-tools is bundled scaffold-time tooling: we copy it into node_modules but never
# declare it in package.json (it must not ship in the generated project). The cost of that is
# that every 'yarn install' prunes it. The playwright and firebase-emulators generators each run
# installPackagesTask as their post-commit step, so an install fires mid-sequence and deletes
# nx-tools out from under whatever generator runs next. So we compile ONE copy into a stage dir
# and re-establish it before EVERY generator via ensure_nx_tools. This is robust to the order and
# count of install-triggering generators; reordering alone is NOT, since with two of them the one
# that runs second would still find nx-tools already pruned.
HOUSE_BLOCK="rm -rf /tmp/bespunky-nx-tools
cp -r /assets/nx-tools /tmp/bespunky-nx-tools
node /assets/compile-generators.mts /tmp/bespunky-nx-tools
ensure_nx_tools() {
  rm -rf node_modules/@bespunky/nx-tools
  mkdir -p node_modules/@bespunky
  cp -r /tmp/bespunky-nx-tools node_modules/@bespunky/nx-tools
}
ensure_nx_tools; yarn nx g @bespunky/nx-tools:serve-options --project=$APP
ensure_nx_tools; yarn nx g @bespunky/nx-tools:devcontainer --name=$PROJECT --nodeMajor=$MAJOR$DEVCONTAINER_FLAGS
ensure_nx_tools; yarn nx g @bespunky/nx-tools:claude-settings
ensure_nx_tools; yarn nx g @bespunky/nx-tools:playwright$FIREBASE_BLOCK"

if [ "$MODE" = "scaffold" ]; then
  INNER="set -e
git config --global user.name '$GIT_NAME'
git config --global user.email '$GIT_EMAIL'
git config --global init.defaultBranch main
yarn create nx-workspace '$PROJECT' --preset=apps --packageManager=yarn --nxCloud=skip --no-interactive
cd '$PROJECT'
yarn nx add @nx/angular
yarn nx g @nx/angular:application 'apps/$APP' --minimal --style=scss --routing --e2eTestRunner=none
$HOUSE_BLOCK
# Commit the full scaffold. \`yarn create nx-workspace\` made an initial commit, but the
# house generators + dep installs ran after it — capture them so the host-side push (gh repo
# create --source --push) ships a clean, complete tree on \`main\`.
git add -A
git commit -m 'chore: scaffold BeSpunky project (Nx + Angular + house generators)' || true"
else
  INNER="set -e
cd '$PROJECT'
if [ ! -x node_modules/.bin/nx ]; then
  echo 'ERROR: node_modules/.bin/nx not found - run \"yarn install\" in the project first, then re-run --repair.' >&2
  exit 1
fi
$HOUSE_BLOCK"
fi

docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -v "$PROJECTS_DIR":/work -v "$ASSETS_DIR":/assets:ro -w /work \
  "$IMAGE" \
  bash -lc "$INNER"

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
  echo "SCAFFOLD_OK $TARGET (image=$IMAGE app=apps/$APP firebase=$FIREBASE github=$GITHUB) ${GITHUB_RESULT:-}"
else
  echo "REPAIR_OK $TARGET (image=$IMAGE app=apps/$APP firebase=$FIREBASE)"
fi
