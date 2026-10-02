#!/bin/sh
# tools/dev/dev — the house dev loop, stack-free. GENERATOR-OWNED (@bespunky/nx-tools:dev): rewritten on every
# sync; never edit it here. What this project serves lives in .bespunky/dev.json.
#
#   tools/dev/dev serve [app] [--worktree=<x>] [--port-offset=<n|auto>] [--dry-run]   (tools/dev/dev help)
#
# Needs only Node — no project node_modules — so it serves a Python or Go repo exactly as it serves an Nx one.
exec node "$(dirname "$0")/dev.mjs" "$@"
