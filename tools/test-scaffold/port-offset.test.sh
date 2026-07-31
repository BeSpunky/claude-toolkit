#!/usr/bin/env bash
# Thin wrapper: run.sh globs *.test.sh, and this suite's assertions are TypeScript-adjacent, so they
# live in a sibling .mjs that Node type-strips directly (the payload has no build step here).
#
# Requires Node 22.18+ for type stripping — the same bar the scaffolder itself uses to decide whether
# it can run generators locally. Below that, skip loudly rather than report a pass.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v node >/dev/null 2>&1 || { echo "  skip  node unavailable"; exit 0; }

major="$(node -p 'process.versions.node.split(".")[0]')"
minor="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 18 ]; }; then
  echo "  skip  node $(node -p 'process.versions.node') cannot type-strip .ts (needs 22.18+)"
  exit 0
fi

node "$DIR/port-offset.checks.mjs"
