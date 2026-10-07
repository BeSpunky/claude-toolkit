#!/usr/bin/env bash
# Thin wrapper: run.sh globs *.test.sh; the assertions live in the sibling dev-engine.checks.mjs, which
# imports the stack-free dev engine (tools/dev/*.mjs — kept as .tpl in the payload) the way a project runs it:
# plain Node, no build step, no node_modules.
set -uo pipefail
# A human runs these: under an AI agent (CLAUDECODE=1) the engine never takes the base ports.
unset CLAUDECODE

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v node >/dev/null 2>&1 || { echo "  skip  node unavailable"; exit 0; }

node "$DIR/dev-engine.checks.mjs"
