#!/usr/bin/env bash
# THE ANGULAR TS-SOLUTION TRIPWIRE — a real TS-solution workspace, our compiled Angular adapter, a real build.
#
#   bash tools/test-angular-ts-solution/run.sh          # ~5–15 min, needs the network (npm registry)
#   KEEP=1 bash tools/test-angular-ts-solution/run.sh   # keep the workspace afterwards, for a post-mortem
#
# ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────────────────
#
# @nx/angular REFUSES a TypeScript-solution workspace (package-manager workspaces + project references): its
# generators assert `assertNotUsingTsSolutionSetup` and stop, because the Angular compiler does not support
# TypeScript project references. The house hosts Angular there anyway, as an honest hybrid — apps are project.json
# islands, libraries are real workspace packages, both reached through `exports` — and gets past that refusal with
# upstream's own opt-out, the environment variable NX_IGNORE_UNSUPPORTED_TS_SETUP, set around one generator call
# (`adapters/angular/ts-solution.ts`) and inline on `nx add` (house.sh).
#
# That opt-out is UNDOCUMENTED. It appears nowhere in Nx's docs — only in the text of the refusal itself — so it
# carries no compatibility promise, and a MINOR Nx release can rename it, remove it, or keep it while the generated
# workspace quietly stops building. Nothing else here can notice: the generator fixtures (tools/test-generators)
# run on an in-memory Tree, with no compiler and no registry. This does what a consumer does — a real
# `create-nx-workspace --preset=ts`, `nx add @nx/angular`, our adapter creating an app and a publishable library,
# an import across the link, then `nx sync`, typecheck and build — and fails loudly the day any of that breaks.
#
# Slow and network-bound by nature, so it is NOT in the pre-push hook and not on every push: it runs weekly, and
# on changes to the Angular adapter or the linking seam (.github/workflows/angular-ts-solution.yml).
#
# Nx is pinned to the repo's own `nx` devDependency (override with NX_VERSION=…), so a failure means "this Nx
# broke the hybrid", not "latest moved under us"; bumping the repo's Nx is what moves the tripwire forward.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
ASSETS="$REPO/plugins/house/engine"
PAYLOAD="$ASSETS/nx-tools"
NX_VERSION="${NX_VERSION:-$(node -p "require('$REPO/package.json').devDependencies.nx")}"
WS_NAME=tssol

WORK="$(mktemp -d "${TMPDIR:-/tmp}/angular-ts-solution.XXXXXX")"
cleanup() {
  if [ "${KEEP:-0}" = 1 ]; then echo "kept: $WORK/$WS_NAME"; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

step() { printf '\n── %s\n' "$*"; }
fail() { printf '\nTRIPWIRE FAILED: %s\n' "$*" >&2; exit 1; }

step "create-nx-workspace@$NX_VERSION --preset=ts --workspaces (the TS-solution workspace house.sh --linking=workspaces builds)"
cd "$WORK"
# Agent-mode env vars stripped, exactly as house.sh does: create-nx-workspace ignores --preset under them.
env -u CLAUDECODE -u OPENCODE npx --yes "create-nx-workspace@$NX_VERSION" "$WS_NAME" \
  --preset=ts --workspaces=true --packageManager=npm --nxCloud=skip --no-interactive \
  || fail "create-nx-workspace could not build a TS-solution workspace"
cd "$WS_NAME"

step "nx add @nx/angular@$NX_VERSION under the opt-out (house.sh's exact form: an inline prefix, never an export)"
NX_IGNORE_UNSUPPORTED_TS_SETUP=true npx nx add "@nx/angular@$NX_VERSION" \
  || fail "nx add @nx/angular refused the TS-solution workspace even with NX_IGNORE_UNSUPPORTED_TS_SETUP — the opt-out may be gone"

step "compile the payload as the publisher does, inside the workspace (so its peers resolve from here)"
UNDER_TEST="$PWD/node_modules/.cache/nx-tools-under-test"
mkdir -p "$UNDER_TEST"
cp -R "$PAYLOAD/src" "$UNDER_TEST/src"
cp "$PAYLOAD/package.json" "$PAYLOAD/generators.json" "$PAYLOAD/executors.json" "$PAYLOAD/migrations.json" "$UNDER_TEST/"
node "$ASSETS/compile-generators.mts" "$UNDER_TEST"

step "our Angular adapter: an app + a publishable library, linked, with an import across the link"
node "$HERE/drive.cjs" "$UNDER_TEST" || fail "the house Angular adapter could not create projects in a TS-solution workspace"

step "install (the link declared new workspace dependencies)"
# --legacy-peer-deps: npm's peer resolver crashes on the Angular + Nx peer graph of a fresh workspace (observed on
# Nx 23.1 / Angular 22); unrelated to what this checks.
npm install --legacy-peer-deps --no-audit --no-fund

step "nx sync, then sync:check (project references are current — what CI would gate on)"
npx nx sync
npx nx sync:check || fail "nx sync:check — project references drift after a sync"

step "typecheck — every project that has the target, and the Angular app's own tsconfig across the link"
npx nx run-many -t typecheck --outputStyle=static || fail "typecheck"
npx tsc -p "$(cat .tripwire-app-root)/tsconfig.app.json" --noEmit || fail "the Angular app does not typecheck against the linked library"

step "build — ng-packagr for the library, the Angular application builder for the app"
npx nx run-many -t build --outputStyle=static || fail "build"

printf '\nok: the Angular TS-solution hybrid builds on Nx %s\n' "$NX_VERSION"
