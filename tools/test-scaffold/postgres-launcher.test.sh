#!/usr/bin/env bash
# The Postgres launcher's decisions, against fakes (node + bash, no database, no download). The real binaries are
# tools/test-postgres/run.mjs.
set -uo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/postgres-launcher.checks.mjs"
