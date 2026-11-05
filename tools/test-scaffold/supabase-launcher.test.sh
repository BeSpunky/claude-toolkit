#!/usr/bin/env bash
# The Supabase provider's decisions, against a fake CLI (node + bash, no stack, no download). The real CLI is tools/test-supabase/run.mjs.
set -uo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/supabase-launcher.checks.mjs"
